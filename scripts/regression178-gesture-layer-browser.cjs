'use strict';
const assert=require('node:assert/strict');
const {run}=require('./browser-harness174.cjs');

run(async ({newClient,errors})=>{
  const page=await newClient();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),secret='gesture17821';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})});
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    await openChat(data.publicId);

    window.lifecycle17821={cancel:[],claims:[]};
    const target=document.querySelector('.chat-view')||document.getElementById('messages');
    window.target17821=target;
    window.touch17821=(type,x=180,y=400,count=1)=>{
      const touch={identifier:17821,target,clientX:x,clientY:y};
      const event=new Event(type,{bubbles:true,cancelable:true});
      const ended=type==='touchend'||type==='touchcancel';
      Object.defineProperties(event,{touches:{value:ended?[]:Array.from({length:count},()=>touch)},changedTouches:{value:[touch]}});
      target.dispatchEvent(event);
      return event;
    };
    window.pointer17821=(type,id=91)=>{
      const event=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',button:0,clientX:200,clientY:420});
      target.dispatchEvent(event);
      return event;
    };
    target.addEventListener('touchstart',(event)=>{
      if(window.installLowerWatcher17821!==true)return;
      window.lowerLease17821=FPGesture135.watchAction('lower-17821',event,(reason)=>lifecycle17821.cancel.push(['lower',reason]));
    });
    target.addEventListener('pointerdown',(event)=>{
      if(window.installPointerWatcher17821!==true)return;
      window.pointerLease17821=FPGesture135.watchAction('pointer-17821',event,(reason)=>lifecycle17821.cancel.push(['pointer',reason]));
    });
  });

  // Start lower chat gesture, then mount a higher context layer.
  await page.evaluate(()=>{installLowerWatcher17821=true;touch17821('touchstart');});
  await page.waitForTimeout(30);
  let snap=await page.evaluate(()=>FPGesture135.snapshot());
  assert.equal(snap.touch?.layer,'chat','touch did not start in chat layer');
  assert.equal(snap.touch?.pendingActions,1,'lower watcher did not register');

  await page.evaluate(()=>{
    const overlay=document.createElement('div');
    overlay.className='message-context-root';
    overlay.id='overlay17821';
    document.body.appendChild(overlay);
  });
  await page.waitForTimeout(40);
  snap=await page.evaluate(()=>FPGesture135.snapshot());
  assert.equal(snap.touch?.layer,'context','active touch was not promoted to context');
  assert.deepEqual(await page.evaluate(()=>lifecycle17821.cancel),[['lower','layer']],'lower watcher was not cancelled exactly once by layer promotion');

  // Remove upper layer before finger release: same session must stay context.
  await page.evaluate(()=>document.getElementById('overlay17821')?.remove());
  await page.waitForTimeout(40);
  snap=await page.evaluate(()=>FPGesture135.snapshot());
  assert.equal(snap.topLayer,'chat','actual top layer did not return to chat after overlay close');
  assert.equal(snap.touch?.layer,'context','same active gesture demoted/revived on lower screen');
  assert.equal(await page.evaluate(()=>lowerLease17821.claim()),false,'stale cancelled lower lease could claim after overlay close');

  // A touch restart invalidates only the old touch lease.
  await page.evaluate(()=>{window.oldLowerLease17821=window.lowerLease17821;touch17821('touchstart');});
  await page.waitForTimeout(20);
  assert.equal(await page.evaluate(()=>oldLowerLease17821.claim()),false,'old touch lease survived touch restart');

  // Create pointer session in parallel; cancelling touch must not clear pointer.
  await page.evaluate(()=>{installPointerWatcher17821=true;pointer17821('pointerdown',91);});
  await page.waitForTimeout(20);
  snap=await page.evaluate(()=>FPGesture135.snapshot());
  assert.ok(snap.touch,'touch session missing before touchcancel');
  assert.ok(snap.pointer,'pointer session missing before touchcancel');
  await page.evaluate(()=>touch17821('touchcancel'));
  await page.waitForTimeout(20);
  snap=await page.evaluate(()=>FPGesture135.snapshot());
  assert.equal(snap.touch,null,'touchcancel did not clear touch session');
  assert.ok(snap.pointer,'touchcancel incorrectly cleared pointer session');

  // Pointer cancel clears only pointer. Then a new touch remains alive.
  await page.evaluate(()=>{touch17821('touchstart');pointer17821('pointercancel',91);});
  await page.waitForTimeout(20);
  snap=await page.evaluate(()=>FPGesture135.snapshot());
  assert.ok(snap.touch,'pointercancel incorrectly cleared touch session');
  assert.equal(snap.pointer,null,'pointercancel did not clear pointer session');
  await page.evaluate(()=>touch17821('touchcancel'));

  assert.deepEqual(errors,[]);
  console.log('PASS 178.21 upper layer cancels lower action and active session never demotes');
  console.log('PASS 178.21 cancelled stale lease cannot revive after overlay closes');
  console.log('PASS 178.21 touch/pointer restart and cancel remain isolated by session kind');
  console.log('NOTE synthetic Chromium; physical gesture/lifecycle acceptance still required');
}).catch(error=>{console.error(error);process.exitCode=1;});
