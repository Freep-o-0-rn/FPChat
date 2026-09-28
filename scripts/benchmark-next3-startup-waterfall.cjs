'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const OUT=path.resolve(process.env.FPCHAT_NEXT3_OUTPUT||path.join(process.cwd(),'next3-output'));
fs.mkdirSync(OUT,{recursive:true});
const round=n=>Number.isFinite(Number(n))?Math.round(Number(n)*10)/10:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function setNetwork(page,profile){
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const cfg=profile==='slow'
    ? {offline:false,latency:200,downloadThroughput:125000,uploadThroughput:62500,connectionType:'cellular3g'}
    : {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'wifi'};
  await cdp.send('Network.emulateNetworkConditions',cfg);
  return cdp;
}

async function installBootSnapshotter(page){
  await page.addInitScript(()=>{
    const KEY='fpchat:next3:boot-snapshots';
    const navId=(Number(sessionStorage.getItem('fpchat:next3:nav-seq')||'0')+1);
    sessionStorage.setItem('fpchat:next3:nav-seq',String(navId));
    let last=null;
    const capture=()=>{
      try{
        if(window.FPBoot152?.timings186){
          last={navId,url:location.pathname,at:performance.now(),boot:window.FPBoot152.timings186()};
          sessionStorage.setItem('fpchat:next3:last',JSON.stringify(last));
        }
      }catch{}
    };
    const timer=setInterval(capture,5);
    window.addEventListener('pagehide',()=>{
      capture();
      clearInterval(timer);
      try{
        const list=JSON.parse(sessionStorage.getItem(KEY)||'[]');
        list.push(last||{navId,url:location.pathname,at:performance.now(),boot:null});
        sessionStorage.setItem(KEY,JSON.stringify(list.slice(-12)));
      }catch{}
    },{once:true});
    window.addEventListener('fpchat:boot-ready',()=>{
      capture();
      try{
        const list=JSON.parse(sessionStorage.getItem(KEY)||'[]');
        list.push(last);
        sessionStorage.setItem(KEY,JSON.stringify(list.slice(-12)));
      }catch{}
    },{once:true});
  });
}

function startNetworkTrace(cdp,origin){
  const reqs=new Map();
  const events=[];
  cdp.on('Network.requestWillBeSent',e=>{
    if(!e.request?.url?.startsWith(origin))return;
    const u=new URL(e.request.url);
    const item={
      requestId:e.requestId,loaderId:e.loaderId,url:u.pathname+u.search,path:u.pathname,
      method:e.request.method,type:e.type||null,startTs:e.timestamp,
      initiatorType:e.initiator?.type||null,
      requestHeaders:e.request.headers||{}
    };
    reqs.set(e.requestId,item);events.push(item);
  });
  cdp.on('Network.responseReceived',e=>{
    const item=reqs.get(e.requestId);if(!item)return;
    item.status=e.response.status;
    item.mimeType=e.response.mimeType||null;
    item.protocol=e.response.protocol||null;
    item.fromDiskCache=Boolean(e.response.fromDiskCache);
    item.fromServiceWorker=Boolean(e.response.fromServiceWorker);
    item.fromPrefetchCache=Boolean(e.response.fromPrefetchCache);
    item.responseTs=e.timestamp;
    item.responseEncodedDataLength=round(e.response.encodedDataLength||0);
  });
  cdp.on('Network.loadingFinished',e=>{
    const item=reqs.get(e.requestId);if(!item)return;
    item.endTs=e.timestamp;
    item.encodedDataLength=round(e.encodedDataLength||0);
  });
  cdp.on('Network.loadingFailed',e=>{
    const item=reqs.get(e.requestId);if(!item)return;
    item.endTs=e.timestamp;item.failed=true;item.errorText=e.errorText||null;
  });
  return {events,stop:async()=>{try{await cdp.send('Network.disable');}catch{}}};
}

