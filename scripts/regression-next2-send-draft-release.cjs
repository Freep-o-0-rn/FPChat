'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const textSend=fs.readFileSync(path.join(root,'public/text-send170.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');

const submitStart=textSend.indexOf('  async function submit(event) {');
const submitEnd=textSend.indexOf('\n  function dispatchSubmit(event)',submitStart);
assert(submitStart>=0&&submitEnd>submitStart,'FPTextSend170 submit executor missing');
const submitBlock=textSend.slice(submitStart,submitEnd);
const guardAt=submitBlock.indexOf('if (sendingForms.has(form)) return;');
const addAt=submitBlock.indexOf('sendingForms.add(form);');
const queueAt=submitBlock.indexOf('queuePendingTextSend(outbound');
const clearAt=submitBlock.indexOf('draftCleanup = clearDraftOnServer(roomId)');
const releaseAt=submitBlock.indexOf('sendingForms.delete(form);');
const awaitCleanupAt=submitBlock.indexOf('await draftCleanup');
assert(guardAt>=0&&addAt>guardAt,'double-submit guard acquisition changed');
assert(queueAt>addAt,'form guard must remain held until existing pending queue handoff');
assert(clearAt>queueAt,'draft clear must start only after queue handoff');
assert(releaseAt>clearAt,'form guard must release only after draft-clear ordering is registered');
assert(awaitCleanupAt>releaseAt,'form guard must release before waiting for draft DELETE');
assert(!submitBlock.includes('new Map('),'FPTextSend170 must not add a new send queue');

