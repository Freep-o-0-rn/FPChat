'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const OUT=path.resolve(process.env.FPCHAT_NEXT6_OUTPUT||path.join(process.cwd(),'next6-output'));
fs.mkdirSync(OUT,{recursive:true});
const round=n=>Number.isFinite(Number(n))?Math.round(Number(n)*10)/10:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const isStatic=url=>{
  try{
    const p=new URL(url).pathname.toLowerCase();
    return p.endsWith('.js')||p.endsWith('.css');
  }catch{return false;}
};
const lowerHeaders=headers=>{
  const out={};
  for(const [k,v] of Object.entries(headers||{}))out[String(k).toLowerCase()]=String(v);
  return out;
};

function networkConfig(profile){
  return profile==='slow'
    ? {offline:false,latency:200,downloadThroughput:125000,uploadThroughput:62500,connectionType:'cellular3g'}
    : {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'wifi'};
}

async function setPageNetwork(page,profile){
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',networkConfig(profile));
  return cdp;
}

async function attachServiceWorker(browser,origin,profile){
  const root=await browser.newBrowserCDPSession();
  await root.send('Target.setDiscoverTargets',{discover:true});
  let target=null;
  for(let i=0;i<80;i++){
    const {targetInfos}=await root.send('Target.getTargets');
    target=targetInfos.find(t=>t.type==='service_worker'&&t.url.startsWith(origin+'/sw.js'));
    if(target)break;
    await sleep(50);
  }
  if(!target)return null;
  const {sessionId}=await root.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
  let seq=0;
  const pending=new Map();
  root.on('Target.receivedMessageFromTarget',event=>{
    if(event.sessionId!==sessionId)return;
    const msg=JSON.parse(event.message);
    if(msg.id&&pending.has(msg.id)){
      const item=pending.get(msg.id);pending.delete(msg.id);
      if(msg.error)item.reject(new Error(msg.error.message||'worker CDP command failed'));else item.resolve(msg.result||{});
    }
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject});
    root.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(error=>{
      pending.delete(id);reject(error);
    });
  });
  await send('Network.enable');
  await send('Network.emulateNetworkConditions',networkConfig(profile));
  return{root,sessionId,send};
}

function startStaticTrace(cdp,origin){
  const reqs=new Map();
  const events=[];
  const ensure=id=>{
    if(!reqs.has(id)){const x={requestId:id};reqs.set(id,x);events.push(x);}
    return reqs.get(id);
  };
  cdp.on('Network.requestWillBeSent',e=>{
    if(!e.request?.url?.startsWith(origin)||!isStatic(e.request.url))return;
    const u=new URL(e.request.url);
    const x=ensure(e.requestId);
    Object.assign(x,{
      url:u.pathname+u.search,path:u.pathname,query:u.search,
      method:e.request.method,type:e.type||null,startTs:e.timestamp,
      requestHeaders:lowerHeaders(e.request.headers||{}),
      initiatorType:e.initiator?.type||null
    });
  });
  cdp.on('Network.requestWillBeSentExtraInfo',e=>{
    const x=reqs.get(e.requestId);if(!x)return;
    x.requestHeadersExtra=lowerHeaders(e.headers||{});
  });
  cdp.on('Network.responseReceived',e=>{
    const x=reqs.get(e.requestId);if(!x)return;
    const h=lowerHeaders(e.response.headers||{});
    Object.assign(x,{
      logicalStatus:e.response.status,
      mimeType:e.response.mimeType||null,
      protocol:e.response.protocol||null,
      fromDiskCache:Boolean(e.response.fromDiskCache),
      fromServiceWorker:Boolean(e.response.fromServiceWorker),
      fromPrefetchCache:Boolean(e.response.fromPrefetchCache),
      responseTs:e.timestamp,
      responseHeaders:h,
      responseEncodedDataLength:round(e.response.encodedDataLength||0)
    });
  });
  cdp.on('Network.responseReceivedExtraInfo',e=>{
    const x=reqs.get(e.requestId);if(!x)return;
    x.networkStatus=e.statusCode;
    x.responseHeadersExtra=lowerHeaders(e.headers||{});
  });
  cdp.on('Network.requestServedFromCache',e=>{
    const x=reqs.get(e.requestId);if(x)x.servedFromCache=true;
  });
  cdp.on('Network.loadingFinished',e=>{
    const x=reqs.get(e.requestId);if(!x)return;
    x.endTs=e.timestamp;x.encodedDataLength=round(e.encodedDataLength||0);
  });
  cdp.on('Network.loadingFailed',e=>{
    const x=reqs.get(e.requestId);if(!x)return;
    x.endTs=e.timestamp;x.failed=true;x.errorText=e.errorText||null;
  });
  return{events,stop:async()=>{try{await cdp.send('Network.disable');}catch{}}};
}

