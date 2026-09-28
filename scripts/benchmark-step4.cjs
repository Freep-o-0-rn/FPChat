'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');

const SAMPLES=5;
const OUT=path.resolve(process.env.FPCHAT_STEP4_OUTPUT||path.join(process.cwd(),'step4-output'));
fs.mkdirSync(OUT,{recursive:true});

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const round=n=>n===null||n===undefined||!Number.isFinite(Number(n))?null:Math.round(Number(n)*10)/10;
function stats(values){
  const clean=values.filter(v=>v!==null&&v!==undefined).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!clean.length)return{n:0,median:null,min:null,max:null,p95:null,p95Rule:'not calculated: no samples'};
  const median=clean.length%2?clean[(clean.length-1)/2]:(clean[clean.length/2-1]+clean[clean.length/2])/2;
  const result={n:clean.length,median:round(median),min:round(clean[0]),max:round(clean.at(-1)),p95:null,
    p95Rule:clean.length>=20?'nearest-rank ceil(0.95*n)':'not calculated for n < 20'};
  if(clean.length>=20)result.p95=round(clean[Math.max(0,Math.ceil(clean.length*.95)-1)]);
  return result;
}
function stageDelta(record,a,b){
  const x=record?.points?.[a],y=record?.points?.[b];
  return Number.isFinite(x)&&Number.isFinite(y)?round(y-x):null;
}
function summarizeSamples(rows,keys){
  const out={};
  for(const key of keys)out[key]=stats(rows.map(r=>r?.[key]));
  return out;
}
async function configureNetwork(page,profile){
  const session=await page.context().newCDPSession(page);
  await session.send('Network.enable');
  if(profile==='throttled'){
    await session.send('Network.emulateNetworkConditions',{
      offline:false,latency:200,downloadThroughput:125000,uploadThroughput:62500,connectionType:'cellular3g'
    });
  }else{
    await session.send('Network.emulateNetworkConditions',{
      offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'wifi'
    });
  }
  return session;
}
async function waitBoot(page,timeout=45000){
  await page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout});
}
async function waitWs(page){
  let last=null;
  for(let attempt=0;attempt<3;attempt++){
    last=await page.evaluate(async()=>{
      const roomId=String(state?.roomId||'');
      const stored=roomId?STORAGE.get(STORAGE.roomState(roomId)):null;
      const deviceId=String(stored?.deviceId||(typeof activeChatDeviceId!=='undefined'&&activeChatDeviceId)||'');
      const ok=deviceId&&window.FPConnection170?.ensureConnected
        ?await window.FPConnection170.ensureConnected(deviceId,12000)
        :false;
      return{
        ok:Boolean(ok),
        room:Boolean(roomId),
        device:Boolean(deviceId),
        online:navigator.onLine!==false,
        stateWs:state?.ws?{readyState:Number(state.ws.readyState),sameDevice:state.ws.deviceId===deviceId}:null,
        owner:window.FPConnection170?.snapshot?.()||null
      };
    });
    if(last?.ok&&last?.owner?.open===true)return last;
    await sleep(250);
  }
  throw Error('WS precondition failed '+JSON.stringify(last));
}
async function createRoom(page,label){
  return page.evaluate(async label=>{
    const deviceId=getOrCreateDeviceId(),secret='step4-'+label;
    const key=await deriveKey(secret),recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      displayName:state.nick,deviceId,roomSecret:secret,...recovery
    })});
    if(!response.ok)throw Error('fixture room failed '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});
    upsertChat(data.publicId,{});
    const encrypted=await encryptText('Step4 fixed benchmark message',key);
    return{roomId:data.publicId,deviceId,secret,encrypted};
  },label);
}
async function openMeasured(page,roomId){
  return page.evaluate(async roomId=>{
    showChatsList();
    const start=performance.now();
    await openChat(roomId);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const elapsed=performance.now()-start;
    const records=FPRuntime169.loading.report().records.filter(r=>r.kind==='room');
    const room=records.at(-1)||null;
    return{
      openMs:elapsed,
      keyMs:room?((room.points['key-ready']??NaN)-(room.points['key-start']??NaN)):null,
      joinMs:room?((room.points['join-ready']??NaN)-(room.points['join-start']??NaN)):null,
      historyMs:room?((room.points['history-ready']??NaN)-(room.points['history-start']??NaN)):null,
      renderTextMs:room?((room.points['text-ready']??NaN)-(room.points['render-start']??NaN)):null,
      layoutMs:room?((room.points['layout-wait-end']??NaN)-(room.points['layout-wait-start']??NaN)):null,
      revealFrameMs:room?((room.points['visible-frame']??NaN)-(room.points['messages-revealed']??NaN)):null,
      mounted:document.querySelectorAll('#messages .bubble-wrap.msg').length,
      domNodes:document.getElementsByTagName('*').length
    };
  },roomId).then(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='number'?round(v):v])));
}
async function putBottomViewState(page,fixture){
  await page.evaluate(async f=>{
    await fetch('/api/rooms/'+encodeURIComponent(f.roomId)+'/view-state',{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({deviceId:f.deviceId,anchorMessageId:null,anchorOffsetPx:0,atBottom:true})
    });
  },fixture);
}
async function scrollOlderMeasured(page,fixture){
  await putBottomViewState(page,fixture);
  await openMeasured(page,fixture.roomId);
  const before=await page.evaluate(()=>({
    first:Number(document.querySelector('#messages .bubble-wrap.msg[data-message-id]')?.dataset.messageId||0),
    t:performance.now()
  }));
  await page.evaluate(()=>{
    const box=document.getElementById('messages');
    box.scrollTop=0;
    box.dispatchEvent(new Event('scroll'));
  });
  await page.waitForFunction(first=>{
    const node=document.querySelector('#messages .bubble-wrap.msg[data-message-id]');
    const id=Number(node?.dataset.messageId||0);
    return id>0&&id<first;
  },before.first,{timeout:30000});
  return page.evaluate(t=>({
    scrollLoadMs:performance.now()-t,
    mounted:document.querySelectorAll('#messages .bubble-wrap.msg').length,
    domNodes:document.getElementsByTagName('*').length
  }),before.t).then(r=>({scrollLoadMs:round(r.scrollLoadMs),mounted:r.mounted,domNodes:r.domNodes}));
}
async function getTextMessageId(page){
  return page.evaluate(()=>{
    const rows=[...document.querySelectorAll('#messages .bubble-wrap.msg[data-message-id]')];
    const row=[...rows].reverse().find(n=>n.querySelector('.message-text')&&!n.querySelector('.media-grid'))||rows.at(-1);
    return Number(row?.dataset.messageId||0);
  });
}
async function reactionMeasured(page){
  const messageId=await getTextMessageId(page);
  if(!messageId)throw Error('reaction benchmark message missing');
  return page.evaluate(async messageId=>{
    const roomId=String(state.roomId);
    const manager=FPReactionManager188;
    await manager.getQuickReactions();
    let current=manager.get(roomId,messageId);
    if((current?.myReactions||[]).some(x=>x.reactionId==='heart')){
      await manager.toggleReaction({roomId,messageId,reactionId:'heart',reaction:{reactionId:'heart',type:'emoji',value:'❤️',enabled:true}});
    }
    const t=performance.now();
    const promise=manager.toggleReaction({roomId,messageId,reactionId:'heart',reaction:{reactionId:'heart',type:'emoji',value:'❤️',enabled:true}});
    const optimistic=manager.get(roomId,messageId);
    const optimisticMs=performance.now()-t;
    if(!(optimistic?.myReactions||[]).some(x=>x.reactionId==='heart'))throw Error('reaction optimistic projection missing');
    await promise;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const ackMs=performance.now()-t;
    await manager.toggleReaction({roomId,messageId,reactionId:'heart',reaction:{reactionId:'heart',type:'emoji',value:'❤️',enabled:true}});
    return{reactionOptimisticMs:optimisticMs,reactionAckMs:ackMs};
  },messageId).then(r=>({reactionOptimisticMs:round(r.reactionOptimisticMs),reactionAckMs:round(r.reactionAckMs)}));
}
async function sendMeasured(page,seq){
  try{await waitWs(page);}
  catch(error){
    return{sendOptimisticMs:null,sendAckMs:null,optimisticObserved:false,ackObserved:false,failureStage:'ws-precondition'};
  }
  return page.evaluate(async seq=>{
    const input=document.getElementById('msgInput'),form=document.getElementById('sendForm');
    if(!input||!form)return{sendOptimisticMs:null,sendAckMs:null,optimisticObserved:false,ackObserved:false,failureStage:'composer-missing'};
    const value='step4-send-'+seq+'-'+Math.random().toString(36).slice(2,8);
    input.value=value;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    const t=performance.now();
    form.requestSubmit();
    let row=null;
    const until=performance.now()+10000;
    while(performance.now()<until){
      row=[...document.querySelectorAll('#messages .bubble-wrap.msg')].find(n=>n.textContent?.includes(value))||null;
      if(row)break;
      await new Promise(requestAnimationFrame);
    }
    if(!row){
      const socket=state?.ws||null;
      return{
        sendOptimisticMs:null,sendAckMs:null,optimisticObserved:false,ackObserved:false,
        failureStage:'optimistic-timeout',
        socketOpen:socket?.readyState===WebSocket.OPEN,
        socketDevicePresent:Boolean(socket?.deviceId)
      };
    }
    const optimisticMs=performance.now()-t;
    const ackUntil=performance.now()+15000;
    while(performance.now()<ackUntil){
      const id=String(row.dataset.messageId||row.dataset.id||'');
      if(/^\d+$/.test(id))break;
      await new Promise(r=>setTimeout(r,10));
      row=[...document.querySelectorAll('#messages .bubble-wrap.msg')].find(n=>n.textContent?.includes(value))||row;
    }
    const id=String(row.dataset.messageId||row.dataset.id||'');
    const ackObserved=/^\d+$/.test(id);
    return{
      sendOptimisticMs:optimisticMs,
      sendAckMs:ackObserved?performance.now()-t:null,
      optimisticObserved:true,
      ackObserved,
      failureStage:ackObserved?null:'ack-timeout'
    };
  },seq).then(r=>({
    ...r,
    sendOptimisticMs:round(r.sendOptimisticMs),
    sendAckMs:round(r.sendAckMs)
  }));
}
async function backgroundMeasured(page,browser){
  const other=await browser.newPage({viewport:{width:320,height:240}});
  await other.goto('about:blank');
  await other.bringToFront();
  await sleep(500);
  const hidden=await page.evaluate(()=>document.visibilityState==='hidden');
  if(!hidden){
    await other.close();
    return{backgroundResumeMs:null,hiddenObserved:false,supported:false};
  }
  const t=Date.now();
  await page.bringToFront();
  await page.waitForFunction(()=>document.visibilityState==='visible',null,{timeout:15000});
  await waitWs(page);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const ms=Date.now()-t;
  await other.close();
  return{backgroundResumeMs:ms,hiddenObserved:true,supported:true};
}
async function outageMeasured(page,profile){
  await waitWs(page);
  const context=page.context();
  const started=Date.now();
  await context.setOffline(true);
  await sleep(10000);
  const restore=Date.now();
  await context.setOffline(false);
  await waitWs(page,30000);
  // Reapply the requested CDP profile because offline emulation and context state can race on Chromium.
  await configureNetwork(page,profile);
  return{outageMs:restore-started,reconnectMs:Date.now()-restore};
}
async function exportLoading(page,label){
  await page.evaluate(()=>{showChatsList();setView('settings');});
  await page.locator('[data-open="about"]').click();
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#fpLoadingExport186').click();
  const download=await downloadPromise;
  const src=await download.path();
  const dst=path.join(OUT,label+'.json');
  fs.copyFileSync(src,dst);
  const data=JSON.parse(fs.readFileSync(dst,'utf8'));
  await page.locator('#fpLoadingReset186').click();
  return{file:path.basename(dst),build:data.build,records:data.records?.length||0,dropped:data.dropped||0};
}
async function uploadPhotoFixture(page,root,roomId){
  await openMeasured(page,roomId);
  const before=await page.locator('#messages .media-tile').count();
  await page.locator('#mediaFileInput').setInputFiles(path.join(root,'public/icons/icon-512x512.png'));
  await page.waitForSelector('.media-send-btn');
  await page.locator('.media-send-btn').click();
  await page.waitForSelector('.media-preview-overlay',{state:'detached',timeout:30000});
  await page.waitForFunction(before=>document.querySelectorAll('#messages .media-tile').length>before,before,{timeout:20000});
  await page.evaluate(()=>FPNetwork171?.waitForMediaCacheIdle?.());
}
async function photoMeasured(page,{cold=false}={}){
  if(cold){
    await page.evaluate(async()=>{
      await FPNetwork171?.waitForMediaCacheIdle?.();
      await FPStorage167.clearCache(['image']);
    });
  }
  const before=await page.evaluate(()=>FPRuntime169.loading.report().records.length);
  const tile=page.locator('#messages .media-tile').last();
  const t=Date.now();
  await tile.click();
  await page.waitForSelector('.media-viewer-content img');
  await page.waitForFunction(()=>{const img=document.querySelector('.media-viewer-content img');return !!img&&img.complete&&img.naturalWidth>0;},null,{timeout:45000});
  const elapsed=Date.now()-t;
  const rec=await page.evaluate(before=>{
    const all=FPRuntime169.loading.report().records.slice(before);
    const viewer=[...all].reverse().find(r=>r.kind==='viewer'&&r.consumer==='gallery-current')||null;
    const media=[...all].reverse().find(r=>r.kind==='media'&&r.consumer==='gallery-current')||null;
    return{viewer,media};
  },before);
  await page.locator('.media-viewer-close').click();
  return{
    photoOpenMs:elapsed,
    cache:rec.media?.cache||null,
    queueMs:round(rec.media?.stagesMs?.queue),
    cacheMs:round(rec.media?.stagesMs?.cache),
    networkMs:round(rec.media?.stagesMs?.network),
    bodyMs:round(rec.media?.stagesMs?.body),
    bufferMs:round(rec.media?.stagesMs?.buffer),
    decryptMs:round(rec.media?.stagesMs?.decrypt),
    elementMs:round(rec.viewer?.stagesMs?.element??rec.media?.stagesMs?.element)
  };
}
async function reloadIntoRoom(page,roomId){
  await page.reload({waitUntil:'domcontentloaded'});
  await waitBoot(page);
  await page.evaluate(async roomId=>{await openChat(roomId);},roomId);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function savedStartupSamples(page,profile){
  const rows=[];
  for(let i=0;i<SAMPLES;i++){
    await configureNetwork(page,profile);
    await page.evaluate(()=>localStorage.setItem('fpchat:app-build','190.2'));
    const t=Date.now();
    await page.reload({waitUntil:'domcontentloaded'});
    await waitBoot(page,60000);
    rows.push({
      totalMs:Date.now()-t,
      bootReadyMs:round(await page.evaluate(()=>window.__fpBootReady169At)),
      assetCompleted:await page.evaluate(()=>FPBoot152.timings186().completed['assets-end'])
    });
  }
  return rows;
}
async function updateStartupSamples(page,profile){
  const rows=[];
  for(let i=0;i<SAMPLES;i++){
    await configureNetwork(page,profile);
    await page.evaluate(()=>localStorage.setItem('fpchat:app-build','190.1'));
    const t=Date.now();
    await page.reload({waitUntil:'domcontentloaded'}).catch(()=>{});
    await page.waitForFunction(()=>localStorage.getItem('fpchat:app-build')==='190.2'&&window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:90000});
    rows.push({
      totalMs:Date.now()-t,
      finalBootReadyMs:round(await page.evaluate(()=>window.__fpBootReady169At))
    });
  }
  return rows;
}

