'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const SAMPLES=5;
const OUT=path.resolve(process.env.FPCHAT_NEXT15_OUTPUT||path.join(process.cwd(),'next15-output'));
fs.mkdirSync(OUT,{recursive:true});

const round=value=>value===null||value===undefined||!Number.isFinite(Number(value))
  ? null
  : Math.round(Number(value)*10)/10;

function stats(values){
  const clean=values.filter(value=>value!==null&&value!==undefined)
    .map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!clean.length)return{n:0,median:null,min:null,max:null,p95:null,p95Rule:'not calculated: no samples'};
  const median=clean.length%2
    ? clean[(clean.length-1)/2]
    : (clean[clean.length/2-1]+clean[clean.length/2])/2;
  return{
    n:clean.length,
    median:round(median),
    min:round(clean[0]),
    max:round(clean.at(-1)),
    p95:null,
    p95Rule:'not calculated for n < 20'
  };
}

async function waitBoot(page,timeout=60000){
  await page.waitForFunction(
    ()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),
    null,{timeout}
  );
}

async function configureNetwork(session,profile){
  await session.send('Network.enable');
  if(profile==='throttled'){
    await session.send('Network.emulateNetworkConditions',{
      offline:false,
      latency:200,
      downloadThroughput:125000,
      uploadThroughput:62500,
      connectionType:'cellular3g'
    });
    return;
  }
  await session.send('Network.emulateNetworkConditions',{
    offline:false,
    latency:0,
    downloadThroughput:-1,
    uploadThroughput:-1,
    connectionType:'wifi'
  });
}

function mediaEndpoint(url){
  let pathname='';
  try{pathname=new URL(url).pathname;}catch{return null;}
  if(!pathname.startsWith('/api/media/'))return null;
  if(pathname.endsWith('/thumb'))return'preview';
  if(pathname.endsWith('/blob'))return'original';
  return null;
}

function attachMediaNetworkObserver(session){
  const requests=new Map();
  const finished=[];
  session.on('Network.requestWillBeSent',event=>{
    const endpoint=mediaEndpoint(event.request?.url||'');
    if(!endpoint)return;
    requests.set(event.requestId,{
      endpoint,
      servedFromCache:false,
      fromDiskCache:false,
      fromServiceWorker:false,
      responseStatus:null,
      extraStatusCode:null,
      encodedBytes:null
    });
  });
  session.on('Network.requestServedFromCache',event=>{
    const row=requests.get(event.requestId);
    if(row)row.servedFromCache=true;
  });
  session.on('Network.responseReceived',event=>{
    const row=requests.get(event.requestId);
    if(!row)return;
    row.responseStatus=Number(event.response?.status)||null;
    row.fromDiskCache=event.response?.fromDiskCache===true;
    row.fromServiceWorker=event.response?.fromServiceWorker===true;
  });
  session.on('Network.responseReceivedExtraInfo',event=>{
    const row=requests.get(event.requestId);
    if(row)row.extraStatusCode=Number(event.statusCode)||null;
  });
  session.on('Network.loadingFinished',event=>{
    const row=requests.get(event.requestId);
    if(!row)return;
    row.encodedBytes=Number.isFinite(Number(event.encodedDataLength))
      ? Math.round(Number(event.encodedDataLength))
      : null;
    finished.push({...row});
    requests.delete(event.requestId);
  });
  session.on('Network.loadingFailed',event=>{
    const row=requests.get(event.requestId);
    if(!row)return;
    finished.push({...row,failed:true});
    requests.delete(event.requestId);
  });
  return{
    reset(){requests.clear();finished.length=0;},
    snapshot(){return finished.map(row=>({...row}));}
  };
}

