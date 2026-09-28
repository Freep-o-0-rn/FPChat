'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');

const SAMPLES=5;
const OUT=path.resolve(process.env.FPCHAT_NEXT16_OUTPUT||path.join(process.cwd(),'next16-output'));
fs.mkdirSync(OUT,{recursive:true});

const round=value=>value===null||value===undefined||!Number.isFinite(Number(value))
  ? null
  : Math.round(Number(value)*10)/10;

function stats(values){
  const clean=values.filter(value=>value!==null&&value!==undefined).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!clean.length)return{n:0,median:null,min:null,max:null,p95:null,p95Rule:'not calculated: no samples'};
  const median=clean.length%2?clean[(clean.length-1)/2]:(clean[clean.length/2-1]+clean[clean.length/2])/2;
  return{n:clean.length,median:round(median),min:round(clean[0]),max:round(clean.at(-1)),p95:null,p95Rule:'not calculated for n < 20'};
}

function requestedProfile(profile){
  if(profile==='throttled'){
    return{
      targetRttMs:200,
      downloadBitsPerSecond:1000000,
      uploadBitsPerSecond:500000,
      implementation:'Linux tc/netem on loopback; 100 ms one-way delay in each direction, server->client 1 mbit, client->server 500 kbit'
    };
  }
  return{
    targetRttMs:0,
    downloadBitsPerSecond:null,
    uploadBitsPerSecond:null,
    implementation:'no loopback qdisc shaping'
  };
}

function cdpOfflineConfig(offline){
  return{
    offline:Boolean(offline),
    latency:0,
    downloadThroughput:-1,
    uploadThroughput:-1,
    connectionType:offline?'none':'wifi'
  };
}

async function setOfflineState(session,offline){
  const config=cdpOfflineConfig(offline);
  await session.send('Network.emulateNetworkConditions',config);
  return config;
}

function runTc(args,{allowFail=false}={}){
  try{
    return execFileSync('sudo',['-n','tc',...args],{encoding:'utf8'}).trim();
  }catch(error){
    if(allowFail)return String(error?.stderr||error?.message||'').trim();
    throw error;
  }
}

function clearHostProfile(){
  runTc(['qdisc','del','dev','lo','root'],{allowFail:true});
}

function readTcState(){
  return{
    qdisc:runTc(['-s','qdisc','show','dev','lo'],{allowFail:true}),
    filters:runTc(['-s','filter','show','dev','lo','parent','1:'],{allowFail:true})
  };
}

function applyHostProfile(profile,serverPort){
  clearHostProfile();
  if(profile!=='throttled'){
    return{profile,configured:true,requested:requestedProfile(profile),tcState:readTcState()};
  }
  const port=String(Number(serverPort));
  if(!/^\d+$/.test(port)||Number(port)<=0)throw Error('next16 invalid loopback server port');
  runTc(['qdisc','add','dev','lo','root','handle','1:','prio','bands','3']);
  runTc(['qdisc','add','dev','lo','parent','1:1','handle','10:','netem','delay','100ms','rate','1mbit']);
  runTc(['qdisc','add','dev','lo','parent','1:2','handle','20:','netem','delay','100ms','rate','500kbit']);
  runTc(['filter','add','dev','lo','protocol','ip','parent','1:','prio','1','u32','match','ip','sport',port,'0xffff','flowid','1:1']);
  runTc(['filter','add','dev','lo','protocol','ip','parent','1:','prio','2','u32','match','ip','dport',port,'0xffff','flowid','1:2']);
  return{profile,configured:true,requested:requestedProfile(profile),tcState:readTcState()};
}

async function waitBoot(page,timeout=45000){
  await page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout});
}

async function createRoom(page){
  return page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='next16-reconnect-fixture';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:'Next16',deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok)throw Error('next16 fixture room failed '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});
    upsertChat(data.publicId,{});
    await openChat(data.publicId);
    return{roomId:data.publicId,deviceId};
  });
}

async function waitOwnerOpenPassive(page,timeout=30000){
  await page.waitForFunction(()=>{
    const owner=window.FPConnection170?.snapshot?.();
    const current=window.FPConnection170?.current?.();
    return Boolean(owner?.open===true&&current&&current===state.ws&&current.readyState===WebSocket.OPEN);
  },null,{timeout});
}

