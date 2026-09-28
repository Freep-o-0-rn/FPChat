'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');

const OUT=path.resolve(process.env.FPCHAT_SCROLL_BENCH_OUTPUT||path.join(process.cwd(),'scroll1902-bench-output'));
const LABEL=process.env.FPCHAT_SCROLL_BENCH_LABEL||'current';
const round=value=>Number.isFinite(Number(value))?Math.round(Number(value)*100)/100:null;
const stats=values=>{
  const clean=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!clean.length)return{n:0,median:null,min:null,max:null};
  return{n:clean.length,median:round(clean[Math.floor(clean.length/2)]),min:round(clean[0]),max:round(clean.at(-1))};
};

run(async({newClient,errors,temp,root})=>{
  const page=await newClient(async p=>{
    await p.addInitScript(()=>{
      localStorage.setItem('fpchat:nick','ScrollBench');
    });
  });
  await page.setViewportSize({width:390,height:844});

  const fixture=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='scroll1902-benchmark';
    const key=await deriveKey(secret);
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:'ScrollBench',deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok)throw new Error('fixture '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});
    const encrypted=[];
    for(let i=0;i<16;i++)encrypted.push(await encryptText('scroll benchmark '+i+' '+('payload '.repeat((i%6)+1)),key));
    return{roomId:data.publicId,deviceId,secret,count:700,incoming:false,encrypted};
  });

  execFileSync(
    process.env.FPCHAT_TEST_NODE||process.execPath,
    [path.join(root,'scripts/seed-history174.cjs')],
    {input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures:[fixture]}),encoding:'utf8'}
  );

  await page.evaluate(roomId=>openChat(roomId),fixture.roomId);

  const requests={viewStatePuts:0,messageGets:0,joinPosts:0};
  page.on('request',request=>{
    let url;try{url=new URL(request.url());}catch{return;}
    const method=request.method().toUpperCase();
    if(/\/view-state$/.test(url.pathname)&&method==='PUT')requests.viewStatePuts++;
    if(/\/messages$/.test(url.pathname)&&method==='GET')requests.messageGets++;
    if(/\/join$/.test(url.pathname)&&method==='POST')requests.joinPosts++;
  });
  await page.evaluate(()=>{
    window.__scrollBench={localSnapshotWrites:0};
    const proto=Storage.prototype,originalSet=proto.setItem;
    window.__scrollBenchRestoreStorage=()=>{proto.setItem=originalSet;};
    proto.setItem=function(key,value){
      if(String(key).startsWith('fpchat:view-state:'))window.__scrollBench.localSnapshotWrites++;
      return originalSet.call(this,key,value);
    };
  });

  const beforeMetrics=await page.evaluate(()=>window.FPScroll173?.snapshot?.()||null);
  const scrollResult=await page.evaluate(async()=>{
    const box=document.getElementById('messages');
    if(!box)throw new Error('messages missing');
    const durations=[];
    const max=Math.max(0,box.scrollHeight-box.clientHeight);
    for(let i=0;i<48;i++){
      const ratio=0.15+((i%16)/20);
      box.scrollTop=Math.max(0,Math.min(max,Math.round(max*ratio)));
      box.dispatchEvent(new WheelEvent('wheel',{deltaY:i%2?90:-90,bubbles:true}));
      const started=performance.now();
      box.dispatchEvent(new Event('scroll'));
      durations.push(performance.now()-started);
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    const anchor=getFirstVisibleMessageAnchor(box);
    return{durations,anchor,scrollTop:box.scrollTop};
  });

  await page.waitForTimeout(1100);
  const afterMetrics=await page.evaluate(()=>window.FPScroll173?.snapshot?.()||null);
  const countersAfterScroll={...requests,...await page.evaluate(()=>({...window.__scrollBench}))};
  const localSnapshot=await page.evaluate(roomId=>{
    try{return typeof STORAGE.viewState==='function'?STORAGE.get(STORAGE.viewState(roomId)):null;}catch{return null;}
  },fixture.roomId);

  const expectedAnchor=await page.evaluate(()=>getFirstVisibleMessageAnchor(document.getElementById('messages')));
  const leaveStart=Date.now();
  await page.evaluate(()=>setView('chats'));
  const leaveWallMs=Date.now()-leaveStart;

  // Reset request counters only for reopen so request count is comparable.
  requests.messageGets=0;requests.joinPosts=0;
  const reopenStarted=Date.now();
  await page.evaluate(roomId=>openChat(roomId),fixture.roomId);
  const reopenWallMs=Date.now()-reopenStarted;
  await page.waitForTimeout(1000);

  const reopen=await page.evaluate(anchorId=>{
    const box=document.getElementById('messages'),node=anchorId?findMessageElement(anchorId):null;
    return{
      actualAnchor:getFirstVisibleMessageAnchor(box),
      targetOffset:node?Math.round(node.getBoundingClientRect().top-box.getBoundingClientRect().top):null,
      atBottom:isMessagesAtBottom(box),
      hasNewer:Boolean(activeChatHistory?.hasNewer),
      counters:{...window.__scrollBench}
    };
  },Number(expectedAnchor?.anchorMessageId)||null);

  await page.evaluate(()=>{try{window.__scrollBenchRestoreStorage?.();}catch{};delete window.__scrollBenchRestoreStorage;});

  const metricDelta=(name)=>{
    const a=Number(beforeMetrics?.metrics?.[name]);
    const b=Number(afterMetrics?.metrics?.[name]);
    return Number.isFinite(a)&&Number.isFinite(b)?b-a:null;
  };
  const report={
    schema:1,
    label:LABEL,
    build:'190.2',
    root,
    environment:'isolated Linux headless Chromium + local SQLite; 390x844 viewport',
    scrollEvents:48,
    scrollDurationMs:1200,
    postScrollWaitMs:1100,
    scrollHandlerMs:stats(scrollResult.durations),
    persistence:{
      localSnapshotWritesObserved:countersAfterScroll.localSnapshotWrites,
      networkViewStatePutsObserved:countersAfterScroll.viewStatePuts,
      durableLocalSnapshot:Boolean(localSnapshot),
      localClientSeq:Number(localSnapshot?.clientSeq)||null,
      ownerMetricDelta:{
        captures:metricDelta('captures'),
        localWrites:metricDelta('localWrites'),
        networkWrites:metricDelta('networkWrites'),
        captureCostMs:round(metricDelta('captureCostMs')),
        captureAverageMs:round(afterMetrics?.metrics?.captureAverageMs)
      },
      declaredCadence:afterMetrics?{
        localCaptureIntervalMs:Number(afterMetrics.localCaptureIntervalMs)||null,
        networkMaxLagMs:Number(afterMetrics.networkMaxLagMs)||null
      }:null
    },
    navigation:{
      leaveWallMs,
      reopenWallMs,
      reopenJoinPosts:requests.joinPosts,
      postOpenMessageGets:requests.messageGets,
      expectedAnchor,
      reopenedAnchor:reopen.actualAnchor,
      reopenedTargetOffset:reopen.targetOffset,
      offsetErrorPx:expectedAnchor&&Number.isFinite(reopen.targetOffset)?round(reopen.targetOffset-Number(expectedAnchor.anchorOffsetPx||0)):null,
      atBottom:reopen.atBottom,
      hasNewer:reopen.hasNewer
    },
    errors
  };
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,'scroll1902-'+LABEL+'.json'),JSON.stringify(report,null,2)+'\n');
  console.log('SCROLL1902_BENCH '+JSON.stringify(report));
  if(errors.length)process.exitCode=1;
}).catch(error=>{console.error(error);process.exitCode=1;});
