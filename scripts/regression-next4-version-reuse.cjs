'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');

assert(index.includes('versionResult:loaderVersionResult174'),'loader result must be exposed through existing startup coordinator');
assert(index.includes('loaderVersionResult174 = Object.freeze({build:buildId,resourceBuild:buildId})'),'loader handoff must bind version result to resource build');
assert(app.includes("checkAppVersionOnEntry({startupVersionResult:window.FPStartup174?.versionResult||null})"),'startup must explicitly opt into loader result');
assert(app.includes('checkAppVersionOnEntry();flushPendingReads'),'resume must keep a fresh version check without startup result');
assert(app.includes("new URL(appScript.src,location.href).searchParams.get('v')"),'reuse must verify actual app.js resource version');
assert(app.includes("if(loadedBuild!==resourceBuild)return null"),'resource mismatch must reject startup reuse');
assert(app.includes("fetch('/version.json',{cache:'no-store'})"),'fresh fallback request must remain');
assert(index.includes("mark186('safety-release')")&&index.includes('}, 15000);'),'boot safety release must remain');
assert(index.includes("'media-send170.js':['text-send170.js']"),'required owner registration chain must remain');

run(async({browser,origin,errors})=>{
  const versionPath=url=>new URL(url).pathname==='/version.json';
  const waitReady=page=>page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
  const newPage=async(context)=>{
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.dismiss());
    return page;
  };

  // 1. Normal startup: one logical version request, validated handoff matches app.js?v.
  const normalContext=await browser.newContext({viewport:{width:390,height:844}});
  const normal=await newPage(normalContext);
  const normalVersions=[];
  normal.on('request',req=>{if(versionPath(req.url()))normalVersions.push(req.url());});
  await normal.goto(origin,{waitUntil:'domcontentloaded'});
  await waitReady(normal);
  await normal.waitForTimeout(50);
  assert.equal(normalVersions.length,1,'normal startup must reuse loader result instead of fetching version twice');
  const normalVersionState=await normal.evaluate(()=>({
    handoff:window.FPStartup174?.versionResult||null,
    frozen:Object.isFrozen(window.FPStartup174?.versionResult),
    appSrc:[...document.scripts].find(s=>{try{return new URL(s.src,location.href).pathname==='/app.js';}catch{return false;}})?.src||'',
    accepted:validatedStartupVersionBuild(window.FPStartup174?.versionResult),
    rejected:validatedStartupVersionBuild({build:'999.1',resourceBuild:'999.1'})
  }));
  assert.equal(normalVersionState.handoff?.build,'190.2');
  assert.equal(normalVersionState.handoff?.resourceBuild,'190.2');
  assert.equal(normalVersionState.frozen,true);
  assert.equal(new URL(normalVersionState.appSrc).searchParams.get('v'),'190.2');
  assert.equal(normalVersionState.accepted,190.2);
  assert.equal(normalVersionState.rejected,null,'mismatched resource graph must never reuse a foreign build result');

  // Fresh check after lifecycle resume: no startup result is passed, so one new network request must occur.
  const beforeResume=normalVersions.length;
  await normal.evaluate(()=>{
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
  await normal.waitForFunction(before=>performance.now()>0&&window.__fpBootReady169At,beforeResume);
  for(let i=0;i<100&&normalVersions.length===beforeResume;i++)await normal.waitForTimeout(20);
  assert.equal(normalVersions.length,beforeResume+1,'resume/focus must perform a fresh version request');

  // Direct /chat must retain the same one-request startup handoff and room ownership.
  const fixture=await normal.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),secret='next4-direct-chat';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      displayName:state.nick,deviceId,roomSecret:secret,...recovery
    })});
    if(!response.ok)throw new Error('fixture room '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    return data.publicId;
  });
  const directBefore=normalVersions.length;
  await normal.goto(origin+'/chat/'+fixture,{waitUntil:'domcontentloaded'});
  await waitReady(normal);
  await normal.waitForSelector('#msgInput');
  assert.equal(await normal.evaluate(()=>state.roomId),fixture);
  assert.equal(normalVersions.length,directBefore+1,'direct chat startup must issue only the loader version request');
  await normalContext.close();

  // 2. Real update path: one loader request per navigation, no second app-side request.
  const updateContext=await browser.newContext({viewport:{width:390,height:844}});
  const update=await newPage(updateContext);
  await update.goto(origin,{waitUntil:'domcontentloaded'});
  await waitReady(update);
  await update.evaluate(()=>{
    localStorage.setItem('fpchat:app-build','190.1');
    sessionStorage.removeItem('fpchat:update-reloading');
  });
  const updateVersions=[];
  update.on('request',req=>{if(versionPath(req.url()))updateVersions.push(req.url());});
  await update.reload({waitUntil:'domcontentloaded'}).catch(()=>{});
  await update.waitForFunction(()=>localStorage.getItem('fpchat:app-build')==='190.2'
    &&sessionStorage.getItem('fpchat:update-reloading')===null
    &&window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:45000});
  await update.waitForTimeout(100);
  assert.equal(updateVersions.length,2,'two-navigation update must use one version request per navigation');
  const updateState=await update.evaluate(()=>({
    build:localStorage.getItem('fpchat:app-build'),
    marker:sessionStorage.getItem('fpchat:update-reloading'),
    handoff:window.FPStartup174?.versionResult||null
  }));
  assert.deepEqual(updateState,{build:'190.2',marker:null,handoff:{build:'190.2',resourceBuild:'190.2'}});
  await updateContext.close();

  // 3. Loader version failure: startup result stays null and app.js performs the fresh fallback.
  const errorContext=await browser.newContext({viewport:{width:390,height:844}});
  const errorPage=await newPage(errorContext);
  let errorVersionRequests=0;
  await errorPage.route('**/version.json*',async route=>{
    errorVersionRequests++;
    if(errorVersionRequests===1){
      await route.fulfill({status:200,contentType:'application/json',body:'{broken-json'});
      return;
    }
    await route.continue();
  });
  await errorPage.goto(origin,{waitUntil:'domcontentloaded'});
  await waitReady(errorPage);
  assert.equal(errorVersionRequests,2,'failed loader version must fall back to one fresh app-side request');
  const errorState=await errorPage.evaluate(()=>({
    handoff:window.FPStartup174?.versionResult||null,
    localBuild:localStorage.getItem('fpchat:app-build'),
    appSrc:[...document.scripts].find(s=>{try{return new URL(s.src,location.href).pathname==='/app.js';}catch{return false;}})?.src||'',
    foreignAccepted:validatedStartupVersionBuild({build:'190.2',resourceBuild:'190.2'})
  }));
  assert.equal(errorState.handoff,null);
  assert.equal(errorState.localBuild,'190.2');
  assert.equal(new URL(errorState.appSrc).searchParams.get('v'),null,'loader failure must not pretend resources were version-tagged');
  assert.equal(errorState.foreignAccepted,null,'fallback result cannot be confused with a version-tagged startup graph');
  await errorContext.close();

  assert.deepEqual(errors,[]);
  console.log('PASS normal startup reuses validated loader version with one version request');
  console.log('PASS lifecycle resume performs a fresh version request');
  console.log('PASS direct /chat keeps one startup version request and enters through existing owners');
  console.log('PASS real update uses one loader version request per navigation');
  console.log('PASS broken loader version falls back to a fresh app-side request');
  console.log('PASS mismatched app.js resource version rejects loader-result reuse');
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
