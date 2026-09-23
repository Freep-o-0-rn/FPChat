'use strict';
const assert=require('node:assert/strict');
const {run}=require('./browser-harness174.cjs');

run(async({newClient,errors})=>{
  const page=await newClient(async p=>{await p.setViewportSize({width:390,height:844});});

  await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),secret='viewport17828';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})});
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    window.room17828=data.publicId;
    await openChat(data.publicId);

    const box=document.getElementById('messages');
    for(let id=1782801;id<=1782835;id++){
      const m={id,type:'text',status:'read',created_at:new Date(Date.now()+id).toISOString(),sender_device_id:'remote-17828',sender_name:'Другой'};
      const node=appendMessage(box,m,'viewport row '+id+' '+('line '.repeat((id%4)+1)),false,false);
      node.style.minHeight=(58+(id%5)*9)+'px';
    }
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    window.geometry17828=()=>{
      const app=document.getElementById('appRoot').getBoundingClientRect();
      const header=document.querySelector('.chat-header').getBoundingClientRect();
      const composer=document.querySelector('.composer').getBoundingClientRect();
      const box=document.getElementById('messages');
      return{
        app:{top:app.top,bottom:app.bottom,height:app.height},
        header:{top:header.top,bottom:header.bottom},
        composer:{top:composer.top,bottom:composer.bottom,height:composer.height,paddingBottom:getComputedStyle(document.querySelector('.composer')).paddingBottom},
        scrollTop:box.scrollTop,max:Math.max(0,box.scrollHeight-box.clientHeight),
        domCallbacks:FPDOM173.snapshot().observerCallbacks,
        viewport:FPViewport173.snapshot(),
        keyboard:window.FPViewport136?.snapshot?.()||null
      };
    };
  });

  const assertVisibleRows=(snap,label)=>{
    assert.ok(snap.header.top>=snap.app.top-2,label+' header escaped above app viewport: '+JSON.stringify(snap));
    assert.ok(snap.header.bottom<=snap.app.bottom+2,label+' header escaped app viewport: '+JSON.stringify(snap));
    assert.ok(snap.composer.top>=snap.app.top-2,label+' composer escaped above app viewport: '+JSON.stringify(snap));
    assert.ok(snap.composer.bottom<=snap.app.bottom+2,label+' composer escaped below app viewport: '+JSON.stringify(snap));
    assert.ok(snap.composer.height>0,label+' composer collapsed');
  };

  // Keyboard-open analogue: user is at bottom, focus composer, shrink visual viewport.
  await page.evaluate(()=>{const box=document.getElementById('messages');scrollCoordinator.write(box,box.scrollHeight,'auto');document.getElementById('msgInput').focus();});
  await page.setViewportSize({width:390,height:520});
  await page.waitForTimeout(1350);
  let snap=await page.evaluate(()=>geometry17828());
  assertVisibleRows(snap,'keyboard-open');
  assert.ok(Math.abs(snap.scrollTop-snap.max)<=2,'bottom intent was lost while keyboard opened: '+JSON.stringify(snap));

  // Keyboard-close analogue: blur and restore the previous viewport height.
  await page.evaluate(()=>document.getElementById('msgInput').blur());
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(1350);
  snap=await page.evaluate(()=>geometry17828());
  assertVisibleRows(snap,'keyboard-close');
  assert.ok(Math.abs(snap.scrollTop-snap.max)<=2,'bottom intent was lost while keyboard closed: '+JSON.stringify(snap));

  // Reader away from bottom: keyboard changes must not steal the user's visible anchor.
  const readerBefore=await page.evaluate(()=>{
    const box=document.getElementById('messages');
    box.scrollTop=Math.min(520,Math.max(80,box.scrollHeight-box.clientHeight-300));
    const anchor=getFirstVisibleMessageAnchor(box);
    const node=findMessageElement(anchor.anchorMessageId);
    const offset=node.getBoundingClientRect().top-box.getBoundingClientRect().top;
    document.getElementById('msgInput').focus();
    return{anchor,offset,scrollTop:box.scrollTop};
  });
  await page.setViewportSize({width:390,height:520});
  await page.waitForTimeout(500);
  const readerAfter=await page.evaluate(anchor=>{
    const box=document.getElementById('messages'),node=findMessageElement(anchor.anchorMessageId);
    return{offset:node.getBoundingClientRect().top-box.getBoundingClientRect().top,scrollTop:box.scrollTop,max:Math.max(0,box.scrollHeight-box.clientHeight)};
  },readerBefore.anchor);
  assert.ok(Math.abs(readerAfter.offset-readerBefore.offset)<=2,'keyboard opening stole reader anchor: '+JSON.stringify({readerBefore,readerAfter}));
  assert.ok(Math.abs(readerAfter.scrollTop-readerBefore.scrollTop)<=2,'keyboard opening changed reader scrollTop: '+JSON.stringify({readerBefore,readerAfter}));

  // Orientation analogue: close keyboard, switch to landscape and fire orientationchange.
  await page.evaluate(()=>document.getElementById('msgInput').blur());
  const callbacksBefore=await page.evaluate(()=>FPDOM173.snapshot().observerCallbacks);
  await page.setViewportSize({width:844,height:390});
  await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));
  await page.waitForTimeout(1400);
  snap=await page.evaluate(()=>geometry17828());
  assertVisibleRows(snap,'orientation-landscape');
  assert.equal(snap.viewport.bottomPin,false,'orientation change left bottom pin active');

  // No observer loop: after all finite settle timers have elapsed, child-list callback count stabilizes.
  const stableA=await page.evaluate(()=>FPDOM173.snapshot().observerCallbacks);
  await page.waitForTimeout(700);
  const stableB=await page.evaluate(()=>FPDOM173.snapshot().observerCallbacks);
  assert.ok(stableA-callbacksBefore<12,'viewport transition caused excessive DOM lifecycle churn: '+JSON.stringify({callbacksBefore,stableA}));
  assert.equal(stableB,stableA,'DOM lifecycle observer kept firing after viewport settle');

  // Return portrait and ensure controls are still reachable.
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));
  await page.waitForTimeout(1400);
  snap=await page.evaluate(()=>geometry17828());
  assertVisibleRows(snap,'orientation-portrait');

  assert.deepEqual(errors,[]);
  console.log('PASS 178.28 synthetic keyboard open keeps header/composer visible and preserves bottom intent');
  console.log('PASS 178.28 synthetic keyboard close restores viewport without extra geometry or jump');
  console.log('PASS 178.28 reader away from bottom keeps its anchor while viewport shrinks');
  console.log('PASS 178.28 landscape/portrait transitions settle without persistent FPDOM173 observer churn');
  console.log('NOTE headless Chromium approximates viewport/keyboard geometry; physical iOS/Android acceptance remains deferred');
}).catch(error=>{console.error(error);process.exitCode=1;});
