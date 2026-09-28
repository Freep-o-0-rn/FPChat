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
  let appRequestedAt=null;

  page.on('request',request=>{
    const path=new URL(request.url()).pathname;
    if(path==='/reply-swipe-visual184.js'&&visualRequestedAt===null)visualRequestedAt=Date.now();
    if(path==='/app.js'&&appRequestedAt===null)appRequestedAt=Date.now();
  });

  await page.route('**/reply-swipe-visual184.js*',async route=>{
    await visualGate;
    await route.continue();
  });

  const nav=page.goto(origin,{waitUntil:'domcontentloaded'});
  for(let i=0;i<200&&visualRequestedAt===null;i++)await page.waitForTimeout(10);
  assert.notEqual(visualRequestedAt,null,'reply visual request did not start');

  await page.waitForTimeout(350);
  const blockedBeforeRelease=appRequestedAt===null;
  releaseVisual();
  await nav;
  await page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
  assert.notEqual(appRequestedAt,null,'app.js request did not start after visual release');

  const result={
    blockedBeforeRelease,
    visualToAppRequestMs:appRequestedAt-visualRequestedAt
  };
  console.log('NEXT5_PREFLIGHT '+JSON.stringify(result));
  assert.equal(blockedBeforeRelease,true,'current startup no longer waits for reply visual; preflight assumption changed');
  assert(result.visualToAppRequestMs>=300,'held reply visual must visibly delay app.js request');
  assert.deepEqual(errors,[]);
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