function summarizeNetwork(rows,endpoint){
  const items=rows.filter(row=>row.endpoint===endpoint);
  return{
    requests:items.length,
    servedFromCache:items.filter(row=>row.servedFromCache).length,
    fromDiskCache:items.filter(row=>row.fromDiskCache).length,
    fromServiceWorker:items.filter(row=>row.fromServiceWorker).length,
    statusCodes:[...new Set(items.map(row=>row.extraStatusCode||row.responseStatus).filter(Boolean))].sort((a,b)=>a-b),
    encodedBytes:items.reduce((sum,row)=>sum+(Number(row.encodedBytes)||0),0)
  };
}

async function resetPage(page,origin,session,profile){
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await waitBoot(page);
  await configureNetwork(session,profile);
  await page.evaluate(()=>{
    try{showChatsList();}catch{}
    window.FPRuntime169?.loading?.reset?.();
  });
}

async function identitySnapshot(page,roomId){
  return page.evaluate(roomId=>{
    const room=STORAGE.get(STORAGE.roomState(roomId))||null;
    return{
      deviceId:String(localStorage.getItem(STORAGE.deviceId)||''),
      roomDeviceId:String(room?.deviceId||''),
      secret:String(room?.secret||'')
    };
  },roomId);
}

function sameIdentity(left,right){
  return Boolean(left&&right
    &&left.deviceId===right.deviceId
    &&left.roomDeviceId===right.roomDeviceId
    &&left.secret===right.secret);
}

async function createRoom(page){
  return page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='next15-fixed-photo-room-secret';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        displayName:'Next14',
        deviceId,
        roomSecret:secret,
        ...recovery
      })
    });
    if(!response.ok)throw Error('next15 fixture room failed '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});
    upsertChat(data.publicId,{});
    return{roomId:data.publicId};
  });
}

