'use strict';
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');

run(async({newClient,root,errors})=>{
  let passed=0;const pass=name=>{passed++;console.log('PASS 186.4 '+name);};
  const baseline=execFileSync('git',['show','ab473aa7ffdc1afd32ba6d925b973b2bc982960a:public/storage167-cache-fix.js'],{cwd:root,encoding:'utf8'});
  const results=[];
  let page;
  for(const old of [true,false]){
    const client=await newClient(async p=>{
      if(old)await p.route('**/storage167-cache-fix.js?*',route=>route.fulfill({contentType:'application/javascript',body:baseline}));
      // Install before the owner captures native put, to hold an actual write later.
      await p.addInitScript(()=>{
        const put=Cache.prototype.put;
        Cache.prototype.put=async function(request,response){
          if(String(request.url||request).includes('maintenance1864-write')){
            window.writeEntered1864=true;await new Promise(resolve=>{window.releaseWrite1864=resolve;});
          }
          return put.call(this,request,response);
        };
      });
    });
    const result=await client.evaluate(async()=>{
      const cache=await caches.open(FPNetwork171.mediaCacheName);
      window.url1864=i=>new URL(`/api/media/maintenance1864-${i}/thumb?deviceId=private-device`,location.href).href;
      for(let i=0;i<6;i++)await cache.put(url1864(i),new Response('encrypted fixture'));
      await FPNetwork171.waitForMediaCacheIdle();FPRuntime169.loading.reset();
      const keys=Cache.prototype.keys;let calls=0,overlap=0,release;
      const gate=new Promise(resolve=>{release=resolve;});
      Cache.prototype.keys=async function(...args){calls++;if(FPNetwork171.hasPendingMedia())overlap++;return keys.apply(this,args);};
      try{
        const reads=Array.from({length:6},(_,i)=>FPNetwork171.consumeMedia(url1864(i),{},async response=>{
          await response.arrayBuffer();if(i<4)await gate;return i;
        }));
        FPStorage167CacheFix.rememberMediaList(Array.from({length:6},(_,i)=>({public_id:`maintenance1864-${i}`,media_kind:'image',thumb_encrypted_size_bytes:17})));
        await new Promise(resolve=>setTimeout(resolve,260));
        const during={calls,...FPNetwork171.snapshot().mediaBudget};
        release();await Promise.all(reads);await FPNetwork171.waitForMediaCacheIdle();
        // Join a pending automatic pass without requesting a redundant explicit pass.
        for(let i=0;i<100&&!FPRuntime169.loading.report().records.some(r=>r.kind==='cache-repair'&&r.status==='ok');i++)await new Promise(resolve=>setTimeout(resolve,20));
        return {during,calls,overlap,repair:FPRuntime169.loading.report().records.filter(r=>r.kind==='cache-repair'),kind:JSON.parse(localStorage.getItem('fpchat:storage:cache-meta167'))[url1864(5)]?.kind,busyAfter:FPNetwork171.hasPendingMedia()};
      }finally{release();Cache.prototype.keys=keys;}
    });
    assert.equal(result.during.active,4);assert.equal(result.during.queued,2);
    assert.equal(result.calls,1);assert.equal(result.kind,'image');assert.equal(result.busyAfter,false);
    results.push({version:old?'186.3':'186.4',scansWhileBusy:result.overlap});
    if(old){assert.equal(result.overlap,1);await client.close();}
    else{
      assert.equal(result.during.calls,0);assert.equal(result.overlap,0);
      assert.equal(result.repair.length,1);assert(result.repair[0].stagesMs.maintenanceWait>=120);
      page=client;
    }
  }
  pass('186.3 scan overlaps four active/two queued reads; 186.4 waits, then repairs metadata in one batch');

  const writes=await page.evaluate(async()=>{
    const cache=await caches.open(FPNetwork171.mediaCacheName);FPRuntime169.loading.reset();
    const write=cache.put('/api/media/maintenance1864-write/blob',new Response('held write'));
    while(!window.writeEntered1864)await new Promise(resolve=>setTimeout(resolve,10));
    const repair=FPStorage167CacheFix.repair();
    await new Promise(resolve=>setTimeout(resolve,120));
    const waiting=FPRuntime169.loading.report().records.find(r=>r.kind==='cache-repair');
    const during={busy:FPNetwork171.hasPendingMedia(),scanStarted:waiting.points['cache-keys-start']!==undefined};
    releaseWrite1864();await write;await repair;
    return {during,status:FPRuntime169.loading.report().records.find(r=>r.kind==='cache-repair').status,busyAfter:FPNetwork171.hasPendingMedia()};
  });
  assert.deepEqual(writes,{during:{busy:true,scanStarted:false},status:'ok',busyAfter:false});
  pass('maintenance also yields to physical cache writes after the download slots are free');

  const recheck=await page.evaluate(async()=>{
    const open=caches.open.bind(caches),keys=Cache.prototype.keys;
    let calls=0,opened,releaseOpen,releaseRead;
    const openEntered=new Promise(resolve=>{opened=resolve;});
    const openGate=new Promise(resolve=>{releaseOpen=resolve;});
    const readGate=new Promise(resolve=>{releaseRead=resolve;});
    let first=true;
    caches.open=async function(...args){const cache=await open(...args);if(first){first=false;opened();await openGate;}return cache;};
    Cache.prototype.keys=function(...args){calls++;return keys.apply(this,args);};
    FPRuntime169.loading.reset();
    try{
      const repair=FPStorage167CacheFix.repair();await openEntered;
      const read=FPNetwork171.consumeMedia(url1864(0),{},async response=>{await response.arrayBuffer();await readGate;});
      releaseOpen();await new Promise(resolve=>setTimeout(resolve,140));
      const during=calls;
      FPStorage167CacheFix.rememberMediaList([{public_id:'maintenance1864-0',media_kind:'video',thumb_encrypted_size_bytes:17}]);
      releaseRead();await read;await repair;
      return {during,calls,kind:JSON.parse(localStorage.getItem('fpchat:storage:cache-meta167'))[url1864(0)].kind,wait:FPRuntime169.loading.report().records.find(r=>r.kind==='cache-repair').stagesMs.cacheKeysWait};
    }finally{releaseOpen();releaseRead();caches.open=open;Cache.prototype.keys=keys;}
  });
  assert.equal(recheck.during,0);assert.equal(recheck.calls,1);assert.equal(recheck.kind,'video');assert(recheck.wait>=100);
  pass('a read arriving during caches.open defers enumeration; late metadata joins the same scan');

  const clear=await page.evaluate(async()=>{
    const guard=FPStorage167ClearGuard,keys=Cache.prototype.keys;
    let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
    Cache.prototype.keys=function(...args){calls++;return keys.apply(this,args);};
    FPRuntime169.loading.reset();
    const read=FPNetwork171.consumeMedia(url1864(1),{},async response=>{await response.arrayBuffer();await gate;});
    const repair=FPStorage167CacheFix.repair();
    try{
      await new Promise(resolve=>setTimeout(resolve,100));
      window.FPStorage167ClearGuard={...guard,isClearing:()=>true};
      await repair;
      return {calls,status:FPRuntime169.loading.report().records.find(r=>r.kind==='cache-repair').status};
    }finally{window.FPStorage167ClearGuard=guard;release();await read;Cache.prototype.keys=keys;}
  });
  assert.deepEqual(clear,{calls:0,status:'cancelled'});
  pass('clear exclusivity cancels deferred maintenance without a scan or metadata write');

  const aborted=await page.evaluate(async()=>{
    let release;const gate=new Promise(resolve=>{release=resolve;});
    const controller=new AbortController();
    const first=FPNetwork171.consumeMedia(url1864(2).replace('/thumb','/blob'),{signal:controller.signal},async()=>gate).catch(e=>e.name);
    // The original is deliberately queued behind no work, then a thumb queues behind it.
    const queued=FPNetwork171.consumeMedia(url1864(3),{signal:controller.signal},response=>response.arrayBuffer()).catch(e=>e.name);
    FPRuntime169.loading.reset();const repair=FPStorage167CacheFix.repair();
    controller.abort();release();await Promise.all([first,queued]);await repair;
    return {busy:FPNetwork171.hasPendingMedia(),status:FPRuntime169.loading.report().records.find(r=>r.kind==='cache-repair').status};
  });
  assert.deepEqual(aborted,{busy:false,status:'ok'});
  pass('aborted active/queued media releases admission and does not strand maintenance');
  await page.close();assert.deepEqual(errors,[]);
  console.log(JSON.stringify({suite:'186.4 maintenance',passed,controlledComparison:results,environment:'Linux Chromium; controlled lease contention, not a physical cache backend timing claim'}));
}).catch(error=>{console.error(error);process.exitCode=1;});