async function installPassiveObserver(page){
  return page.evaluate(()=>{
    window.__next16Observer?.cleanup?.();
    const oldSocket=window.FPConnection170?.current?.()||state.ws||null;
    if(!oldSocket||oldSocket.readyState!==WebSocket.OPEN)throw Error('next16 open-socket precondition missing');
    const started=performance.now();
    const data={
      oldSocket,
      oldClosed:false,
      oldCloseAt:null,
      ownerEvents:[],
      lifecycleEvents:[],
      createdAt:started
    };
    const ownerUnsub=window.FPConnection170.subscribe((detail,socket)=>{
      data.ownerEvents.push({
        at:performance.now()-started,
        type:String(detail?.type||''),
        sequence:Number(detail?.sequence)||0,
        exists:Boolean(detail?.exists),
        open:Boolean(detail?.open),
        readyState:detail?.readyState===null?null:Number(detail?.readyState),
        sameOld:socket===oldSocket
      });
    },{immediate:true});
    const lifeUnsub=window.FPLifecycle170?.subscribe?.(event=>{
      data.lifecycleEvents.push({
        at:performance.now()-started,
        type:String(event?.lastType||''),
        online:Boolean(event?.online)
      });
    })||(()=>{});
    const onOldClose=()=>{
      data.oldClosed=true;
      data.oldCloseAt=performance.now()-started;
    };
    oldSocket.addEventListener('close',onOldClose,{once:true});
    data.cleanup=()=>{
      try{ownerUnsub();}catch{}
      try{lifeUnsub();}catch{}
      try{oldSocket.removeEventListener('close',onOldClose);}catch{}
    };
    window.__next16Observer=data;
    return{
      owner:window.FPConnection170.snapshot(),
      oldReadyState:Number(oldSocket.readyState),
      navigatorOnline:navigator.onLine!==false
    };
  });
}

async function observerSnapshot(page){
  return page.evaluate(()=>{
    const data=window.__next16Observer;
    const old=data?.oldSocket||null;
    const current=window.FPConnection170?.current?.()||null;
    return{
      oldClosed:Boolean(data?.oldClosed),
      oldCloseAt:typeof data?.oldCloseAt==='number'?data.oldCloseAt:null,
      oldReadyState:old?Number(old.readyState):null,
      currentExists:Boolean(current),
      currentOpen:Boolean(current&&current.readyState===WebSocket.OPEN),
      currentSameOld:Boolean(current&&old&&current===old),
      currentReadyState:current?Number(current.readyState):null,
      owner:window.FPConnection170?.snapshot?.()||null,
      navigatorOnline:navigator.onLine!==false,
      lifecycle:window.FPLifecycle170?.snapshot?.()||null,
      ownerEvents:(data?.ownerEvents||[]).map(row=>({...row})),
      lifecycleEvents:(data?.lifecycleEvents||[]).map(row=>({...row}))
    };
  });
}

async function cleanupObserver(page){
  await page.evaluate(()=>{
    try{window.__next16Observer?.cleanup?.();}catch{}
    delete window.__next16Observer;
  });
}

async function profileProbe(page,label){
  return page.evaluate(async label=>{
    const started=performance.now();
    const response=await fetch('/version.json?next16='+encodeURIComponent(label)+'&t='+Date.now(),{
      cache:'no-store',
      headers:{'x-fp-next16':'profile-probe'}
    });
    await response.arrayBuffer();
    return{ms:performance.now()-started,status:response.status};
  },label).then(row=>({ms:round(row.ms),status:row.status}));
}

async function prepareConnected(page,roomId){
  await page.evaluate(async roomId=>{
    if(state.roomId!==roomId)await openChat(roomId);
  },roomId);
  await waitOwnerOpenPassive(page,30000);
}

