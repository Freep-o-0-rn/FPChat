'use strict';
const assert=require('node:assert/strict');
const {run}=require('./browser-harness174.cjs');

run(async({browser,origin,errors})=>{
  let passed=0;const pass=name=>{passed++;console.log('PASS 186.5 '+name);};
  const names=['storage167.js','storage167-clear-guard.js','storage167-cache-fix.js','storage168.js'];
  const start=async prepare=>{
    const page=await browser.newPage();
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
    await page.addInitScript(()=>{
      window.preloadAudit1865={hints:[],loads:[],scripts:[]};
      new MutationObserver(records=>{
        for(const record of records)for(const node of record.addedNodes){
          if(node instanceof HTMLLinkElement&&node.rel==='preload'&&/\/storage(?:167|168)/.test(node.href)){
            preloadAudit1865.hints.push({name:new URL(node.href).pathname.slice(1),owners:Boolean(window.FPMediaSend170&&window.FPSendManager177&&window.FPConnection170),priority:node.fetchPriority});
          }
        }
      }).observe(document,{childList:true,subtree:true});
      document.addEventListener('load',event=>{
        const node=event.target;
        if(node instanceof HTMLLinkElement&&node.rel==='preload')preloadAudit1865.loads.push(new URL(node.href).pathname.slice(1));
        if(node instanceof HTMLScriptElement&&node.src)preloadAudit1865.scripts.push(new URL(node.src).pathname.slice(1));
      },true);
    });
    if(prepare)await prepare(page);
    await page.goto(origin,{waitUntil:'domcontentloaded'});return page;
  };
  const ready=page=>page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'));
  let releaseOwner,releaseStorage;
  const ownerGate=new Promise(resolve=>{releaseOwner=resolve;});
  const storageGate=new Promise(resolve=>{releaseStorage=resolve;});
  const requests=new Map();
  const page=await start(async p=>{
    await p.route('**/connection170.js?*',async route=>{await ownerGate;return route.continue();});
    await p.route(/\/storage(?:167(?:-clear-guard|-cache-fix)?|168)\.js\?/,async route=>{
      const name=new URL(route.request().url()).pathname.slice(1);requests.set(name,(requests.get(name)||0)+1);
      if(name==='storage167.js')await storageGate;
      return route.continue();
    });
  });
  await page.waitForFunction(()=>Boolean(document.querySelector('script[src*="connection170.js"]')));
  assert.equal(await page.evaluate(()=>preloadAudit1865.hints.length),0);
  releaseOwner();
  await page.waitForFunction(()=>preloadAudit1865.hints.length===4);
  assert((await page.evaluate(()=>preloadAudit1865.hints)).every(h=>h.owners&&h.priority==='low'));
  pass('storage preload starts once after critical owners, with low priority and the current build suffix');
  const hrefs=await page.evaluate(()=>[...document.querySelectorAll('link[rel="preload"]')].filter(e=>/\/storage(?:167|168)/.test(e.href)).map(e=>new URL(e.href).search));
  assert(hrefs.every(h=>h==='?v=186.5'));

  await page.waitForFunction(()=>['storage167-clear-guard.js','storage167-cache-fix.js','storage168.js'].every(n=>preloadAudit1865.loads.includes(n)));
  assert.deepEqual(await page.evaluate(()=>[Boolean(window.FPStorage167),Boolean(window.FPStorage167ClearGuard),Boolean(window.FPStorage167CacheFix),Boolean(window.__fpStorage168Installed)]),[false,false,false,false]);
  assert.equal(await page.locator('#bootHold152').count(),1);
  pass('successor files download while storage is held; preload executes none of them and retains the splash');
  releaseStorage();await ready(page);
  const audit=await page.evaluate(()=>({audit:preloadAudit1865,boot:FPBoot152.timings186(),owner:FPNetwork171.snapshot(),fetchOwned:window.fetch===FPNetwork171.fetch}));
  assert.deepEqual(audit.audit.scripts.filter(n=>names.includes(n)),names);
  for(const name of names){assert.equal(requests.get(name),1,name+' fetched twice');assert.equal(audit.boot.assets.records.filter(a=>a.name===name&&a.status==='loaded').length,1);}
  assert(audit.fetchOwned);assert.equal(audit.owner.rejectedAssignmentCount,0);
  assert.equal(audit.boot.completed['assets-end'],true);
  pass('one request/execution per storage file; original order and single network/cache owner are preserved');

  requests.clear();await page.reload({waitUntil:'domcontentloaded'});await ready(page);
  const repeat=await page.evaluate(()=>preloadAudit1865);
  assert.deepEqual(repeat.scripts.filter(n=>names.includes(n)),names);
  assert.equal(repeat.hints.length,4);for(const name of names)assert.equal(requests.get(name),1);
  pass('a new navigation repeats the same single execution chain without duplicate requests');await page.close();

  const failed=await start(async p=>p.route('**/storage167-clear-guard.js?*',route=>route.abort('failed')));
  await ready(failed);
  const failure=await failed.evaluate(()=>({storage:Boolean(window.FPStorage167),guard:Boolean(window.FPStorage167ClearGuard),fix:Boolean(window.FPStorage167CacheFix),accounting:Boolean(window.__fpStorage168Installed),assets:FPBoot152.timings186().assets,owners:Boolean(window.FPMediaSend170)}));
  assert.deepEqual([failure.storage,failure.guard,failure.fix,failure.accounting,failure.owners],[true,false,false,false,true]);
  assert.equal(failure.assets.records.find(a=>a.name==='storage167-clear-guard.js').status,'error');
  assert(!failure.assets.records.some(a=>a.name==='storage167-cache-fix.js'||a.name==='storage168.js'));
  pass('failed clear guard retains the old stop in execution; prefetched successors cannot bypass it');await failed.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({suite:'186.5 storage preload',passed,environment:'isolated Linux Chromium; physical phone startup requires acceptance'}));
}).catch(error=>{console.error(error);process.exitCode=1;});