assert(app.includes("clearPromise:null"),'draft state must expose one in-flight clear barrier');
assert(app.includes('while(draft.clearPromise)'),'draft save must wait for in-flight clear operations');
assert(app.includes('const previous=draft.clearPromise;'),'draft DELETEs must preserve their existing order');
assert(app.includes('draft.clearPromise=current;'),'current draft clear barrier must be registered');
assert(app.includes("fetch(\`/api/rooms/\${roomId}/draft\`,{method:'PUT'"),'existing draft PUT transport missing');
assert(app.includes("fetch(\`/api/rooms/\${roomId}/draft\`,{method:'DELETE'"),'existing draft DELETE transport missing');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());

  let holdRoom='';
  let releaseHeldDelete;
  let deleteGate=new Promise(resolve=>{releaseHeldDelete=resolve;});
  const mutations=[];

  await page.route('**/api/rooms/*/draft',async route=>{
    const request=route.request();
    const url=new URL(request.url());
    const parts=url.pathname.split('/');
    const roomId=parts[3]||'';
    const method=request.method();
    if(method==='PUT'||method==='DELETE')mutations.push({roomId,method,at:Date.now()});
    if(method==='DELETE'&&roomId===holdRoom)await deleteGate;
    await route.continue();
  });

  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() =>
    window.FPTextSend170?.bindCurrentForm &&
    window.FPSendManager177?.dispatch &&
    window.FPConnection170?.ensureConnected &&
    window.FPComposer177?.queueDraftInput &&
    typeof openChat==='function' &&
    !document.getElementById('bootHold152')
  );

  const fixture=await page.evaluate(async()=>{
    const rooms=[];
    const deviceId=getOrCreateDeviceId();
    for(const suffix of ['a','b']){
      const secret='next2-draft-release-'+suffix;
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
      rooms.push(data.publicId);
    }
    return {rooms,deviceId};
  });
  const [roomA,roomB]=fixture.rooms;
  holdRoom=roomA;

  const open=async roomId=>{
    await page.evaluate(async roomId=>{showChatsList();await openChat(roomId);},roomId);
    await page.waitForSelector('#msgInput');
    await page.evaluate(async deviceId=>{await FPConnection170.ensureConnected(deviceId);},fixture.deviceId);
    await page.waitForFunction(()=>state?.ws?.readyState===WebSocket.OPEN);
  };

  const readDraft=async roomId=>page.evaluate(async roomId=>{
    const persisted=STORAGE.get(STORAGE.roomState(roomId));
    const response=await fetch(`/api/rooms/${roomId}/draft?deviceId=${encodeURIComponent(persisted.deviceId)}`);
    if(!response.ok)throw new Error('draft read '+response.status);
    const data=await response.json();
    const draft=data?.draft||null;
    let text='';
    if(draft?.ciphertext&&draft?.iv){
      const key=await getRoomKey(roomId,persisted.secret);
      text=await decryptText(draft.iv,draft.ciphertext,key);
    }
    return {draft,text};
  },roomId);

  const readTexts=async roomId=>page.evaluate(async roomId=>{
    const persisted=STORAGE.get(STORAGE.roomState(roomId));
    const response=await fetch(`/api/rooms/${roomId}/messages?deviceId=${encodeURIComponent(persisted.deviceId)}&limit=100`);
    if(!response.ok)throw new Error('messages '+response.status);
    const data=await response.json();
    const key=await getRoomKey(roomId,persisted.secret);
    const out=[];
    for(const message of data.messages||[]){
      if(message.type!=='text')continue;
      let text='';
      try{text=await decryptText(message.iv,message.ciphertext,key);}catch{}
      out.push({text,clientMessageId:message.client_message_id||null,id:message.id});
    }
    return out;
  },roomId);

  await open(roomA);

  await page.evaluate(()=>{
    window.__fpNext2={queued:[],originalQueue:window.queuePendingTextSend};
    window.queuePendingTextSend=function(payload,...rest){
      window.__fpNext2.queued.push({
        roomId:String(payload?.roomId||''),
        clientMessageId:String(payload?.clientMessageId||''),
        at:performance.now()
      });
      return window.__fpNext2.originalQueue(payload,...rest);
    };
  });

  const first='next2-first-'+Date.now();
  const second='next2-second-'+Date.now();
  const unsentDraft='next2-new-draft-'+Date.now();
  const roomBText='next2-room-b-'+Date.now();

  try{
    await page.locator('#msgInput').fill(first);
    await page.evaluate(()=>{
      const form=document.getElementById('sendForm');
      form.requestSubmit();
      form.requestSubmit();
    });

    await page.waitForFunction(()=>window.__fpNext2?.queued?.length===1);
    await page.waitForFunction(text=>{
      const row=[...document.querySelectorAll('#messages .bubble-wrap.msg')]
        .find(node=>node.textContent?.includes(text));
      return row&&/^\d+$/.test(String(row.dataset.messageId||row.dataset.id||''));
    },first);

    for(let i=0;i<100&&!mutations.some(x=>x.roomId===roomA&&x.method==='DELETE');i++)await page.waitForTimeout(20);
    assert.equal(mutations.filter(x=>x.roomId===roomA&&x.method==='DELETE').length,1,
      'first room-A draft DELETE must be held');

    const firstQueued=await page.evaluate(()=>window.__fpNext2.queued);
    assert.equal(firstQueued.length,1,'double click on first text must create one queue handoff');

    await page.locator('#msgInput').fill(second);
    const secondStarted=Date.now();
    await page.evaluate(()=>{
      const form=document.getElementById('sendForm');
      form.requestSubmit();
      form.requestSubmit();
    });

    await page.waitForFunction(()=>window.__fpNext2?.queued?.length===2);
    const secondQueueMs=Date.now()-secondStarted;
    await page.waitForFunction(text=>[...document.querySelectorAll('#messages .bubble-wrap.msg')]
      .some(node=>node.textContent?.includes(text)),second);
    await page.waitForFunction(text=>{
      const row=[...document.querySelectorAll('#messages .bubble-wrap.msg')]
        .find(node=>node.textContent?.includes(text));
      return row&&/^\d+$/.test(String(row.dataset.messageId||row.dataset.id||''));
    },second);

    assert.equal(mutations.filter(x=>x.roomId===roomA&&x.method==='DELETE').length,1,
      'second room-A draft DELETE must stay ordered behind the first held DELETE');

    const twoQueued=await page.evaluate(()=>window.__fpNext2.queued);
    assert.equal(twoQueued.length,2,'two distinct texts must produce exactly two queue handoffs');
    assert.notEqual(twoQueued[0].clientMessageId,twoQueued[1].clientMessageId,
      'distinct texts must keep distinct clientMessageId values');
    assert(twoQueued.every(item=>item.roomId===roomA),'both sends must remain bound to room A');

    await page.locator('#msgInput').fill(unsentDraft);
    await page.waitForTimeout(900);
    assert.equal(mutations.filter(x=>x.roomId===roomA&&x.method==='PUT').length,0,
      'new room-A draft PUT must wait behind held DELETE chain');

    await open(roomB);
    await page.locator('#msgInput').fill(roomBText);
    await page.locator('#sendBtn').click();
    await page.waitForFunction(()=>window.__fpNext2?.queued?.length===3);
    await page.waitForFunction(text=>{
      const row=[...document.querySelectorAll('#messages .bubble-wrap.msg')]
        .find(node=>node.textContent?.includes(text));
      return row&&/^\d+$/.test(String(row.dataset.messageId||row.dataset.id||''));
    },roomBText);

    const afterB=await page.evaluate(()=>({queued:[...window.__fpNext2.queued],activeRoom:state.roomId}));
    assert.equal(afterB.activeRoom,roomB,'room B must remain active while room-A draft DELETE is held');
    assert.equal(afterB.queued[2].roomId,roomB,'A -> B send must use room B context');

    releaseHeldDelete();

    await page.waitForFunction(roomId=>{
      const draft=ensureDraftState(roomId);
      return !draft.clearPromise;
    },roomA,{timeout:10000});

    for(let i=0;i<100&&!mutations.some(x=>x.roomId===roomA&&x.method==='PUT');i++)await page.waitForTimeout(30);
    assert(mutations.some(x=>x.roomId===roomA&&x.method==='PUT'),
      'new room-A draft must be saved after ordered DELETEs finish');

    let serverDraftA={draft:null,text:''};
    for(let i=0;i<40;i++){
      serverDraftA=await readDraft(roomA);
      if(serverDraftA.text===unsentDraft)break;
      await page.waitForTimeout(50);
    }
    assert.equal(serverDraftA.text,unsentDraft,
      'new draft typed during old DELETE must survive on the server');

    const [textsA,textsB]=await Promise.all([readTexts(roomA),readTexts(roomB)]);
    assert.equal(textsA.filter(x=>x.text===first).length,1,'first text must exist exactly once in room A');
    assert.equal(textsA.filter(x=>x.text===second).length,1,'second text must exist exactly once in room A');
    assert.equal(textsB.filter(x=>x.text===roomBText).length,1,'room-B text must exist exactly once in room B');
    assert.equal(textsB.filter(x=>x.text===first||x.text===second).length,0,
      'room-A sends must never leak into room B');

    console.log('PASS form releases after existing queue handoff while old draft DELETE is still held');
    console.log('PASS two distinct texts queue before held DELETE completes');
    console.log('PASS double submit still creates one logical queue handoff per text');
    console.log('PASS new draft PUT waits for older DELETEs and survives after they complete');
    console.log('PASS A -> B keeps send context and draft cleanup isolated by room');
    console.log(JSON.stringify({
      suite:'next-plan item 2 draft-release ordering',
      secondQueueMs,
      queueEntries:afterB.queued.length,
      heldDeleteStillPendingWhenSecondQueued:true,
      newDraftSurvived:true,
      roomSwitchSafe:true
    }));
  } finally {
    releaseHeldDelete();
    await page.evaluate(()=>{
      if(window.__fpNext2?.originalQueue)window.queuePendingTextSend=window.__fpNext2.originalQueue;
      delete window.__fpNext2;
    });
    await page.unroute('**/api/rooms/*/draft');
  }

  assert.deepEqual(errors,[]);
  console.log('PASS no uncaught browser errors');
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