async function naturalOutageSample(page,session,profile,roomId,index){
  await prepareConnected(page,roomId);
  const initial=await installPassiveObserver(page);
  const oldBefore=await observerSnapshot(page);

  const offlineStarted=Date.now();
  const offlineConfig=await setOfflineState(session,true);
  await page.waitForFunction(()=>navigator.onLine===false,null,{timeout:5000}).catch(()=>{});
  await page.waitForTimeout(10000);
  const during=await observerSnapshot(page);

  const restoreStarted=Date.now();
  const restoreConfig=await setOfflineState(session,false);
  await page.waitForFunction(()=>navigator.onLine!==false,null,{timeout:5000}).catch(()=>{});

  let reconnectMs=null;
  let automaticRecovered=false;
  let outcome='unknown';
  if(during.oldClosed){
    try{
      await page.waitForFunction(()=>{
        const data=window.__next16Observer;
        const old=data?.oldSocket||null;
        const current=window.FPConnection170?.current?.()||null;
        return Boolean(old&&current&&current!==old&&current.readyState===WebSocket.OPEN);
      },null,{timeout:30000});
      reconnectMs=Date.now()-restoreStarted;
      automaticRecovered=true;
      outcome='auto_reconnected_after_network_break';
    }catch{
      outcome='break_without_recovery';
    }
  }else{
    await page.waitForTimeout(1200);
    const retained=await observerSnapshot(page);
    if(retained.currentSameOld&&retained.currentOpen&&!retained.oldClosed){
      outcome='live_connection_preserved';
    }else if(retained.oldClosed){
      // The socket closed only after network restoration. It is still a real
      // break, but recovery timing starts from restore and may continue.
      try{
        await page.waitForFunction(()=>{
          const data=window.__next16Observer;
          const old=data?.oldSocket||null;
          const current=window.FPConnection170?.current?.()||null;
          return Boolean(old&&current&&current!==old&&current.readyState===WebSocket.OPEN);
        },null,{timeout:30000});
        reconnectMs=Date.now()-restoreStarted;
        automaticRecovered=true;
        outcome='auto_reconnected_after_post_restore_close';
      }catch{
        outcome='post_restore_close_without_recovery';
      }
    }else{
      outcome='socket_state_inconclusive';
    }
  }

  const final=await observerSnapshot(page);
  const probe=await profileProbe(page,'natural-'+profile+'-'+index);
  await cleanupObserver(page);

  return{
    kind:'natural-network-outage',
    profile,
    index,
    initial,
    offlineConfig,
    restoreConfig,
    offlineMs:restoreStarted-offlineStarted,
    observationTotalMs:Date.now()-offlineStarted,
    breakObservedBeforeRestore:Boolean(during.oldClosed),
    breakObservedEventually:Boolean(final.oldClosed),
    reconnectMs,
    automaticRecovered,
    outcome,
    preOutage:oldBefore,
    duringOutage:during,
    final,
    profileProbeMs:probe.ms,
    profileProbeStatus:probe.status,
    observerCalledEnsureConnected:false
  };
}

async function breakOldSocketWhileOffline(page,session){
  const result={method:null,cdpSupported:false,requested:false};
  try{
    await session.send('Network.closeConnections');
    result.method='cdp-Network.closeConnections';
    result.cdpSupported=true;
    result.requested=true;
    return result;
  }catch(error){
    result.cdpSupported=false;
    result.cdpError=String(error?.message||error);
  }
  const clientClose=await page.evaluate(()=>{
    const ws=window.__next16Observer?.oldSocket||null;
    if(!ws)return false;
    try{
      ws.close(4001,'next16 confirmed-break harness');
      return true;
    }catch{
      return false;
    }
  });
  result.method='raw-WebSocket.close';
  result.requested=Boolean(clientClose);
  return result;
}

