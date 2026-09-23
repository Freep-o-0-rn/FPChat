'use strict';
const assert=require('node:assert/strict');
const {run}=require('./browser-harness174.cjs');

run(async({newClient,errors})=>{
  const page=await newClient(async p=>{await p.setViewportSize({width:390,height:844});});
  await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),secret='header178281';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})});
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    await openChat(data.publicId);
    const box=document.getElementById('messages');
    for(let id=17828101;id<=17828120;id++){
      appendMessage(box,{id,type:'text',status:'read',created_at:new Date(Date.now()+id).toISOString(),sender_device_id:'remote-178281',sender_name:'Другой'},'header stabilization '+id,false,false);
    }
    scrollCoordinator.write(box,Math.max(0,box.scrollHeight-box.clientHeight-120),'auto');
    document.getElementById('msgInput').focus();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  });

  const result=await page.evaluate(()=>{
    const app=document.getElementById('appRoot');
    const box=document.getElementById('messages');
    const beforeScroll=box.scrollTop;
    const beforeHeight=app.style.getPropertyValue('--fpchat-visible-height');
    const correction=Number(FPViewport173.snapshot().correctionY||0);
    const original=app.getBoundingClientRect;
    app.getBoundingClientRect=function(){return {top:correction-18};};
    try{
      window.visualViewport.dispatchEvent(new Event('scroll'));
      const immediate=Number.parseFloat(app.style.getPropertyValue('--fpchat-viewport-correction-y'))||0;
      return{immediate,beforeScroll,afterScroll:box.scrollTop,beforeHeight,afterHeight:app.style.getPropertyValue('--fpchat-visible-height'),focused:document.activeElement===document.getElementById('msgInput')};
    }finally{app.getBoundingClientRect=original;}
  });

  assert.equal(result.focused,true,JSON.stringify(result));
  assert.ok(result.immediate>=17,'viewport correction waited for rAF instead of compensating the transient pan immediately: '+JSON.stringify(result));
  assert.equal(result.afterScroll,result.beforeScroll,'immediate header correction changed message scroll');
  assert.equal(result.afterHeight,result.beforeHeight,'immediate header correction changed visible-height path');
  await page.waitForTimeout(80);
  assert.deepEqual(errors,[]);
  console.log('PASS 178.28.1 focused visualViewport scroll updates correction synchronously before rAF');
  console.log('PASS 178.28.1 immediate correction leaves message scroll and visible-height untouched');
  console.log('NOTE native iOS keyboard animation still requires the user physical confirmation');
}).catch(error=>{console.error(error);process.exitCode=1;});
