'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');
run(async({newClient,temp,errors})=>{
  const results=[];
  for(let sample=0;sample<3;sample++){
    const page=await newClient();
    const fixture=await page.evaluate(async()=>{
      const deviceId=getOrCreateDeviceId(),secret='history-benchmark',key=await deriveKey(secret);
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const data=await(await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})})).json();
      STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});upsertChat(data.publicId,{});
      return{roomId:data.publicId,deviceId,count:1500,incoming:false,encrypted:[await encryptText('Long history benchmark message',key)]};
    });
    const seeded=JSON.parse(execFileSync(process.env.FPCHAT_TEST_NODE||process.execPath,[path.join(__dirname,'seed-history174.cjs')],{input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures:[fixture]}),encoding:'utf8'}))[0];
    let historyPages=0;
    page.on('request',request=>{if(request.url().includes(`/rooms/${seeded.roomId}/messages?`)&&/[?&](before|after)=/.test(request.url()))historyPages++;});
    const result=await page.evaluate(async fixture=>{
      await fetch(`/api/rooms/${fixture.roomId}/view-state`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:getOrCreateDeviceId(),anchorMessageId:fixture.first+20,anchorOffsetPx:8,atBottom:false})});
      const started=performance.now();await openChat(fixture.roomId);await new Promise(requestAnimationFrame);
      return{openMs:performance.now()-started,mounted:document.querySelectorAll('#messages .bubble-wrap.msg').length,domNodes:document.getElementsByTagName('*').length,anchorPresent:!!findMessageElement(fixture.first+20)};
    },seeded);
    results.push({...result,historyPages});await page.close();
  }
  const sorted=results.map(r=>r.openMs).sort((a,b)=>a-b);
  const report={environment:'Linux headless Chromium, isolated local SQLite, 1500 own read messages, saved anchor at message 21, 3 profiles; not mobile baseline',results,summary:{medianOpenMs:Math.round(sorted[1]*10)/10,worstOpenMs:Math.round(sorted[2]*10)/10},errors};
  if(process.env.FPCHAT_BENCH_OUTPUT)fs.writeFileSync(process.env.FPCHAT_BENCH_OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));if(errors.length)process.exitCode=1;
}).catch(error=>{console.error(error);process.exitCode=1;});
