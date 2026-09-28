'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const textSend=fs.readFileSync(path.join(root,'public/text-send170.js'),'utf8');
const submitStart=textSend.indexOf('  async function submit(event) {');
const submitEnd=textSend.indexOf('\n  function dispatchSubmit(event)',submitStart);
assert(submitStart>=0&&submitEnd>submitStart,'FPTextSend170 submit executor missing');
const submitBlock=textSend.slice(submitStart,submitEnd);
const guardAt=submitBlock.indexOf('if (sendingForms.has(form)) return;');
const addAt=submitBlock.indexOf('sendingForms.add(form);');
const draftDeleteAt=submitBlock.indexOf('await clearDraftOnServer(roomId)');
const releaseAt=submitBlock.indexOf('sendingForms.delete(form);');
assert(guardAt>=0,'sendingForms double-submit guard missing');
assert(addAt>guardAt,'sendingForms must be acquired after guard');
assert(draftDeleteAt>addAt,'draft DELETE must currently occur while sendingForms is acquired');
assert(releaseAt>draftDeleteAt,'sendingForms must currently be released only after draft DELETE await');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());

  let releaseDelete;
  const deleteGate=new Promise(resolve=>{releaseDelete=resolve;});
  let heldDeletes=0;

  await page.route('**/api/rooms/*/draft',async route=>{
    const request=route.request();
    if(request.method()==='DELETE'){
      heldDeletes++;
      await deleteGate;
    }
    await route.continue();
  });

  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() =>
    window.FPTextSend170?.bindCurrentForm &&
    window.FPSendManager177?.dispatch &&
    window.FPConnection170?.ensureConnected &&
    typeof openChat==='function' &&
    !document.getElementById('bootHold152')
  );

  const fixture=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='next-plan-send-draft-lock';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok)throw new Error('room fixture failed '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    await openChat(data.publicId);
    await FPConnection170.ensureConnected(deviceId);
    return {roomId:data.publicId,deviceId};
  });

  await page.waitForSelector('#msgInput');
  await page.waitForFunction(()=>state?.ws?.readyState===WebSocket.OPEN);

  await page.evaluate(()=>{
    window.__fpNext1={
      queued:[],
      originalQueue:window.queuePendingTextSend
    };
    window.queuePendingTextSend=function(payload){
      window.__fpNext1.queued.push({
        clientMessageId:String(payload?.clientMessageId||''),
        roomId:String(payload?.roomId||'')
      });
      return window.__fpNext1.originalQueue(payload);
    };
  });

  const first='next-plan-first-'+Date.now();
  const second='next-plan-second-'+Date.now();

  try{
    await page.locator('#msgInput').fill(first);
    await page.locator('#sendBtn').click();

    await page.waitForFunction(text=>{
      const row=[...document.querySelectorAll('#messages .bubble-wrap.msg')]
        .find(node=>node.textContent?.includes(text));
      return row&&/^\d+$/.test(String(row.dataset.messageId||row.dataset.id||''));
    },first);

    await page.waitForFunction(()=>window.__fpNext1?.queued?.length===1);
    await page.waitForFunction(()=>document.getElementById('msgInput')?.value==='');

    for(let i=0;i<100&&heldDeletes<1;i++)await page.waitForTimeout(20);
    assert.equal(heldDeletes,1,'first send must be waiting on the delayed draft DELETE after ACK');

    const firstState=await page.evaluate(()=>({
      queued:[...window.__fpNext1.queued],
      value:document.getElementById('msgInput')?.value||'',
      socketOpen:state?.ws?.readyState===WebSocket.OPEN
    }));
    assert.equal(firstState.queued.length,1,'first message must enter existing pending queue exactly once');
    assert.equal(firstState.value,'','composer must already be cleared before delayed DELETE resolves');
    assert.equal(firstState.socketOpen,true,'socket must remain open while DELETE is delayed');

    await page.locator('#msgInput').fill(second);
    await page.locator('#sendBtn').click();
    await page.waitForTimeout(250);

    const blocked=await page.evaluate(text=>({
      queued:[...window.__fpNext1.queued],
      secondBubble:[...document.querySelectorAll('#messages .bubble-wrap.msg')]
        .some(node=>node.textContent?.includes(text)),
      inputValue:document.getElementById('msgInput')?.value||''
    }),second);

    assert.equal(blocked.queued.length,1,
      'second submit must not enter queue while the form remains in sendingForms');
    assert.equal(blocked.secondBubble,false,
      'second submit must not create an optimistic message while delayed DELETE keeps sendingForms locked');
    assert.equal(blocked.inputValue,second,
      'blocked second text must remain in the composer');

    releaseDelete();
    await page.waitForTimeout(50);

    await page.locator('#sendBtn').click();
    await page.waitForFunction(()=>window.__fpNext1?.queued?.length===2);
    await page.waitForFunction(text=>[...document.querySelectorAll('#messages .bubble-wrap.msg')]
      .some(node=>node.textContent?.includes(text)),second);

    const afterRelease=await page.evaluate(()=>({
      queued:[...window.__fpNext1.queued],
      value:document.getElementById('msgInput')?.value||''
    }));
    assert.equal(afterRelease.queued.length,2,
      'same second text must enter the existing queue after delayed DELETE releases sendingForms');
    assert.notEqual(afterRelease.queued[0].clientMessageId,afterRelease.queued[1].clientMessageId,
      'two distinct texts must have distinct clientMessageId values');

    console.log('PASS first text receives ACK while draft DELETE is deliberately held');
    console.log('PASS delayed draft DELETE keeps FPTextSend170 sendingForms guard active after ACK');
    console.log('PASS second distinct submit does not enter queue while sendingForms is held');
    console.log('PASS second text enters existing pending queue immediately after DELETE releases');
    console.log(JSON.stringify({
      suite:'next-plan item 1 repeated-send draft lock',
      reproduced:true,
      firstQueueEntries:1,
      queueEntriesWhileDeleteHeld:1,
      secondEnteredQueueWhileHeld:false,
      secondEnteredQueueAfterRelease:true
    }));
  } finally {
    releaseDelete();
    await page.evaluate(()=>{
      if(window.__fpNext1?.originalQueue)window.queuePendingTextSend=window.__fpNext1.originalQueue;
      delete window.__fpNext1;
    });
    await page.unroute('**/api/rooms/*/draft');
  }

  assert.deepEqual(errors,[]);
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
