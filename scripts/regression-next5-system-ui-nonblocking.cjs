'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const bootReady=fs.readFileSync(path.join(root,'public/boot-ready152.js'),'utf8');
const systemUi=fs.readFileSync(path.join(root,'public/system-ui148.js'),'utf8');

const layersBlock=bootReady.slice(
  bootReady.indexOf('function layersReady()'),
  bootReady.indexOf('async function waitFor(',bootReady.indexOf('function layersReady()'))
);
assert(!layersBlock.includes('__fpSystemUi148Installed'),'system-ui148 must not remain a mandatory layersReady dependency');
for(const required of ['__fpUiHotfix128Installed','__fpRoomMenuTouch151Installed','__fpChatOpening129Installed','__fpSettings131Installed','__fpUsernameProfile140Installed','FPChatRequestOwner147','__fpUsernameSearch143Installed','FPSystem144','__fpChatRequestSystem147Installed','FPGesture135','__fpViewport136Installed','__fpMediaGallery134Installed','__fpVoicePolish124Installed','__fpVoiceCancel126Installed','__fpVoicePins127Installed']){
  assert(layersBlock.includes(required),'required readiness dependency disappeared: '+required);
}
assert(systemUi.includes('if (window.__fpSystemUi148Installed) return;'),'system UI idempotency guard missing');
assert(systemUi.includes('if ((!window.FPGesture135 || !hostReady) && attempts++ < 100) setTimeout(boot, 100);'),'late-load retry contract missing');

run(async({browser,origin,errors})=>{
  const openSystemView=async page=>page.evaluate(()=>{
    const opened=window.FPSystem144?.open?.();
    return {opened:Boolean(opened),overlay:Boolean(document.querySelector('.fp-system145-overlay'))};
  });

  // Delay: boot and base system view must work while only system-ui148 is held.
  const delayed=await browser.newPage({viewport:{width:390,height:844}});
  delayed.on('pageerror',e=>errors.push(e.message));
  delayed.on('dialog',d=>d.dismiss());
  let releaseDelayed;
  const delayedGate=new Promise(resolve=>{releaseDelayed=resolve;});
  let delayedRequested=false;
  await delayed.route('**/system-ui148.js*',async route=>{
    delayedRequested=true;
    await delayedGate;
    await route.continue();
  });

  const delayedStart=Date.now();
  await delayed.goto(origin,{waitUntil:'domcontentloaded'});
  await delayed.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
  const bootBeforeReleaseMs=Date.now()-delayedStart;
  assert.equal(delayedRequested,true,'system-ui148 delay fixture was not exercised');

  const beforeRelease=await delayed.evaluate(()=>({
    installed:Boolean(window.__fpSystemUi148Installed),
    coreSystem:Boolean(window.FPSystem144),
    requestView:Boolean(window.__fpChatRequestSystem147Installed),
    gesture:Boolean(window.FPGesture135),
    owners:Boolean(window.FPConnection170&&window.FPSendManager177&&window.FPMediaSend170),
    layersEnd:window.FPBoot152?.timings186().points['layers-end']??null,
    bootReady:window.FPBoot152?.timings186().points['boot-ready']??null
  }));
  assert.equal(beforeRelease.installed,false,'held optional system UI unexpectedly installed');
  assert.equal(beforeRelease.coreSystem,true,'base FPSystem144 must exist before optional system UI');
  assert.equal(beforeRelease.requestView,true,'actionable system-chat view must exist before optional system UI');
  assert.equal(beforeRelease.gesture,true,'gesture owner must remain part of required startup');
  assert.equal(beforeRelease.owners,true,'required owner chain must be ready');
  assert(Number.isFinite(beforeRelease.layersEnd)&&Number.isFinite(beforeRelease.bootReady),'boot must complete before optional system UI release');

  const baseViewBefore=await openSystemView(delayed);
  assert.deepEqual(baseViewBefore,{opened:true,overlay:true},'base system chat must remain usable before system-ui148');
  await delayed.evaluate(()=>window.FPSystem144?.close?.());

  const releaseAt=Date.now();
  releaseDelayed();
  await delayed.waitForFunction(()=>window.__fpSystemUi148Installed&&document.getElementById('fpchat-system-ui148-style'),null,{timeout:10000});
  const lateLoadAfterBootMs=Date.now()-releaseAt;
  const afterLate=await delayed.evaluate(()=>({
    installed:Boolean(window.__fpSystemUi148Installed),
    style:Boolean(document.getElementById('fpchat-system-ui148-style')),
    bootReady:Number(window.__fpBootReady169At||0)
  }));
  assert.equal(afterLate.installed,true);
  assert.equal(afterLate.style,true);
  assert(afterLate.bootReady>0);
  await delayed.close();

  // Error: failing only system-ui148 must not extend readiness or break base system view.
  const failed=await browser.newPage({viewport:{width:390,height:844}});
  failed.on('pageerror',e=>errors.push(e.message));
  failed.on('dialog',d=>d.dismiss());
  let failedRequested=false;
  await failed.route('**/system-ui148.js*',route=>{failedRequested=true;return route.abort('failed');});
  const failedStart=Date.now();
  await failed.goto(origin,{waitUntil:'domcontentloaded'});
  await failed.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
  const errorBootMs=Date.now()-failedStart;
  assert.equal(failedRequested,true,'system-ui148 error fixture was not exercised');
  const failedState=await failed.evaluate(()=>({
    installed:Boolean(window.__fpSystemUi148Installed),
    coreSystem:Boolean(window.FPSystem144),
    requestView:Boolean(window.__fpChatRequestSystem147Installed),
    layersCompleted:window.FPBoot152?.timings186().completed['layers-end']
  }));
  assert.deepEqual(failedState,{installed:false,coreSystem:true,requestView:true,layersCompleted:true});
  const baseViewAfterError=await openSystemView(failed);
  assert.deepEqual(baseViewAfterError,{opened:true,overlay:true},'base system chat must survive optional system-ui148 failure');
  await failed.close();

  assert.deepEqual(errors,[]);
  console.log('PASS delayed system-ui148 no longer blocks layers/boot readiness');
  console.log('PASS base system-chat view works before optional system-ui148 loads');
  console.log('PASS late system-ui148 installs after boot through its existing retry-safe path');
  console.log('PASS system-ui148 load failure no longer holds startup and base system chat remains usable');
  console.log('NEXT5_RESULT '+JSON.stringify({bootBeforeReleaseMs,lateLoadAfterBootMs,errorBootMs}));
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
