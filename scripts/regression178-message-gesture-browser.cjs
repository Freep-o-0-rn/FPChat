'use strict';
const assert=require('node:assert/strict');
const {run}=require('./browser-harness174.cjs');

run(async ({newClient,errors})=>{
  const page=await newClient();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),secret='gesture17819';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})});
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    await openChat(data.publicId);

    window.gesture17819={reply:0};
    const originalReply=setSelectedReply;
    setSelectedReply=function(...args){gesture17819.reply+=1;return originalReply.apply(this,args);};

    const box=document.getElementById('messages');
    const message={id:1781901,type:'text',status:'sent',created_at:new Date().toISOString(),sender_device_id:'remote-17819',sender_name:'Другой'};
    window.messageNode17819=appendMessage(box,message,'gesture test',false,false);
    window.touch17819=(target,type,x=220,y=360,count=1)=>{
      const touch={identifier:17819,target,clientX:x,clientY:y};
      const event=new Event(type,{bubbles:true,cancelable:true});
      const ended=type==='touchend'||type==='touchcancel';
      Object.defineProperties(event,{touches:{value:ended?[]:Array.from({length:count},()=>touch)},changedTouches:{value:[touch]}});
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
  });

  await page.waitForSelector('.bubble-wrap.msg[data-message-id="1781901"]');
  const reset=async()=>{
    await page.evaluate(()=>{
      document.querySelector('.message-context-backdrop')?.click();
      gesture17819.reply=0;
      const node=messageNode17819;
      node?.querySelector('.bubble')?.style.removeProperty('transform');
      node?.classList.remove('swiping','swipe-reset');
    });
    await page.waitForTimeout(40);
  };
  const snapshot=()=>page.evaluate(()=>({reply:gesture17819.reply,context:Boolean(document.querySelector('.message-context-root')),action:FPGesture135.snapshot().touch?.action||null}));

  await reset();
  await page.evaluate(()=>touch17819(messageNode17819,'touchstart',220,360));
  await page.waitForTimeout(520);
  let state1=await snapshot();
  assert.equal(state1.context,true,'long press did not open context');
  assert.equal(state1.reply,0,'long press also executed reply');
  await page.evaluate(()=>{touch17819(messageNode17819,'touchmove',145,360);touch17819(messageNode17819,'touchend',145,360);});
  await page.waitForTimeout(60);
  state1=await snapshot();
  assert.equal(state1.reply,0,'reply revived after long press had already claimed the touch');

  await reset();
  await page.evaluate(()=>{touch17819(messageNode17819,'touchstart',220,360);touch17819(messageNode17819,'touchmove',155,360);});
  await page.waitForTimeout(520);
  let state2=await snapshot();
  assert.equal(state2.context,false,'long press fired after reply swipe had claimed the touch');
  await page.evaluate(()=>touch17819(messageNode17819,'touchend',155,360));
  await page.waitForTimeout(60);
  state2=await snapshot();
  assert.equal(state2.reply,1,'reply swipe did not execute exactly once');
  assert.equal(state2.context,false,'reply swipe also opened context');

  await reset();
  await page.evaluate(()=>{
    touch17819(messageNode17819,'touchstart',220,360);
    touch17819(messageNode17819,'touchmove',155,360);
    touch17819(messageNode17819,'touchmove',205,360);
  });
  await page.waitForTimeout(520);
  let state3=await snapshot();
  assert.equal(state3.context,false,'long press revived after losing ownership to reply swipe');
  await page.evaluate(()=>touch17819(messageNode17819,'touchend',205,360));
  await page.waitForTimeout(60);
  state3=await snapshot();
  assert.equal(state3.reply,0,'reply executed despite returning below the old 52px final threshold');
  assert.equal(state3.context,false,'context opened after reply claimed then returned below threshold');

  assert.deepEqual(errors,[]);
  console.log('PASS 178.19 long press wins without reply');
  console.log('PASS 178.19 reply swipe wins without context');
  console.log('PASS 178.19 losing recognizer does not revive; old final reply threshold remains');
  console.log('NOTE synthetic Chromium touch; physical mobile gesture acceptance still required');
}).catch(error=>{console.error(error);process.exitCode=1;});
