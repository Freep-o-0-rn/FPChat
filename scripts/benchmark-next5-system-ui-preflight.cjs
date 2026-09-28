'use strict';

const assert=require('node:assert/strict');
const {run}=require('./browser-harness174.cjs');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.dismiss());

  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  let requested=false;

  await page.route('**/system-ui148.js*',async route=>{
    requested=true;
    await gate;
    await route.continue();
  });

  await page.goto(origin,{waitUntil:'domcontentloaded'});
  for(let i=0;i<300&&!requested;i++)await page.waitForTimeout(10);
  assert.equal(requested,true,'system-ui148.js was not requested');

  await page.waitForFunction(()=>window.FPBoot152?.timings186().points['layers-start']!==undefined,null,{timeout:30000});
  const heldAt=Date.now();
  await page.waitForTimeout(500);

  const before=await page.evaluate(()=>({
    bootReady:Boolean(window.__fpBootReady169At),
    installed:Boolean(window.__fpSystemUi148Installed),
    layersEnd:window.FPBoot152?.timings186().points['layers-end']??null,
    coreReady:window.FPBoot152?.timings186().points['core-ready']??null
  }));
  assert.equal(before.installed,false);
  assert.equal(before.bootReady,false,'current boot unexpectedly ignores missing system-ui148');
  assert.equal(before.layersEnd,null,'current layers-ready boundary should still be held');

  release();
  await page.waitForFunction(()=>window.__fpSystemUi148Installed&&window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:15000});
  const releasedMs=Date.now()-heldAt;
  const after=await page.evaluate(()=>({
    layersEnd:window.FPBoot152.timings186().points['layers-end'],
    bootReady:window.FPBoot152.timings186().points['boot-ready']
  }));
  console.log('NEXT5_SYSTEM_UI_PREFLIGHT '+JSON.stringify({before,releasedMs,after}));
  assert.deepEqual(errors,[]);
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