async function generateFixedPhoto(page){
  const generated=await page.evaluate(async()=>{
    const width=4032,height=3024,quality=0.92;
    const canvas=document.createElement('canvas');
    canvas.width=width;
    canvas.height=height;
    const ctx=canvas.getContext('2d',{alpha:false});
    const image=ctx.createImageData(width,height);
    const data=image.data;
    let seed=0x14a0926d;
    const next=()=>{
      seed^=seed<<13;
      seed^=seed>>>17;
      seed^=seed<<5;
      return seed>>>0;
    };
    const horizon=Math.floor(height*0.58);
    let offset=0;
    for(let y=0;y<height;y++){
      const yn=y/height;
      for(let x=0;x<width;x++){
        const xn=x/width;
        const noise=((next()>>>24)-128)/12;
        let r,g,b;
        if(y<horizon){
          const t=y/horizon;
          r=65+110*t+18*xn;
          g=105+105*t+8*xn;
          b=165+72*t-18*xn;
        }else{
          const t=(y-horizon)/(height-horizon);
          r=78+38*t+18*xn;
          g=112+34*t-12*xn;
          b=70+22*t;
        }
        data[offset++]=Math.max(0,Math.min(255,r+noise));
        data[offset++]=Math.max(0,Math.min(255,g+noise));
        data[offset++]=Math.max(0,Math.min(255,b+noise));
        data[offset++]=255;
      }
    }
    ctx.putImageData(image,0,0);

    const sun=ctx.createRadialGradient(width*0.77,height*0.22,10,width*0.77,height*0.22,width*0.09);
    sun.addColorStop(0,'rgba(255,244,190,0.95)');
    sun.addColorStop(1,'rgba(255,244,190,0)');
    ctx.fillStyle=sun;
    ctx.fillRect(0,0,width,height);

    ctx.fillStyle='rgba(63,91,58,0.95)';
    ctx.beginPath();
    ctx.moveTo(0,height*0.70);
    ctx.lineTo(width*0.20,height*0.49);
    ctx.lineTo(width*0.37,height*0.66);
    ctx.lineTo(width*0.55,height*0.48);
    ctx.lineTo(width*0.76,height*0.68);
    ctx.lineTo(width,height*0.52);
    ctx.lineTo(width,height);
    ctx.lineTo(0,height);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle='rgba(88,88,82,0.92)';
    ctx.beginPath();
    ctx.moveTo(width*0.45,height);
    ctx.lineTo(width*0.53,height*0.58);
    ctx.lineTo(width*0.58,height*0.58);
    ctx.lineTo(width*0.72,height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle='rgba(238,223,167,0.9)';
    ctx.lineWidth=18;
    ctx.setLineDash([80,80]);
    ctx.beginPath();
    ctx.moveTo(width*0.585,height);
    ctx.lineTo(width*0.555,height*0.59);
    ctx.stroke();
    ctx.setLineDash([]);

    const blob=await new Promise((resolve,reject)=>{
      canvas.toBlob(value=>value?resolve(value):reject(Error('jpeg encode failed')),'image/jpeg',quality);
    });
    const bytes=new Uint8Array(await blob.arrayBuffer());
    let binary='';
    const chunk=0x8000;
    for(let i=0;i<bytes.length;i+=chunk){
      binary+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+chunk)));
    }
    return{
      width,
      height,
      quality,
      mime:blob.type,
      bytes:bytes.length,
      base64:btoa(binary)
    };
  });
  const buffer=Buffer.from(generated.base64,'base64');
  assert.equal(buffer.length,generated.bytes);
  assert.ok(buffer.length>=1024*1024,'next15 fixture is too small to represent a phone photo');
  assert.ok(buffer.length<=8*1024*1024,'next15 fixture exceeds representative benchmark bound');
  return{
    buffer,
    width:generated.width,
    height:generated.height,
    quality:generated.quality,
    mime:generated.mime,
    bytes:buffer.length,
    sha256:crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

async function uploadFixture(page,fixture,roomId){
  await page.evaluate(roomId=>openChat(roomId),roomId);
  const before=await page.locator('#messages .media-tile').count();
  await page.locator('#mediaFileInput').setInputFiles({
    name:'next15-phone-photo.jpg',
    mimeType:'image/jpeg',
    buffer:fixture.buffer
  });
  await page.waitForSelector('.media-send-btn',{timeout:20000});
  await page.locator('.media-send-btn').click();
  await page.waitForSelector('.media-preview-overlay',{state:'detached',timeout:60000});
  await page.waitForFunction(
    before=>document.querySelectorAll('#messages .media-tile').length>before,
    before,{timeout:30000}
  );
  await page.evaluate(()=>FPNetwork171?.waitForMediaCacheIdle?.());
  return page.evaluate(()=>{
    const rows=[...document.querySelectorAll('#messages .bubble-wrap.msg[data-message-id]')].reverse();
    for(const row of rows){
      const id=Number(row.dataset.messageId||0);
      const record=window.FPMessageStore172?.get?.(state.roomId,id);
      const media=(record?.raw?.media||[]).find(item=>item?.media_kind==='image');
      if(!media)continue;
      return{
        messageId:id,
        publicId:String(media.public_id||''),
        width:Number(media.width)||null,
        height:Number(media.height)||null,
        sizeBytes:Number(media.size_bytes)||null,
        encryptedSizeBytes:Number(media.encrypted_size_bytes)||null,
        mime:String(media.mime_type||'')
      };
    }
    return null;
  });
}

async function clearManagedImageCache(page){
  await page.evaluate(async()=>{
    await FPNetwork171?.waitForMediaCacheIdle?.();
    await FPStorage167.clearCache(['image']);
    await FPNetwork171?.waitForMediaCacheIdle?.();
  });
}

async function waitPreviewReady(page,messageId,timeout=60000){
  await page.waitForFunction(messageId=>{
    const row=document.querySelector('#messages .bubble-wrap.msg[data-message-id="'+messageId+'"]');
    const img=row?.querySelector('.media-thumb');
    return Boolean(img&&img.complete&&img.naturalWidth>0);
  },messageId,{timeout});
}

async function waitOriginalReady(page,timeout=60000){
  await page.waitForFunction(()=>{
    const img=document.querySelector('.media-viewer-content img');
    return Boolean(img&&img.dataset.fpViewerSource==='original'&&img.complete&&img.naturalWidth>0);
  },null,{timeout});
}

async function closeViewer(page){
  const close=page.locator('.media-viewer-close');
  if(await close.count())await close.click();
  await page.evaluate(()=>FPNetwork171?.waitForMediaCacheIdle?.());
}

async function primeMedia(page,roomId,messageId){
  await page.evaluate(()=>window.FPRuntime169?.loading?.reset?.());
  await page.evaluate(roomId=>openChat(roomId),roomId);
  await waitPreviewReady(page,messageId);
  await page.evaluate(messageId=>{
    const tile=document.querySelector('#messages .bubble-wrap.msg[data-message-id="'+messageId+'"] .media-tile');
    if(!tile)throw Error('next15 media tile missing during prime');
    tile.click();
  },messageId);
  await waitOriginalReady(page);
  await closeViewer(page);
  await page.evaluate(()=>FPNetwork171?.waitForMediaCacheIdle?.());
}

async function measuredOpen(page,observer,roomId,messageId){
  observer.reset();
  await page.evaluate(()=>window.FPRuntime169?.loading?.reset?.());

  const chatPreviewStart=await page.evaluate(async roomId=>{
    try{showChatsList();}catch{}
    const started=performance.now();
    await openChat(roomId);
    return started;
  },roomId);
  await waitPreviewReady(page,messageId);
  const chatPreviewReadyMs=round(await page.evaluate(started=>performance.now()-started,chatPreviewStart));

  const clickStart=await page.evaluate(messageId=>{
    const tile=document.querySelector('#messages .bubble-wrap.msg[data-message-id="'+messageId+'"] .media-tile');
    if(!tile)throw Error('next15 measured media tile missing');
    const started=performance.now();
    tile.click();
    return started;
  },messageId);

  await page.waitForFunction(()=>{
    const img=document.querySelector('[data-slot="current"] img[data-fp-viewer-source="preview"]');
    return Boolean(img&&img.complete&&img.naturalWidth>0);
  },null,{timeout:10000});
  const viewerPreviewReadyMs=round(await page.evaluate(started=>performance.now()-started,clickStart));

  await waitOriginalReady(page);
  const originalReadyMs=round(await page.evaluate(started=>performance.now()-started,clickStart));
  await page.waitForTimeout(80);

  const runtime=await page.evaluate(()=>{
    const records=window.FPRuntime169?.loading?.report?.().records||[];
    const preview=[...records].reverse().find(row=>
      row.kind==='media'&&row.consumer==='chat-thumbnail'&&row.endpoint==='thumb'
    )||null;
    const original=[...records].reverse().find(row=>
      row.kind==='media'&&row.consumer==='gallery-current'&&row.endpoint==='blob'
    )||null;
    return{
      previewCache:preview?.cache||null,
      originalCache:original?.cache||null,
      previewStatus:preview?.status||null,
      originalStatus:original?.status||null
    };
  });

  const network=observer.snapshot();
  await closeViewer(page);

  return{
    chatPreviewReadyMs,
    viewerPreviewReadyMs,
    originalReadyMs,
    viewerPreviewObservedBeforeOriginal:viewerPreviewReadyMs<=originalReadyMs,
    chatPreviewEvent:'chat media thumbnail <img.media-thumb> complete && naturalWidth > 0 after openChat start',
    viewerPreviewEvent:'viewer selected-photo img[data-fp-viewer-source=preview] complete && naturalWidth > 0 after media-tile click',
    originalEvent:'the same viewer photo reaches data-fp-viewer-source=original and is complete with naturalWidth > 0 after the same click',
    runtime,
    network:{
      preview:summarizeNetwork(network,'preview'),
      original:summarizeNetwork(network,'original')
    }
  };
}

function summarizeScenario(rows){
  return{
    chatPreviewReadyMs:stats(rows.map(row=>row.chatPreviewReadyMs)),
    viewerPreviewReadyMs:stats(rows.map(row=>row.viewerPreviewReadyMs)),
    originalReadyMs:stats(rows.map(row=>row.originalReadyMs)),
    runtimeCache:{
      preview:rows.reduce((out,row)=>{
        const key=String(row.runtime.previewCache||'null');
        out[key]=(out[key]||0)+1;
        return out;
      },{}),
      original:rows.reduce((out,row)=>{
        const key=String(row.runtime.originalCache||'null');
        out[key]=(out[key]||0)+1;
        return out;
      },{})
    },
    network:{
      previewRequests:rows.reduce((sum,row)=>sum+row.network.preview.requests,0),
      originalRequests:rows.reduce((sum,row)=>sum+row.network.original.requests,0),
      previewEncodedBytes:rows.reduce((sum,row)=>sum+row.network.preview.encodedBytes,0),
      originalEncodedBytes:rows.reduce((sum,row)=>sum+row.network.original.encodedBytes,0),
      previewServedFromCache:rows.reduce((sum,row)=>sum+row.network.preview.servedFromCache,0),
      originalServedFromCache:rows.reduce((sum,row)=>sum+row.network.original.servedFromCache,0),
      previewFromDiskCache:rows.reduce((sum,row)=>sum+row.network.preview.fromDiskCache,0),
      originalFromDiskCache:rows.reduce((sum,row)=>sum+row.network.original.fromDiskCache,0),
      previewStatusCodes:[...new Set(rows.flatMap(row=>row.network.preview.statusCodes))].sort((a,b)=>a-b),
      originalStatusCodes:[...new Set(rows.flatMap(row=>row.network.original.statusCodes))].sort((a,b)=>a-b)
    }
  };
}

run(async({browser,newClient,origin,errors})=>{
  const page=await newClient();
  const session=await page.context().newCDPSession(page);
  const observer=attachMediaNetworkObserver(session);
  await configureNetwork(session,'normal');

  const version=await page.evaluate(()=>fetch('/version.json',{cache:'no-store'}).then(response=>response.json()));
  const room=await createRoom(page);
  const fixture=await generateFixedPhoto(page);
  const uploaded=await uploadFixture(page,fixture,room.roomId);
  assert(uploaded?.messageId&&uploaded?.publicId,'next14 uploaded media identity missing');
  assert.equal(uploaded.width,fixture.width);
  assert.equal(uploaded.height,fixture.height);
  assert.equal(uploaded.mime,'image/jpeg');

  const initialIdentity=await identitySnapshot(page,room.roomId);
  assert(initialIdentity.deviceId&&initialIdentity.roomDeviceId&&initialIdentity.secret,'next15 identity precondition missing');

  const report={
    schema:1,
    plan:'docs/performance-next-steps-prompts.md',
    item:15,
    sourceFixture:'item 14 representative 4032x3024 JPEG generator',
    runtimeSha:process.env.FPCHAT_RUNTIME_SHA||null,
    measurementHead:process.env.GITHUB_SHA||null,
    build:String(version.build||''),
    collectedAt:new Date().toISOString(),
    fixture:{
      name:'next14-phone-photo.jpg',
      kind:'same deterministic synthetic non-personal phone-photo generator as item 14',
      width:fixture.width,
      height:fixture.height,
      megapixels:round((fixture.width*fixture.height)/1e6),
      mime:fixture.mime,
      jpegQuality:fixture.quality,
      bytes:fixture.bytes,
      mebibytes:round(fixture.bytes/1024/1024),
      sha256:fixture.sha256,
      serverRecorded:{
        width:uploaded.width,
        height:uploaded.height,
        mime:uploaded.mime,
        sizeBytes:uploaded.sizeBytes,
        encryptedSizeBytes:uploaded.encryptedSizeBytes
      }
    },
    environment:{
      browser:'Chromium '+browser.version(),
      platform:process.platform,
      arch:process.arch,
      node:process.version,
      cpuModel:os.cpus()[0]?.model||null,
      vcpu:os.cpus().length,
      physicalDevice:false,
      samplesPerScenario:SAMPLES,
      network:{
        normal:'no added latency/bandwidth shaping',
        throttled:'CDP latency=200 ms, download=125000 B/s (~1 Mbit/s), upload=62500 B/s (~0.5 Mbit/s), cellular3g'
      }
    },
    measurementEvents:{
      chatPreviewStart:'immediately before openChat(roomId)',
      chatPreviewReady:'the uploaded message chat thumbnail <img.media-thumb> is complete and naturalWidth > 0',
      viewerStart:'immediately before clicking that message media tile',
      viewerPreviewReady:'the selected viewer photo has data-fp-viewer-source=preview, complete=true and naturalWidth > 0',
      originalReady:'the same viewer photo has data-fp-viewer-source=original, complete=true and naturalWidth > 0',
      qualification:'DOM image readiness/decode observations; not hardware display/presentation timestamps'
    },
    item14BaselineOriginalMedianMs:{
      normal:{managedWarm:41.0,managedMissHttpRetained:61.9,managedMissHttpCold:74.0},
      throttled:{managedWarm:48.8,managedMissHttpRetained:296.6,managedMissHttpCold:44293.9}
    },
    cacheScenarios:{
      managedWarm:'FPStorage167 image CacheStorage is explicitly primed; a root navigation drops gallery JS/RAM state; browser HTTP cache is left untouched.',
      managedMissHttpRetained:'the same preview+original are first primed, then root navigation drops gallery JS/RAM state and FPStorage167.clearCache([image]) clears only managed media cache; browser HTTP cache is not cleared.',
      managedMissHttpCold:'after root navigation, FPStorage167 image cache is cleared and CDP Network.clearBrowserCache clears browser HTTP cache; localStorage/identity is verified unchanged.'
    },
    identity:{
      preserved:true,
      checks:0
    },
    raw:{},
    summary:{},
    notes:[
      'The benchmark never clears localStorage, room secret, device identity or site storage.',
      'Network.clearBrowserCache is used only for the HTTP-cold media condition and is followed by an identity equality check.',
      'Managed media cache is cleared only through FPStorage167.clearCache([image]) after FPNetwork171 media work is idle.',
      'Gallery RAM asset cache is removed by normal root navigation between preparation and measurement.',
      'Item 15 runtime is under measurement; the benchmark does not add a second media transport or cache path.',
      'Viewer preview reuses the already-ready chat thumbnail ObjectURL and does not issue a new preview request.',
      'Five samples per scenario: p95 is intentionally not reported.'
    ]
  };

  async function assertIdentity(){
    const current=await identitySnapshot(page,room.roomId);
    assert(sameIdentity(initialIdentity,current),'next15 identity changed while preparing cache state');
    report.identity.checks+=1;
  }

  for(const profile of ['normal','throttled']){
    await resetPage(page,origin,session,profile);
    await clearManagedImageCache(page);
    await session.send('Network.clearBrowserCache');
    await assertIdentity();
    await primeMedia(page,room.roomId,uploaded.messageId);
    await page.evaluate(()=>FPNetwork171?.waitForMediaCacheIdle?.());

    const warm=[];
    for(let i=0;i<SAMPLES;i++){
      await resetPage(page,origin,session,profile);
      await assertIdentity();
      warm.push(await measuredOpen(page,observer,room.roomId,uploaded.messageId));
    }
    report.raw[profile+'.managedWarm']=warm;
    report.summary[profile+'.managedWarm']=summarizeScenario(warm);

    const retained=[];
    for(let i=0;i<SAMPLES;i++){
      await resetPage(page,origin,session,profile);
      await clearManagedImageCache(page);
      await assertIdentity();
      retained.push(await measuredOpen(page,observer,room.roomId,uploaded.messageId));
    }
    report.raw[profile+'.managedMissHttpRetained']=retained;
    report.summary[profile+'.managedMissHttpRetained']=summarizeScenario(retained);

    const cold=[];
    for(let i=0;i<SAMPLES;i++){
      await resetPage(page,origin,session,profile);
      await clearManagedImageCache(page);
      await session.send('Network.clearBrowserCache');
      await assertIdentity();
      cold.push(await measuredOpen(page,observer,room.roomId,uploaded.messageId));
    }
    report.raw[profile+'.managedMissHttpCold']=cold;
    report.summary[profile+'.managedMissHttpCold']=summarizeScenario(cold);
  }

  for(const profile of ['normal','throttled']){
    const warm=report.raw[profile+'.managedWarm'];
    const retained=report.raw[profile+'.managedMissHttpRetained'];
    const cold=report.raw[profile+'.managedMissHttpCold'];

    assert(warm.every(row=>row.runtime.previewCache==='hit'),'managed-warm preview did not use FPStorage167 cache');
    assert(warm.every(row=>row.runtime.originalCache==='hit'),'managed-warm original did not use FPStorage167 cache');
    assert(warm.every(row=>row.network.preview.requests===0),'managed-warm preview unexpectedly reached HTTP');
    assert(warm.every(row=>row.network.original.requests===0),'managed-warm original unexpectedly reached HTTP');

    assert(retained.every(row=>row.runtime.previewCache!=='hit'),'managed-miss preview unexpectedly hit FPStorage167');
    assert(retained.every(row=>row.runtime.originalCache!=='hit'),'managed-miss original unexpectedly hit FPStorage167');
    assert(retained.every(row=>row.network.preview.requests>=1),'managed-miss preview produced no HTTP request evidence');
    assert(retained.every(row=>row.network.original.requests>=1),'managed-miss original produced no HTTP request evidence');

    assert(cold.every(row=>row.runtime.previewCache!=='hit'),'HTTP-cold preview unexpectedly hit FPStorage167');
    assert(cold.every(row=>row.runtime.originalCache!=='hit'),'HTTP-cold original unexpectedly hit FPStorage167');
    assert(cold.every(row=>row.network.preview.requests>=1),'HTTP-cold preview produced no HTTP request');
    assert(cold.every(row=>row.network.original.requests>=1),'HTTP-cold original produced no HTTP request');
    assert(cold.every(row=>row.network.preview.servedFromCache===0&&row.network.preview.fromDiskCache===0),
      'HTTP-cold preview was served from browser HTTP cache');
    assert(cold.every(row=>row.network.original.servedFromCache===0&&row.network.original.fromDiskCache===0),
      'HTTP-cold original was served from browser HTTP cache');
  }

  for(const rows of Object.values(report.raw)){
    assert(rows.every(row=>row.viewerPreviewObservedBeforeOriginal===true),'viewer preview was not ready before original');
  }

  report.comparisonToItem14={};
  for(const profile of ['normal','throttled']){
    report.comparisonToItem14[profile]={};
    for(const state of ['managedWarm','managedMissHttpRetained','managedMissHttpCold']){
      const key=profile+'.'+state;
      const current=report.summary[key];
      const oldOriginal=report.item14BaselineOriginalMedianMs[profile][state];
      report.comparisonToItem14[profile][state]={
        item14OriginalMedianMs:oldOriginal,
        item15ViewerPreviewMedianMs:current.viewerPreviewReadyMs.median,
        item15OriginalMedianMs:current.originalReadyMs.median,
        previewLeadVsItem14OriginalMs:round(oldOriginal-current.viewerPreviewReadyMs.median),
        currentPreviewLeadBeforeOriginalMs:round(current.originalReadyMs.median-current.viewerPreviewReadyMs.median)
      };
    }
  }

  assert.equal(errors.length,0,'browser errors: '+JSON.stringify(errors));
  fs.writeFileSync(path.join(OUT,'next15-progressive-photo-summary.json'),JSON.stringify(report,null,2)+'\n');
  console.log('NEXT15_RESULT '+JSON.stringify(report));
}).catch(error=>{
  console.error(error);
  process.exitCode=1;
});
