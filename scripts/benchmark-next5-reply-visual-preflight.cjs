'use strict';

const assert=require('node:assert/strict');
const {run}=require('./browser-harness174.cjs');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.dismiss());

  let releaseVisual;
  const visualGate=new Promise(resolve=>{releaseVisual=resolve;});
  let visualRequestedAt=null;
  page.on('request',request=>{
    const path=new URL(request.url()).pathname;
    if(path==='/reply-swipe-visual184.js'&&visualRequestedAt===null)visualRequestedAt=Date.now();
  });

  await page.route('**/reply-swipe-visual184.js*',async route=>{
    await visualGate;
    await route.continue();
  });

  const nav=page.goto(origin,{waitUntil:'domcontentloaded'});
  for(let i=0;i<200&&visualRequestedAt===null;i++)await page.waitForTimeout(10);
  assert.notEqual(visualRequestedAt,null,'reply visual request did not start');

  await page.waitForTimeout(350);
  const beforeRelease=await page.evaluate(()=>({
    appScriptCount:[...document.scripts].filter(s=>{try{return new URL(s.src,location.href).pathname==='/app.js';}catch{return false;}}).length,
    visualInstalled:Boolean(window.FPReplySwipeVisual184)
  }));
  const blockedBeforeRelease=beforeRelease.appScriptCount===0;
  const releasedAt=Date.now();
  releaseVisual();
  await nav;
  await page.waitForFunction(()=>[...document.scripts].some(s=>{try{return new URL(s.src,location.href).pathname==='/app.js';}catch{return false;}}),null,{timeout:10000});
  const appInsertedAt=Date.now();
  await page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});

  const result={
    blockedBeforeRelease,
    appScriptCountBeforeRelease:beforeRelease.appScriptCount,
    visualInstalledBeforeRelease:beforeRelease.visualInstalled,
    releaseToAppScriptMs:appInsertedAt-releasedAt
  };
  console.log('NEXT5_PREFLIGHT '+JSON.stringify(result));
  assert.equal(blockedBeforeRelease,true,'current startup no longer waits for reply visual before inserting app.js');
  assert.equal(beforeRelease.visualInstalled,false,'held reply visual unexpectedly installed before release');
  assert.deepEqual(errors,[]);
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
