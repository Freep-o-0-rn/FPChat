'use strict';
const assert=require('node:assert/strict');
const {run}=require('./browser-harness174.cjs');

run(async ({newClient,errors})=>{
  const page=await newClient();
  await page.setViewportSize({width:390,height:844});

  await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),secret='scroll17823';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})});
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    window.room17823=data.publicId;
    await openChat(data.publicId);

    const deadline=Date.now()+5000;
    while((!state.ws||state.ws.readyState!==WebSocket.OPEN)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
    if(!state.ws||state.ws.readyState!==WebSocket.OPEN)throw new Error('websocket not open');

    const box=document.getElementById('messages');
    box.style.height='260px';
    box.style.minHeight='260px';
    box.style.flex='0 0 260px';
    box.innerHTML='';
    box.dataset.lastDayKey='';

    window.addScrollMessage17823=(id)=>{
      const message={id,type:'text',status:'sent',created_at:new Date().toISOString(),sender_device_id:'remote-17823',sender_name:'Другой'};
      const node=appendMessage(box,message,'scroll owner '+id,false,false);
      node.style.minHeight='86px';
      node.style.height='86px';
      node.style.boxSizing='border-box';
      return node;
    };
    for(let id=1782301;id<=1782318;id++)addScrollMessage17823(id);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  });

  await page.evaluate(()=>{
    const box=document.getElementById('messages');
    box.scrollTop=box.scrollHeight;
    window.bottomBefore17823={atBottom:isMessagesAtBottom(box),scrollTop:box.scrollTop,max:Math.max(0,box.scrollHeight-box.clientHeight)};
    state.ws.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'message:deleted',roomId:room17823,messageId:1782302,scope:'all'})}));
  });
  await page.waitForTimeout(80);
  let snap=await page.evaluate(()=>{
    const box=document.getElementById('messages');
    return {before:bottomBefore17823,exists:Boolean(findMessageElement(1782302)),scrollTop:box.scrollTop,max:Math.max(0,box.scrollHeight-box.clientHeight),atBottom:isMessagesAtBottom(box)};
  });
  assert.equal(snap.before.atBottom,true,'fixture was not initially at bottom');
  assert.equal(snap.exists,false,'deleted bottom-case message remained mounted');
  assert.equal(snap.atBottom,true,'deletion no longer keeps an already-bottom viewport at bottom');
  assert.ok(Math.abs(snap.scrollTop-snap.max)<=1,'bottom target changed after deletion');

  await page.evaluate(()=>{
    const box=document.getElementById('messages');
    box.scrollTop=Math.min(650,Math.max(0,box.scrollHeight-box.clientHeight-300));
    const el=findMessageElement(1782303);
    const boxRect=box.getBoundingClientRect();
    const elRect=el.getBoundingClientRect();
    if(!(elRect.bottom<=boxRect.top+1))throw new Error('remove-above fixture message is not above viewport');
    window.aboveBefore17823={beforeTop:box.scrollTop,beforeHeight:box.scrollHeight,atBottom:isMessagesAtBottom(box)};
    state.ws.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'message:deleted',roomId:room17823,messageId:1782303,scope:'all'})}));
  });
  await page.waitForTimeout(80);
  snap=await page.evaluate(()=>{
    const box=document.getElementById('messages');
    const removedHeight=Math.max(0,aboveBefore17823.beforeHeight-box.scrollHeight);
    const max=Math.max(0,box.scrollHeight-box.clientHeight);
    const expected=Math.max(0,Math.min(aboveBefore17823.beforeTop-removedHeight,max));
    return {before:aboveBefore17823,removedHeight,expected,actual:box.scrollTop,exists:Boolean(findMessageElement(1782303))};
  });
  assert.equal(snap.before.atBottom,false,'remove-above fixture unexpectedly started at bottom');
  assert.equal(snap.exists,false,'deleted remove-above message remained mounted');
  assert.ok(snap.removedHeight>0,'remove-above fixture did not change scroll height');
  assert.ok(Math.abs(snap.actual-snap.expected)<=1,'remove-above target changed: expected '+snap.expected+', got '+snap.actual);

  assert.deepEqual(errors,[]);
  console.log('PASS 178.23 bottom deletion preserves the existing bottom target');
  console.log('PASS 178.23 remove-above deletion preserves beforeTop - removedHeight');
}).catch(error=>{console.error(error);process.exitCode=1;});
