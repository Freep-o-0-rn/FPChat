'use strict';
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');

run(async({browser,origin,root,errors})=>{
  const baseline=process.env.FPCHAT_BOOT_BASE_REF||'d960e5cba2cc43f9b10acac1fb6335561f7ac35e';
  const old=Object.fromEntries(['index.html','boot-ready152.js'].map(name=>[name,execFileSync('git',['show',`${baseline}:public/${name}`],{cwd:root,encoding:'utf8'})]));
  const results=[];
  for(let sample=0;sample<3;sample++)for(const version of sample%2?['current','baseline']:['baseline','current']){
    const page=await browser.newPage({viewport:{width:430,height:873}});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.dismiss());
    const session=await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate',{rate:4});
    // Same routing/cache policy on both sides; deterministic 80 ms per request.
    await page.route('**/*',async route=>{
      await new Promise(resolve=>setTimeout(resolve,80));
      const name=new URL(route.request().url()).pathname.slice(1)||'index.html';
      if(version==='baseline'&&old[name])return route.fulfill({contentType:name.endsWith('.html')?'text/html':'application/javascript',body:old[name]});
      return route.continue();
    });
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__fpBootReady169At&&window.FPRuntime169);
    const result=await page.evaluate(()=>({bootMs:__fpBootReady169At,points:FPBoot152.timings186().points,completed:FPBoot152.timings186().completed}));
    results.push({sample,version,...result});await page.close();
  }
  const median=version=>results.filter(r=>r.version===version).map(r=>r.bootMs).sort((a,b)=>a-b)[1];
  const report={baseline,environment:'Linux Chromium, 4x CPU slowdown, added 80 ms per request, no bandwidth throttle, routed fresh profiles; three paired samples; not physical mobile timing',results,medianMs:{baseline:median('baseline'),current:median('current')},errors};
  if(process.env.FPCHAT_BENCH_OUTPUT)fs.writeFileSync(process.env.FPCHAT_BENCH_OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));if(errors.length)process.exitCode=1;
}).catch(error=>{console.error(error);process.exitCode=1;});