async function confirmedBreakSample(page,session,profile,roomId,index){
  await prepareConnected(page,roomId);
  const initial=await installPassiveObserver(page);

  const offlineConfig=await setOfflineState(session,true);
  await page.waitForFunction(()=>navigator.onLine===false,null,{timeout:5000}).catch(()=>{});
  await page.waitForTimeout(250);

  const breakAction=await breakOldSocketWhileOffline(page,session);
  try{
    await page.waitForFunction(()=>window.__next16Observer?.oldClosed===true,null,{timeout:5000});
  }catch{}
  const beforeRestore=await observerSnapshot(page);
  const breakConfirmed=Boolean(beforeRestore.oldClosed&&beforeRestore.oldReadyState===3);

  const restoreStarted=Date.now();
  const restoreConfig=await setOfflineState(session,false);
  await page.waitForFunction(()=>navigator.onLine!==false,null,{timeout:5000}).catch(()=>{});

  let reconnectMs=null;
  let automaticRecovered=false;
  let outcome=breakConfirmed?'break_confirmed_no_recovery':'break_not_confirmed';
  if(breakConfirmed){
    try{
      await page.waitForFunction(()=>{
        const data=window.__next16Observer;
        const old=data?.oldSocket||null;
        const current=window.FPConnection170?.current?.()||null;
        const owner=window.FPConnection170?.snapshot?.();
        return Boolean(old&&current&&current!==old&&current.readyState===WebSocket.OPEN&&owner?.open===true);
      },null,{timeout:30000});
      reconnectMs=Date.now()-restoreStarted;
      automaticRecovered=true;
      outcome='confirmed_break_auto_reconnected';
    }catch{}
  }

  const final=await observerSnapshot(page);
  const probe=await profileProbe(page,'confirmed-'+profile+'-'+index);
  await cleanupObserver(page);

  return{
    kind:'confirmed-break-during-outage',
    profile,
    index,
    initial,
    offlineConfig,
    restoreConfig,
    breakAction,
    breakConfirmed,
    reconnectMs,
    automaticRecovered,
    outcome,
    beforeRestore,
    final,
    profileProbeMs:probe.ms,
    profileProbeStatus:probe.status,
    observerCalledEnsureConnected:false
  };
}

function summarize(rows){
  const natural=rows.filter(row=>row.kind==='natural-network-outage');
  const forced=rows.filter(row=>row.kind==='confirmed-break-during-outage');
  return{
    natural:{
      samples:natural.length,
      breaksBeforeRestore:natural.filter(row=>row.breakObservedBeforeRestore).length,
      liveConnectionPreserved:natural.filter(row=>row.outcome==='live_connection_preserved').length,
      autoReconnects:natural.filter(row=>row.automaticRecovered).length,
      reconnectMs:stats(natural.map(row=>row.reconnectMs)),
      outcomes:natural.reduce((acc,row)=>{acc[row.outcome]=(acc[row.outcome]||0)+1;return acc;},{})
    },
    confirmedBreak:{
      samples:forced.length,
      breaksConfirmed:forced.filter(row=>row.breakConfirmed).length,
      autoReconnects:forced.filter(row=>row.automaticRecovered).length,
      reconnectMs:stats(forced.map(row=>row.reconnectMs)),
      breakMethods:forced.reduce((acc,row)=>{const key=row.breakAction?.method||'none';acc[key]=(acc[key]||0)+1;return acc;},{}),
      outcomes:forced.reduce((acc,row)=>{acc[row.outcome]=(acc[row.outcome]||0)+1;return acc;},{})
    },
    profileProbeMs:stats(rows.map(row=>row.profileProbeMs))
  };
}

