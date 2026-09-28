'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const OUT=path.resolve(process.env.FPCHAT_NEXT31_OUTPUT||path.join(process.cwd(),'next31-output'));
fs.mkdirSync(OUT,{recursive:true});
const round=n=>Number.isFinite(Number(n))?Math.round(Number(n)*10)/10:null;

async function pageNetwork(page,slow){
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',slow
    ? {offline:false,latency:200,downloadThroughput:125000,uploadThroughput:62500,connectionType:'cellular3g'}
    : {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'wifi'});
  return cdp;
}

async function attachWorker(browser,origin){
  const root=await browser.newBrowserCDPSession();
  await root.send('Target.setDiscoverTargets',{discover:true});
  let target=null;
  for(let i=0;i<80;i++){
    const {targetInfos}=await root.send('Target.getTargets');
    target=targetInfos.find(t=>t.type==='service_worker'&&t.url.startsWith(origin+'/sw.js'));
    if(target)break;
    await new Promise(r=>setTimeout(r,50));
  }
  if(!target)throw new Error('service worker target not found');
  const {sessionId}=await root.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
  let seq=0;
  const pending=new Map();
  const listeners=new Map();
  root.on('Target.receivedMessageFromTarget',event=>{
    if(event.sessionId!==sessionId)return;
    const msg=JSON.parse(event.message);
    if(msg.id&&pending.has(msg.id)){
      const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);
      if(msg.error)reject(new Error(msg.error.message||'CDP worker command failed'));else resolve(msg.result||{});
      return;
    }
    if(msg.method){
      for(const fn of listeners.get(msg.method)||[])fn(msg.params||{});
    }
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject});
    root.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(error=>{
      pending.delete(id);reject(error);
    });
  });
  const on=(method,fn)=>{const set=listeners.get(method)||new Set();set.add(fn);listeners.set(method,set);return()=>set.delete(fn);};
  await send('Network.enable');
  return{root,sessionId,targetId:target.targetId,send,on};
}

async function emulateWorker(worker,slow){
  await worker.send('Network.emulateNetworkConditions',slow
    ? {offline:false,latency:200,downloadThroughput:125000,uploadThroughput:62500,connectionType:'cellular3g'}
    : {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'wifi'});
}

async function fetchProbe(page,url,worker){
  let swReq=null,swResp=null,swFinish=null;
  const off1=worker?.on('Network.requestWillBeSent',e=>{if(e.request?.url===url)swReq=e;});
  const off2=worker?.on('Network.responseReceived',e=>{if(swReq&&e.requestId===swReq.requestId)swResp=e;});
  const off3=worker?.on('Network.loadingFinished',e=>{if(swReq&&e.requestId===swReq.requestId)swFinish=e;});
  const pageResult=await page.evaluate(async url=>{
    const start=performance.now();
    const response=await fetch(url,{cache:'no-store'});
    const body=await response.text();
    return{wallMs:performance.now()-start,status:response.status,bodyLength:body.length};
  },url);
  await new Promise(r=>setTimeout(r,80));
  off1?.();off2?.();off3?.();
  return{
    pageWallMs:round(pageResult.wallMs),
    status:pageResult.status,
    bodyLength:pageResult.bodyLength,
    workerObserved:Boolean(swReq&&swResp),
    workerDurationMs:swReq&&swFinish?round((swFinish.timestamp-swReq.timestamp)*1000):null,
    workerHeadersMs:swReq&&swResp?round((swResp.timestamp-swReq.timestamp)*1000):null,
    workerEncodedBytes:swFinish?round(swFinish.encodedDataLength||0):null,
    workerStatus:swResp?.response?.status??null,
    workerFromDiskCache:Boolean(swResp?.response?.fromDiskCache),
    workerProtocol:swResp?.response?.protocol||null,
    workerResponseUrl:swResp?.response?.url?new URL(swResp.response.url).pathname+new URL(swResp.response.url).search:null
  };
}

run(async({browser,origin,errors})=>{
  const report={schema:1,build:'190.2',runtimeSha:process.env.FPCHAT_RUNTIME_SHA||null,origin,probes:{}};

  // Keep the production SW behavior for the main diagnostic path.
  const context=await browser.newContext({viewport:{width:1100,height:760}});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.dismiss());
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'));
  await page.evaluate(async()=>{if('serviceWorker'in navigator)await navigator.serviceWorker.ready;});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>navigator.serviceWorker?.controller&&window.__fpBootReady169At&&!document.getElementById('bootHold152'));

  const pageCdp=await pageNetwork(page,true);
  const worker=await attachWorker(browser,origin);

  // 1) Reproduce item-3 coverage: page target throttled, worker target not throttled.
  await emulateWorker(worker,false);
  report.probes.pageOnlyThrottle=await fetchProbe(page,origin+'/version.json?probe=next31-page-only-'+Date.now(),worker);

  // 2) Correct coverage: both page and service-worker targets throttled.
  await emulateWorker(worker,true);
  report.probes.pageAndWorkerThrottle=await fetchProbe(page,origin+'/version.json?probe=next31-worker-'+Date.now(),worker);

  await context.close();

  // 3) Control with SW blocked: the same page-target throttle must affect direct network fetch.
  const control=await browser.newContext({viewport:{width:1100,height:760},serviceWorkers:'block'});
  const controlPage=await control.newPage();
  controlPage.on('pageerror',e=>errors.push(e.message));
  const controlCdp=await pageNetwork(controlPage,true);
  await controlPage.goto(origin,{waitUntil:'domcontentloaded'});
  const controlUrl=origin+'/version.json?probe=next31-control-'+Date.now();
  const direct=await controlPage.evaluate(async url=>{
    const start=performance.now();
    const response=await fetch(url,{cache:'no-store'});
    const body=await response.text();
    return{wallMs:performance.now()-start,status:response.status,bodyLength:body.length,controlled:Boolean(navigator.serviceWorker?.controller)};
  },controlUrl);
  report.probes.noServiceWorkerControl={
    pageWallMs:round(direct.wallMs),status:direct.status,bodyLength:direct.bodyLength,controlled:direct.controlled
  };
  await control.close();

  report.coverageGap=Boolean(
    report.probes.pageOnlyThrottle.pageWallMs<100 &&
    report.probes.pageAndWorkerThrottle.pageWallMs>=180 &&
    report.probes.noServiceWorkerControl.pageWallMs>=180
  );
  report.serverReachEvidence={
    pageOnlyWorkerRequestObserved:report.probes.pageOnlyThrottle.workerObserved,
    workerThrottleRequestObserved:report.probes.pageAndWorkerThrottle.workerObserved,
    uniqueWorkerResponseUrl:report.probes.pageAndWorkerThrottle.workerResponseUrl,
    workerStatus:report.probes.pageAndWorkerThrottle.workerStatus,
    workerEncodedBytes:report.probes.pageAndWorkerThrottle.workerEncodedBytes
  };
  report.errors=errors;
  fs.writeFileSync(path.join(OUT,'next31-sw-coverage.json'),JSON.stringify(report,null,2)+'\n');
  console.log('NEXT31_RESULT '+JSON.stringify(report));
  if(errors.length)process.exitCode=1;
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