function normalizeNetwork(events){
  if(!events.length)return[];
  const t0=Math.min(...events.map(x=>x.startTs));
  return events.map(x=>({
    url:x.url,path:x.path,method:x.method,type:x.type,
    startMs:round((x.startTs-t0)*1000),
    responseMs:x.responseTs?round((x.responseTs-t0)*1000):null,
    endMs:x.endTs?round((x.endTs-t0)*1000):null,
    durationMs:x.endTs?round((x.endTs-x.startTs)*1000):null,
    encodedDataLength:x.encodedDataLength??null,
    status:x.status??null,
    fromDiskCache:Boolean(x.fromDiskCache),
    fromServiceWorker:Boolean(x.fromServiceWorker),
    fromPrefetchCache:Boolean(x.fromPrefetchCache),
    initiatorType:x.initiatorType||null,
    failed:Boolean(x.failed)
  }));
}

function summarizeRequests(requests){
  const transferred=requests.reduce((a,r)=>a+(Number(r.encodedDataLength)||0),0);
  const version=requests.filter(r=>r.path==='/version.json');
  const scripts=requests.filter(r=>r.type==='Script');
  const styles=requests.filter(r=>r.type==='Stylesheet');
  return{
    count:requests.length,
    encodedBytes:transferred,
    encodedKiB:round(transferred/1024),
    diskCacheCount:requests.filter(r=>r.fromDiskCache).length,
    serviceWorkerCount:requests.filter(r=>r.fromServiceWorker).length,
    prefetchCacheCount:requests.filter(r=>r.fromPrefetchCache).length,
    scriptCount:scripts.length,styleCount:styles.length,
    versionCount:version.length,
    versionRequests:version.map((r,i)=>({
      ordinal:i+1,startMs:r.startMs,durationMs:r.durationMs,encodedDataLength:r.encodedDataLength,
      fromDiskCache:r.fromDiskCache,fromServiceWorker:r.fromServiceWorker,status:r.status
    })),
    secondVersionStartDelayMs:version.length>=2?round(version[1].startMs-version[0].startMs):null,
    secondVersionDurationMs:version.length>=2?version[1].durationMs:null
  };
}

function bootDurations(boot){
  const p=boot?.points||{};
  const d=(a,b)=>Number.isFinite(p[a])&&Number.isFinite(p[b])?round(p[b]-p[a]):null;
  return{
    loaderToBootReadyMs:Number.isFinite(p['boot-ready'])&&Number.isFinite(p['loader-start'])?round(p['boot-ready']-p['loader-start']):null,
    versionMs:d('version-start','version-ready'),
    versionReadyToOwnersReadyMs:d('version-ready','owners-ready'),
    serviceWorkerMs:d('service-worker-start','service-worker-ready'),
    secondVersionGateMs:d('update-start','update-ready'),
    coreWaitMs:d('core-wait-start','core-wait-end'),
    layersMs:d('layers-start','layers-end'),
    assetsMs:d('assets-start','assets-end')
  };
}

async function createFixture(page,label){
  return page.evaluate(async label=>{
    const deviceId=getOrCreateDeviceId();
    const secret='next3-'+label;
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const res=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      displayName:state.nick,deviceId,roomSecret:secret,...recovery
    })});
    if(!res.ok)throw new Error('fixture room '+res.status);
    const data=await res.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    return{roomId:data.publicId};
  },label);
}

async function waitReady(page,timeout=90000){
  await page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout});
}

async function readLatestBoot(page){
  return page.evaluate(()=>{
    const current=window.FPBoot152?.timings186?.()||null;
    let saved=[];try{saved=JSON.parse(sessionStorage.getItem('fpchat:next3:boot-snapshots')||'[]');}catch{}
    let last=null;try{last=JSON.parse(sessionStorage.getItem('fpchat:next3:last')||'null');}catch{}
    return{current,saved,last,navSeq:Number(sessionStorage.getItem('fpchat:next3:nav-seq')||'0')};
  });
}