run(async({browser,newClient,temp,root,errors})=>{
  const page=await newClient();
  const browserVersion=browser.version();
  const runner={
    platform:process.platform,arch:process.arch,node:process.version,
    cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model||null,totalMemoryBytes:os.totalmem()
  };
  const version=await page.evaluate(()=>fetch('/version.json',{cache:'no-store'}).then(r=>r.json()));
  const fixtures=[];
  for(const [label,count] of [['small',30],['medium',1000],['large',10000]]){
    const f=await createRoom(page,label);
    fixtures.push({...f,count,incoming:false,encrypted:[f.encrypted]});
  }
  const seeded=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/seed-history174.cjs')],{
    input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures}),encoding:'utf8'
  }));
  const byLabel=Object.fromEntries(fixtures.map((f,i)=>[f.roomId,{...f,...seeded[i]}]));
  const named={
    small:{...byLabel[fixtures[0].roomId],label:'small'},
    medium:{...byLabel[fixtures[1].roomId],label:'medium'},
    large:{...byLabel[fixtures[2].roomId],label:'large'}
  };

  const report={
    schema:1,
    runtimeBaselineSha:process.env.FPCHAT_RUNTIME_BASE_SHA||null,
    measurementHarnessSha:process.env.GITHUB_SHA||null,
    build:String(version.build||''),
    collectedAt:new Date().toISOString(),
    environment:{
      browser:'Chromium '+browserVersion,
      runner,
      viewport:'1100x760 desktop Chromium automation',
      physicalDevice:false,
      server:'local server.js on 127.0.0.1 with isolated temporary SQLite',
      data:'one fixed 30-message room, one fixed 1000-message room, one fixed 10000-message room; same encrypted payload repeated by isolated seed helper',
      network:{
        normal:'Chromium default localhost network; no added latency/bandwidth shaping',
        throttled:'CDP Network.emulateNetworkConditions: latency=200 ms, downloadThroughput=125000 B/s (~1 Mbit/s), uploadThroughput=62500 B/s (~0.5 Mbit/s), connectionType=cellular3g. Applied in Chromium network stack, not OS/server.',
        outage:'BrowserContext.setOffline(true) for 10000 ms, then setOffline(false); requested CDP profile is re-applied after recovery.'
      },
      cachePolicy:'localStorage/identity/site data are never cleared. Repeated passes retain normal browser/managed caches. Cold-media samples clear only FPStorage167 image media cache through its public owner API.'
    },
    fixtures:{small:30,medium:1000,large:10000},
    samplesPerScenario:SAMPLES,
    raw:{},
    summary:{},
    loadingExports:[],
    notes:[
      'visible-frame and paint-opportunity are frame opportunities, not hardware paint timestamps.',
      'Chromium automation is not physical iPhone/Android acceptance.',
      'CDP throughput/latency is authoritative for Chromium HTTP traffic; WebSocket frame timing may not match a real radio link exactly.',
      'No p95 is reported for 5-sample groups; p95 is only computed when n >= 20 using nearest-rank ceil(0.95*n).'
    ]
  };

  console.log('STEP4_PHASE startup-saved');
  // Startup with persisted room/access data.
  for(const profile of ['normal','throttled']){
    report.raw['startupSaved.'+profile]=await savedStartupSamples(page,profile);
    report.summary['startupSaved.'+profile]=summarizeSamples(report.raw['startupSaved.'+profile],['totalMs','bootReadyMs']);
  }

  console.log('STEP4_PHASE startup-after-update');
  // Actual first-launch-after-update path; local access remains, caches may be invalidated by the real updater path.
  for(const profile of ['normal','throttled']){
    report.raw['startupAfterUpdate.'+profile]=await updateStartupSamples(page,profile);
    report.summary['startupAfterUpdate.'+profile]=summarizeSamples(report.raw['startupAfterUpdate.'+profile],['totalMs','finalBootReadyMs']);
  }

  await configureNetwork(page,'normal');
  await uploadPhotoFixture(page,root,named.medium.roomId);

  for(const profile of ['normal','throttled']){
    console.log('STEP4_PHASE actions-'+profile);
    await configureNetwork(page,profile);

    // Open each fixed chat five times. Do not mix chat sizes in one statistic.
    for(const key of ['small','medium','large']){
      await page.evaluate(()=>FPRuntime169.loading.reset());
      const rows=[];
      for(let i=0;i<SAMPLES;i++)rows.push(await openMeasured(page,named[key].roomId));
      report.raw['open.'+key+'.'+profile]=rows;
      report.summary['open.'+key+'.'+profile]=summarizeSamples(rows,['openMs','keyMs','joinMs','historyMs','renderTextMs','layoutMs','revealFrameMs','mounted','domNodes']);
      if(key==='medium')report.loadingExports.push(await exportLoading(page,'loading-open-medium-'+profile));
    }

    // History page load caused by a real scroll event; medium and large remain separate.
    for(const key of ['medium','large']){
      const rows=[];
      for(let i=0;i<SAMPLES;i++)rows.push(await scrollOlderMeasured(page,named[key]));
      report.raw['scrollOlder.'+key+'.'+profile]=rows;
      report.summary['scrollOlder.'+key+'.'+profile]=summarizeSamples(rows,['scrollLoadMs','mounted','domNodes']);
    }

    // Work on one fixed 1000-message chat for reaction/send/media/background/outage.
    // Reload between scenario families so navigation-stress RAM state is not mixed into send/WS timing.
    await reloadIntoRoom(page,named.medium.roomId);
    await configureNetwork(page,profile);
    await waitWs(page);

    const reactionRows=[];
    for(let i=0;i<SAMPLES;i++)reactionRows.push(await reactionMeasured(page));
    report.raw['reaction.medium.'+profile]=reactionRows;
    report.summary['reaction.medium.'+profile]=summarizeSamples(reactionRows,['reactionOptimisticMs','reactionAckMs']);

    const sendRows=[];
    for(let i=0;i<SAMPLES;i++)sendRows.push(await sendMeasured(page,profile+'-'+i));
    report.raw['send.medium.'+profile]=sendRows;
    report.summary['send.medium.'+profile]={
      ...summarizeSamples(sendRows,['sendOptimisticMs','sendAckMs']),
      optimisticObserved:sendRows.filter(r=>r.optimisticObserved===true).length,
      ackObserved:sendRows.filter(r=>r.ackObserved===true).length,
      failures:sendRows.filter(r=>r.failureStage).reduce((acc,r)=>{acc[r.failureStage]=(acc[r.failureStage]||0)+1;return acc;},{})
    };

    const bgRows=[];
    for(let i=0;i<SAMPLES;i++)bgRows.push(await backgroundMeasured(page,browser));
    report.raw['background.medium.'+profile]=bgRows;
    report.summary['background.medium.'+profile]=summarizeSamples(bgRows,['backgroundResumeMs']);

    // Cold original photo: clear only managed image cache before each identical run.
    await page.evaluate(()=>FPRuntime169.loading.reset());
    const coldRows=[];
    for(let i=0;i<SAMPLES;i++){
      await reloadIntoRoom(page,named.medium.roomId);
      await configureNetwork(page,profile);
      coldRows.push(await photoMeasured(page,{cold:true}));
    }
    report.raw['photoCold.medium.'+profile]=coldRows;
    report.summary['photoCold.medium.'+profile]=summarizeSamples(coldRows,['photoOpenMs','queueMs','cacheMs','networkMs','bodyMs','bufferMs','decryptMs','elementMs']);
    report.loadingExports.push(await exportLoading(page,'loading-photo-cold-'+profile));

    // Prime original once, then reload between samples to drop JS/RAM viewer state while preserving CacheStorage/site data.
    await reloadIntoRoom(page,named.medium.roomId);
    await configureNetwork(page,profile);
    await photoMeasured(page,{cold:false});
    await page.evaluate(()=>FPRuntime169.loading.reset());
    const warmRows=[];
    for(let i=0;i<SAMPLES;i++){
      await reloadIntoRoom(page,named.medium.roomId);
      await configureNetwork(page,profile);
      warmRows.push(await photoMeasured(page,{cold:false}));
    }
    report.raw['photoWarmDisk.medium.'+profile]=warmRows;
    report.summary['photoWarmDisk.medium.'+profile]=summarizeSamples(warmRows,['photoOpenMs','queueMs','cacheMs','networkMs','bodyMs','bufferMs','decryptMs','elementMs']);
    report.loadingExports.push(await exportLoading(page,'loading-photo-warm-'+profile));

    await reloadIntoRoom(page,named.medium.roomId);
    await configureNetwork(page,profile);
    await waitWs(page);
    const outageRows=[];
    for(let i=0;i<SAMPLES;i++)outageRows.push(await outageMeasured(page,profile));
    report.raw['outage10s.medium.'+profile]=outageRows;
    report.summary['outage10s.medium.'+profile]=summarizeSamples(outageRows,['outageMs','reconnectMs']);
  }

  // Verify no accidental private fixture material in the loading exports.
  for(const item of report.loadingExports){
    const body=fs.readFileSync(path.join(OUT,item.file),'utf8');
    for(const fixture of fixtures){
      if(body.includes(fixture.roomId)||body.includes(fixture.deviceId)||body.includes(fixture.secret))throw Error('private fixture leaked into '+item.file);
    }
    if(!body.includes('"build": "190.2"')&&!body.includes('"build":"190.2"'))throw Error('wrong build in '+item.file);
  }

  report.browserErrors=errors;
  fs.writeFileSync(path.join(OUT,'step4-summary.json'),JSON.stringify(report,null,2)+'\n');
  console.log('STEP4_RESULT '+JSON.stringify(report));
  if(errors.length)process.exitCode=1;
}).catch(error=>{console.error(error);process.exitCode=1;});
