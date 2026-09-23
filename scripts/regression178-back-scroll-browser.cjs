'use strict';
const assert=require('node:assert/strict');
const {run}=require('./browser-harness174.cjs');

run(async ({newClient,errors})=>{
  const page=await newClient();
  await page.setViewportSize({width:390,height:844});

  await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),secret='backscroll17820';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})});
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    window.room17820=data.publicId;
    await openChat(data.publicId);

    window.backScroll17820={reply:0};
    const originalReply=setSelectedReply;
    setSelectedReply=function(...args){backScroll17820.reply+=1;return originalReply.apply(this,args);};

    const box=document.getElementById('messages');
    const message={id:1782001,type:'text',status:'sent',created_at:new Date().toISOString(),sender_device_id:'remote-17820',sender_name:'Другой'};
    window.message17820=appendMessage(box,message,'back scroll test',false,false);
    window.touch17820=(target,type,x,y,count=1)=>{
      const touch={identifier:17820,target,clientX:x,clientY:y};
      const event=new Event(type,{bubbles:true,cancelable:true});
      const ended=type==='touchend'||type==='touchcancel';
      Object.defineProperties(event,{touches:{value:ended?[]:Array.from({length:count},()=>touch)},changedTouches:{value:[touch]}});
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
  });

  // Chat back begins on a message at the left edge. Navigation must win without reply/context.
  await page.evaluate(()=>{
    touch17820(message17820,'touchstart',12,360);
    touch17820(message17820,'touchmove',105,364);
    touch17820(message17820,'touchend',105,364);
  });
  // Build 183 commits the existing room exit after its visual transition.
  await page.waitForFunction(()=>!document.querySelector('.chat-view'));
  let snap=await page.evaluate(()=>({chat:Boolean(document.querySelector('.chat-view')),reply:backScroll17820.reply,context:Boolean(document.querySelector('.message-context-root')),view:state.view}));
  assert.equal(snap.chat,false,'chat back did not leave chat');
  assert.equal(snap.reply,0,'chat back produced a false reply');
  assert.equal(snap.context,false,'chat back produced a false message context menu');

  // Modern settings edge-back uses the same navigation owner and must not create message actions.
  await page.evaluate(()=>setView('settings'));
  await page.waitForSelector('.fp-settings131');
  await page.evaluate(()=>{
    const root=document.querySelector('.fp-settings131');
    touch17820(root,'touchstart',12,360);
    touch17820(root,'touchmove',100,362);
    touch17820(root,'touchend',100,362);
  });
  await page.waitForTimeout(220);
  snap=await page.evaluate(()=>({settings:Boolean(document.querySelector('.fp-settings131')),reply:backScroll17820.reply,context:Boolean(document.querySelector('.message-context-root')),view:state.view}));
  assert.equal(snap.settings,false,'settings back did not return to parent/chats');
  assert.equal(snap.reply,0,'settings back produced a false reply');
  assert.equal(snap.context,false,'settings back produced a false context menu');

  // Reopen chat and verify vertical message drag away from the reserved edge.
  await page.evaluate(async()=>{await openChat(room17820);});
  await page.waitForSelector('#messages');
  await page.evaluate(()=>{
    const box=document.getElementById('messages');
    const message={id:1782002,type:'text',status:'sent',created_at:new Date().toISOString(),sender_device_id:'remote-17820b',sender_name:'Другой'};
    window.verticalMessage17820=appendMessage(box,message,'vertical scroll test',false,false);
    backScroll17820.reply=0;
  });
  const prevented=await page.evaluate(()=>{
    const start=touch17820(verticalMessage17820,'touchstart',180,520);
    const move=touch17820(verticalMessage17820,'touchmove',184,430);
    const end=touch17820(verticalMessage17820,'touchend',184,430);
    return {start,move,end};
  });
  await page.waitForTimeout(520);
  snap=await page.evaluate(()=>({reply:backScroll17820.reply,context:Boolean(document.querySelector('.message-context-root')),touch:FPGesture135.snapshot().touch}));
  assert.deepEqual(prevented,{start:false,move:false,end:false},'vertical message drag was JS-prevented outside edge zone');
  assert.equal(snap.reply,0,'vertical scroll produced a false reply');
  assert.equal(snap.context,false,'vertical scroll produced a false context menu');
  assert.equal(snap.touch,null,'vertical gesture left an active touch session');

  // Settings vertical drag away from edge must likewise remain unclaimed/unprevented.
  await page.evaluate(()=>showChatsList());
  await page.evaluate(()=>setView('settings'));
  await page.waitForSelector('.fp-settings131');
  const settingsPrevented=await page.evaluate(()=>{
    const root=document.querySelector('.fp-settings131-body');
    const start=touch17820(root,'touchstart',180,560);
    const move=touch17820(root,'touchmove',184,450);
    const end=touch17820(root,'touchend',184,450);
    return {start,move,end};
  });
  assert.deepEqual(settingsPrevented,{start:false,move:false,end:false},'vertical settings drag was JS-prevented outside edge zone');

  assert.deepEqual(errors,[]);
  console.log('PASS 178.20 chat back wins without false reply/context');
  console.log('PASS 178.20 settings back returns without false message action');
  console.log('PASS 178.20 vertical message/settings drags remain unprevented outside the reserved edge zone');
  console.log('NOTE synthetic Chromium cannot prove native iOS scrolling/edge-back; physical acceptance remains required');
}).catch(error=>{console.error(error);process.exitCode=1;});