run(async({browser,newClient,origin,errors})=>{
  const page=await newClient();
  const session=await page.context().newCDPSession(page);
  await session.send('Network.enable');
  const version=await page.evaluate(()=>fetch('/version.json',{cache:'no-store'}).then(response=>response.json()));
  const fixture=await createRoom(page);
  await waitOwnerOpenPassive(page);

  const report={
    schema:1,
    plan:'docs/performance-next-steps-prompts.md',
    item:16,
    status:'measurement',
    runtimeSha:process.env.FPCHAT_RUNTIME_SHA||null,
    measurementHead:process.env.GITHUB_SHA||null,
    build:String(version.build||''),
    collectedAt:new Date().toISOString(),
    environment:{
      browser:'Chromium '+browser.version(),
      platform:process.platform,
      arch:process.arch,
      node:process.version,
      cpuModel:os.cpus()[0]?.model||null,
      vcpu:os.cpus().length,
      physicalDevice:false,
      samplesPerProfile:SAMPLES,
      networkProfiles:{
        normal:requestedProfile('normal'),
        throttled:requestedProfile('throttled')
      }
    },
    contract:{
      observationCallsEnsureConnected:false,
      passiveConnectionObserver:'FPConnection170.subscribe + old WebSocket close listener + owner/current snapshots',
      recoveryCondition:'different current WebSocket object is OPEN and FPConnection170.snapshot().open is true',
      naturalNoBreakRule:'reconnectMs remains null and outcome is live_connection_preserved when the original socket never closes',
      profileRule:'Linux tc/netem remains active for the whole profile block, including offline -> online recovery; CDP only toggles offline state without replacing latency/rate shaping'
    },
    raw:{normal:[],throttled:[]},
    summary:{},
    profileVerification:null,
    notes:[
      'Setup may open the room normally. No measurement observer calls FPConnection170.ensureConnected or ensureStableWsConnected.',
      'A natural network outage is reported separately from a confirmed-break recovery check.',
      'If Chromium keeps the old WebSocket alive during the natural outage, that sample is not called reconnect and reconnectMs is null.',
      'The confirmed-break scenario closes the already-observed old socket while offline only to create a proven break; recovery after restore is left to the existing lifecycle/sync/connection owners.',
      'No runtime source is modified by item 16.',
      'The throttled loopback profile is applied at OS packet level so HTTP and WebSocket traffic share the same shaping.',
      'tc qdisc/filter state and an HTTP latency probe verify that shaping is active.',
      'Five samples per profile; no p95.'
    ]
  };

  const serverPort=Number(new URL(origin).port);
  report.hostProfiles={};
  try{
    for(const profile of ['normal','throttled']){
      report.hostProfiles[profile]={before:applyHostProfile(profile,serverPort),after:null};
      await setOfflineState(session,false);
      for(let i=0;i<SAMPLES;i++){
        report.raw[profile].push(await naturalOutageSample(page,session,profile,fixture.roomId,i));
        report.raw[profile].push(await confirmedBreakSample(page,session,profile,fixture.roomId,i));
      }
      report.hostProfiles[profile].after=readTcState();
      report.summary[profile]=summarize(report.raw[profile]);
    }
  }finally{
    clearHostProfile();
    await setOfflineState(session,false).catch(()=>{});
  }

  const normalProbes=report.raw.normal.map(row=>row.profileProbeMs);
  const throttledProbes=report.raw.throttled.map(row=>row.profileProbeMs);
  const normalStats=stats(normalProbes);
  const throttledStats=stats(throttledProbes);
  report.profileVerification={
    normalProbeMs:normalStats,
    throttledProbeMs:throttledStats,
    throttledAddedMedianMs:round((throttledStats.median??0)-(normalStats.median??0)),
    effective:Boolean(
      Number.isFinite(normalStats.median)&&
      Number.isFinite(throttledStats.median)&&
      throttledStats.median>=150&&
      throttledStats.median-normalStats.median>=120
    ),
    probe:'cache-busted /version.json fetch after each recovery while the same tc/netem profile remained active; CDP only toggled offline/online'
  };

  for(const profile of ['normal','throttled']){
    const rows=report.raw[profile];
    assert(rows.every(row=>row.observerCalledEnsureConnected===false),'measurement observer called ensureConnected');
    for(const row of rows){
      assert.deepEqual(row.restoreConfig,cdpOfflineConfig(false),'offline restore config changed unexpectedly');
      assert.equal(row.profileProbeStatus,200,'network profile probe failed');
      if(row.kind==='natural-network-outage'&&!row.breakObservedEventually){
        assert.equal(row.reconnectMs,null,'no-break natural outage must not report reconnect');
      }
    }
  }

  const confirmed=[...report.raw.normal,...report.raw.throttled].filter(row=>row.kind==='confirmed-break-during-outage');

  fs.writeFileSync(path.join(OUT,'next16-reconnect-summary.json'),JSON.stringify(report,null,2)+'\n');
  console.log('NEXT16_DIAGNOSTIC '+JSON.stringify({
    summary:report.summary,
    profileVerification:report.profileVerification,
    hostProfiles:report.hostProfiles
  }));

  assert(confirmed.some(row=>row.breakConfirmed),'stand failed to produce any confirmed old-socket break');
  assert(confirmed.filter(row=>row.breakConfirmed).every(row=>row.automaticRecovered),'confirmed break did not auto-recover through existing owner');
  assert.equal(report.profileVerification.effective,true,'throttled profile effect was not verified');
  assert.equal(errors.length,0,'browser errors: '+JSON.stringify(errors));

  report.status='complete';
  fs.writeFileSync(path.join(OUT,'next16-reconnect-summary.json'),JSON.stringify(report,null,2)+'\n');
  console.log('NEXT16_RESULT '+JSON.stringify(report));
}).catch(error=>{
  console.error(error);
  process.exitCode=1;
});