function normalize(events){
  if(!events.length)return[];
  const t0=Math.min(...events.map(e=>e.startTs).filter(Number.isFinite));
  return events.filter(e=>e.path).map(e=>{
    const req={...(e.requestHeaders||{}),...(e.requestHeadersExtra||{})};
    const res={...(e.responseHeaders||{}),...(e.responseHeadersExtra||{})};
    return{
      url:e.url,path:e.path,query:e.query,type:e.type,
      startMs:round((e.startTs-t0)*1000),
      headersMs:e.responseTs?round((e.responseTs-e.startTs)*1000):null,
      durationMs:e.endTs?round((e.endTs-e.startTs)*1000):null,
      logicalStatus:e.logicalStatus??null,
      networkStatus:e.networkStatus??null,
      encodedBytes:e.encodedDataLength??null,
      cacheControl:res['cache-control']||null,
      etag:res.etag||null,
      lastModified:res['last-modified']||null,
      age:res.age||null,
      ifNoneMatch:req['if-none-match']||null,
      ifModifiedSince:req['if-modified-since']||null,
      requestCacheControl:req['cache-control']||null,
      fromDiskCache:Boolean(e.fromDiskCache),
      servedFromCache:Boolean(e.servedFromCache),
      fromServiceWorker:Boolean(e.fromServiceWorker),
      fromPrefetchCache:Boolean(e.fromPrefetchCache),
      protocol:e.protocol||null,
      initiatorType:e.initiatorType||null,
      failed:Boolean(e.failed)
    };
  });
}

function summarize(requests){
  const total=requests.reduce((a,r)=>a+(Number(r.encodedBytes)||0),0);
  return{
    count:requests.length,
    encodedBytes:total,
    encodedKiB:round(total/1024),
    network304Count:requests.filter(r=>r.networkStatus===304).length,
    logical200Network304Count:requests.filter(r=>r.logicalStatus===200&&r.networkStatus===304).length,
    conditionalCount:requests.filter(r=>r.ifNoneMatch||r.ifModifiedSince).length,
    diskCacheCount:requests.filter(r=>r.fromDiskCache).length,
    servedFromCacheCount:requests.filter(r=>r.servedFromCache).length,
    serviceWorkerCount:requests.filter(r=>r.fromServiceWorker).length,
    withEtagCount:requests.filter(r=>r.etag).length,
    cacheControls:[...new Set(requests.map(r=>r.cacheControl).filter(Boolean))],
    slowest:[...requests].sort((a,b)=>(b.durationMs||0)-(a.durationMs||0)).slice(0,12).map(r=>({
      path:r.path,url:r.url,durationMs:r.durationMs,headersMs:r.headersMs,
      logicalStatus:r.logicalStatus,networkStatus:r.networkStatus,encodedBytes:r.encodedBytes,
      cacheControl:r.cacheControl,etag:r.etag,ifNoneMatch:r.ifNoneMatch,
      fromDiskCache:r.fromDiskCache,servedFromCache:r.servedFromCache
    }))
  };
}

async function waitReady(page){
  await page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:90000});
}

async function captureNavigation({page,cdp,origin,profile,kind,navigate}){
  const trace=startStaticTrace(cdp,origin);
  const started=Date.now();
  await navigate();
  await waitReady(page);
  await sleep(100);
  const wallMs=Date.now()-started;
  const boot=await page.evaluate(()=>window.FPBoot152?.timings186?.()||null);
  const requests=normalize(trace.events);
  await trace.stop();
  return{profile,kind,wallMs,boot,requests,summary:summarize(requests)};
}

run(async({browser,origin,errors})=>{
  const report={
    schema:1,
    build:'190.2',
    runtimeSha:process.env.FPCHAT_RUNTIME_SHA||null,
    measuredAt:new Date().toISOString(),
    note:'localhost Chromium diagnostic only; no production cache policy inference',
    scenarios:[]
  };

  for(const profile of ['normal','slow']){
    const context=await browser.newContext({viewport:{width:1100,height:760}});

    // Prime this browser context and its normal HTTP cache + SW state.
    let prime=await context.newPage();
    prime.on('pageerror',e=>errors.push(e.message));
    prime.on('dialog',d=>d.dismiss());
    let primeCdp=await setPageNetwork(prime,profile);
    await prime.goto(origin,{waitUntil:'domcontentloaded'});
    await waitReady(prime);
    await prime.evaluate(async()=>{if('serviceWorker'in navigator){try{await navigator.serviceWorker.ready;}catch{}}});
    await attachServiceWorker(browser,origin,profile);
    await sleep(100);
    await prime.close();
    try{await primeCdp.detach();}catch{}

    // Ordinary opening: a new page in the same persisted browser context.
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.dismiss());
    const openCdp=await setPageNetwork(page,profile);
    const ordinary=await captureNavigation({
      page,cdp:openCdp,origin,profile,kind:'ordinary-open',
      navigate:()=>page.goto(origin,{waitUntil:'domcontentloaded'})
    });
    report.scenarios.push(ordinary);

    // Explicit reload of the already-open page, preserving site data/cache.
    const reloadCdp=await setPageNetwork(page,profile);
    const reload=await captureNavigation({
      page,cdp:reloadCdp,origin,profile,kind:'reload',
      navigate:()=>page.reload({waitUntil:'domcontentloaded'})
    });
    report.scenarios.push(reload);

    await context.close();
  }

  report.errors=errors;
  fs.writeFileSync(path.join(OUT,'next6-static-cache.json'),JSON.stringify(report,null,2)+'\n');
  console.log('NEXT6_RESULT '+JSON.stringify(report));
  if(errors.length)process.exitCode=1;
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
