'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');

assert(!index.includes('await replyVisualReady184;'),'reply visual must not remain in the mandatory startup wait');
assert(index.includes('const replyVisualReady184 = Promise.all'),'reply visual loading/failure aggregation must remain');
assert(index.includes('if (loaded.includes(false)) window.FPReplySwipeVisual184 = null;'),'reply visual failure fallback must remain');
assert(app.includes("swipeIcon=replyVisual?.root||document.createElement('div')"),'legacy reply indicator fallback must remain');
assert(app.includes("if(!replyVisual){swipeIcon.className='swipe-reply-icon';swipeIcon.textContent='↩';}"),'fallback reply UI must remain usable before visual load');

run(async({browser,origin,errors})=>{
  const touch=async(page,selector)=>{
    await page.locator(selector).evaluate(node=>{
      const target=node.querySelector('.message-text')||node.querySelector('.bubble')||node;
      const emit=(type,x)=>{
        const point={identifier:7,target,clientX:x,clientY:200,pageX:x,pageY:200};
        const event=new Event(type,{bubbles:true,cancelable:true});
        Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[point]});
        Object.defineProperty(event,'changedTouches',{value:[point]});
        target.dispatchEvent(event);
      };
      emit('touchstart',250);
      emit('touchmove',220);
    });
  };
  const finishTouch=async(page,selector)=>{
    await page.locator(selector).evaluate(node=>{
      const target=node.querySelector('.message-text')||node.querySelector('.bubble')||node;
      const point={identifier:7,target,clientX:220,clientY:200,pageX:220,pageY:200};
      const event=new Event('touchend',{bubbles:true,cancelable:true});
      Object.defineProperty(event,'touches',{value:[]});
      Object.defineProperty(event,'changedTouches',{value:[point]});
      target.dispatchEvent(event);
    });
  };
  const createRoomAndOpen=async page=>page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),secret='next5-reply-visual';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      displayName:state.nick,deviceId,roomSecret:secret,...recovery
    })});
    if(!response.ok)throw new Error('fixture room '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    await openChat(data.publicId);
    await FPConnection170.ensureConnected(deviceId);
    return data.publicId;
  });

  // Delay case: app and owners must become usable before the optional visual JS resolves.
  const delayed=await browser.newPage({viewport:{width:390,height:844}});
  delayed.on('pageerror',e=>errors.push(e.message));
  delayed.on('dialog',d=>d.dismiss());
  let releaseVisual;
  const gate=new Promise(resolve=>{releaseVisual=resolve;});
  let visualRequested=false;
  await delayed.route('**/reply-swipe-visual184.js*',async route=>{
    visualRequested=true;
    await gate;
    await route.continue();
  });

  const started=Date.now();
  await delayed.goto(origin,{waitUntil:'domcontentloaded'});
  await delayed.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
  const bootBeforeReleaseMs=Date.now()-started;
  assert.equal(visualRequested,true,'delayed visual file must be requested');
  assert.equal(await delayed.evaluate(()=>Boolean(window.FPReplySwipeVisual184)),false,'visual must still be absent before release');
  assert.equal(await delayed.evaluate(()=>Boolean(window.FPConnection170&&window.FPSendManager177&&window.FPMediaSend170)),true,'required owners must install before optional visual resolves');

  await createRoomAndOpen(delayed);
  const first='next5-fallback-'+Date.now();
  await delayed.locator('#msgInput').fill(first);
  await delayed.locator('#sendBtn').click();
  await delayed.waitForFunction(text=>[...document.querySelectorAll('#messages .msg')].some(n=>n.textContent?.includes(text)),first);
  const firstSelector='#messages .msg';
  const firstIndex=await delayed.locator(firstSelector).evaluateAll((nodes,text)=>nodes.findIndex(n=>n.textContent?.includes(text)),first);
  assert(firstIndex>=0,'first delayed-load message missing');
  const firstRow=delayed.locator(firstSelector).nth(firstIndex);
  await touch(delayed,`#messages .msg:nth-of-type(${firstIndex+1})`).catch(async()=>{
    await firstRow.evaluate(node=>{
      const target=node.querySelector('.message-text')||node.querySelector('.bubble')||node;
      const emit=(type,x)=>{
        const point={identifier:7,target,clientX:x,clientY:200,pageX:x,pageY:200};
        const event=new Event(type,{bubbles:true,cancelable:true});
        Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[point]});
        Object.defineProperty(event,'changedTouches',{value:[point]});
        target.dispatchEvent(event);
      };
      emit('touchstart',250);emit('touchmove',220);
    });
  });
  const fallbackState=await firstRow.evaluate(node=>({
    indicator:node.querySelector('.swipe-reply-icon')?.textContent||'',
    enhanced:Boolean(node.querySelector('.fp-reply-indicator'))
  }));
  assert.equal(fallbackState.indicator,'↩','legacy reply indicator must work while visual file is delayed');
  assert.equal(fallbackState.enhanced,false,'enhanced visual must not exist before delayed file resolves');
  await firstRow.evaluate(node=>{
    const target=node.querySelector('.message-text')||node.querySelector('.bubble')||node;
    const point={identifier:7,target,clientX:220,clientY:200,pageX:220,pageY:200};
    const event=new Event('touchend',{bubbles:true,cancelable:true});
    Object.defineProperty(event,'touches',{value:[]});
    Object.defineProperty(event,'changedTouches',{value:[point]});
    target.dispatchEvent(event);
  });

  const releaseAt=Date.now();
  releaseVisual();
  await delayed.waitForFunction(()=>Boolean(window.FPReplySwipeVisual184),null,{timeout:10000});
  const lateLoadMs=Date.now()-releaseAt;

  const second='next5-enhanced-'+Date.now();
  await delayed.locator('#msgInput').fill(second);
  await delayed.locator('#sendBtn').click();
  await delayed.waitForFunction(text=>[...document.querySelectorAll('#messages .msg')].some(n=>n.textContent?.includes(text)),second);
  const secondIndex=await delayed.locator(firstSelector).evaluateAll((nodes,text)=>nodes.findIndex(n=>n.textContent?.includes(text)),second);
  assert(secondIndex>=0,'second late-load message missing');
  const secondRow=delayed.locator(firstSelector).nth(secondIndex);
  await secondRow.evaluate(node=>{
    const target=node.querySelector('.message-text')||node.querySelector('.bubble')||node;
    const emit=(type,x)=>{
      const point={identifier:8,target,clientX:x,clientY:200,pageX:x,pageY:200};
      const event=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[point]});
      Object.defineProperty(event,'changedTouches',{value:[point]});
      target.dispatchEvent(event);
    };
    emit('touchstart',250);emit('touchmove',220);
  });
  const enhancedState=await secondRow.evaluate(node=>({
    enhanced:Boolean(node.querySelector('.fp-reply-indicator')),
    state:node.querySelector('.fp-reply-indicator')?.dataset.state||null
  }));
  assert.equal(enhancedState.enhanced,true,'messages rendered after late load must use enhanced reply visual');
  assert.notEqual(enhancedState.state,'hidden','enhanced visual must react to swipe after late load');
  await delayed.close();

  // Error case: abort only the chosen visual JS. Startup and fallback reply must still work.
  const failed=await browser.newPage({viewport:{width:390,height:844}});
  failed.on('pageerror',e=>errors.push(e.message));
  failed.on('dialog',d=>d.dismiss());
  await failed.route('**/reply-swipe-visual184.js*',route=>route.abort('failed'));
  await failed.goto(origin,{waitUntil:'domcontentloaded'});
  await failed.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'),null,{timeout:30000});
  assert.equal(await failed.evaluate(()=>Boolean(window.FPReplySwipeVisual184)),false,'failed visual JS must leave enhanced visual unavailable');
  assert.equal(await failed.evaluate(()=>Boolean(window.FPConnection170&&window.FPSendManager177&&window.FPMediaSend170)),true,'visual failure must not break required owners');

  await createRoomAndOpen(failed);
  const errorText='next5-error-fallback-'+Date.now();
  await failed.locator('#msgInput').fill(errorText);
  await failed.locator('#sendBtn').click();
  await failed.waitForFunction(text=>[...document.querySelectorAll('#messages .msg')].some(n=>n.textContent?.includes(text)),errorText);
  const errorIndex=await failed.locator(firstSelector).evaluateAll((nodes,text)=>nodes.findIndex(n=>n.textContent?.includes(text)),errorText);
  const errorRow=failed.locator(firstSelector).nth(errorIndex);
  await errorRow.evaluate(node=>{
    const target=node.querySelector('.message-text')||node.querySelector('.bubble')||node;
    const emit=(type,x)=>{
      const point={identifier:9,target,clientX:x,clientY:200,pageX:x,pageY:200};
      const event=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[point]});
      Object.defineProperty(event,'changedTouches',{value:[point]});
      target.dispatchEvent(event);
    };
    emit('touchstart',250);emit('touchmove',220);
  });
  assert.equal(await errorRow.evaluate(node=>node.querySelector('.swipe-reply-icon')?.textContent||''),'↩','fallback reply indicator must survive visual JS failure');
  await failed.close();

  assert.deepEqual(errors,[]);
  console.log('PASS delayed reply visual no longer blocks app/owner boot');
  console.log('PASS fallback reply indicator works before visual load');
  console.log('PASS late visual load upgrades subsequently rendered messages');
  console.log('PASS reply visual JS failure does not block startup and keeps fallback');
  console.log('NEXT5_RESULT '+JSON.stringify({bootBeforeReleaseMs,lateLoadMs}));
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