async function traceSaved(page,cdp,origin,profile){
  await page.evaluate(()=>localStorage.setItem('fpchat:app-build','190.2'));
  const trace=startNetworkTrace(cdp,origin);
  const wall=Date.now();
  await page.reload({waitUntil:'domcontentloaded'});
  await waitReady(page);
  await sleep(100);
  const wallMs=Date.now()-wall;
  const boot=await readLatestBoot(page);
  const requests=normalizeNetwork(trace.events);
  await trace.stop();
  return{
    profile,kind:'saved-data',wallMs,
    boot:boot.current,durations:bootDurations(boot.current),
    requests,requestSummary:summarizeRequests(requests),
    navigationCount:1
  };
}

async function traceUpdate(page,cdp,origin,profile){
  await page.evaluate(()=>{
    localStorage.setItem('fpchat:app-build','190.1');
    sessionStorage.removeItem('fpchat:update-reloading');
    sessionStorage.setItem('fpchat:next3:boot-snapshots','[]');
  });
  const beforeSeq=await page.evaluate(()=>Number(sessionStorage.getItem('fpchat:next3:nav-seq')||'0'));
  const trace=startNetworkTrace(cdp,origin);
  const wall=Date.now();
  await page.reload({waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForFunction(before=>Number(sessionStorage.getItem('fpchat:next3:nav-seq')||'0')>=before+2,beforeSeq,{timeout:90000});
  await waitReady(page,90000);
  await sleep(150);
  const wallMs=Date.now()-wall;
  const boots=await readLatestBoot(page);
  const requests=normalizeNetwork(trace.events);
  await trace.stop();
  return{
    profile,kind:'after-update',wallMs,
    finalBoot:boots.current,finalDurations:bootDurations(boots.current),
    savedBootSnapshots:boots.saved,
    requests,requestSummary:summarizeRequests(requests),
    navigationCount:boots.navSeq-beforeSeq
  };
}

run(async({browser,origin,errors})=>{
  const report={
    schema:1,build:'190.2',
    runtimeSha:process.env.FPCHAT_RUNTIME_SHA||null,
    measuredAt:new Date().toISOString(),
    network:{
      normal:'no added latency/bandwidth limit; connectionType wifi',
      slow:'CDP Network.emulateNetworkConditions: latency 200 ms, download 125000 B/s (~1 Mbit/s), upload 62500 B/s (~0.5 Mbit/s), cellular3g'
    },
    scenarios:[]
  };

  for(const profile of ['normal','slow']){
    const context=await browser.newContext({viewport:{width:1100,height:760}});
    const page=await context.newPage();
    page.on('dialog',d=>d.dismiss());
    page.on('pageerror',e=>errors.push(e.message));
    await installBootSnapshotter(page);
    const cdp=await setNetwork(page,profile);

    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await waitReady(page);
    await createFixture(page,profile);
    await page.evaluate(()=>localStorage.setItem('fpchat:app-build','190.2'));
    await page.reload({waitUntil:'domcontentloaded'});
    await waitReady(page);
    await navigatorServiceWorkerReady(page);
    await sleep(100);

    report.scenarios.push(await traceSaved(page,cdp,origin,profile));
    // Network.disable in traceSaved; use a fresh CDP session/profile for update.
    const cdp2=await setNetwork(page,profile);
    report.scenarios.push(await traceUpdate(page,cdp2,origin,profile));

    await context.close();
  }

  report.errors=errors;
  fs.writeFileSync(path.join(OUT,'next3-startup-waterfall.json'),JSON.stringify(report,null,2)+'\n');
  console.log('NEXT3_RESULT '+JSON.stringify(report));
  if(errors.length)process.exitCode=1;
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});

async function navigatorServiceWorkerReady(page){
  await page.evaluate(async()=>{
    if(!('serviceWorker' in navigator))return;
    try{await Promise.race([navigator.serviceWorker.ready,new Promise(r=>setTimeout(r,5000))]);}catch{}
  });
}
