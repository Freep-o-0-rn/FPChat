'use strict';
const fs = require('node:fs');
const {run} = require('./browser-harness174.cjs');
run(async ({newClient,errors}) => {
  const results=[];
  for(let sample=0;sample<3;sample++) {
    const page=await newClient();
    results.push(await page.evaluate(async()=>{
      const settle=async()=>{if(window.FPChatList174)await FPChatList174.idle();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
      state.chats=Array.from({length:500},(_,i)=>({roomId:'bench-'+i,lastActivity:'2026-09-18T10:00:00Z',lastMessage:'Benchmark row '+i,unread:0}));
      let t=performance.now();renderChats();await settle();const firstMs=performance.now()-t;
      const original=Array.from(els.rows.querySelectorAll('.chat-row:not(.fp-system145-row)'));
      let added=0,removed=0;
      const observer=new MutationObserver(records=>{for(const r of records){added+=r.addedNodes.length;removed+=r.removedNodes.length;}});
      observer.observe(els.rows,{childList:true});
      t=performance.now();
      for(let i=0;i<20;i++){state.chats[250].unread=i+1;renderChats();}
      await settle();observer.disconnect();
      const elapsed=performance.now()-t;
      return {firstMs,update20Ms:elapsed,retainedRows:original.filter(n=>n.isConnected).length,addedRows:added,removedRows:removed,domNodes:document.getElementsByTagName('*').length,bootReadyMs:FPRuntime.snapshot().bootReadyMs};
    }));
    await page.close();
  }
  const summary={};
  for(const key of ['firstMs','update20Ms','bootReadyMs']) {
    const values=results.map(x=>x[key]).sort((a,b)=>a-b);
    summary[key]={median:Math.round(values[1]*10)/10,worst:Math.round(values[2]*10)/10};
  }
  const report={environment:'Linux headless Chromium, 500 synthetic rows, 20 updates to one row, two animation frames after completion, 3 fresh profiles; not a mobile baseline',results,summary,errors};
  if(process.env.FPCHAT_BENCH_OUTPUT)fs.writeFileSync(process.env.FPCHAT_BENCH_OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(errors.length)process.exitCode=1;
}).catch(error=>{console.error(error);process.exitCode=1;});
