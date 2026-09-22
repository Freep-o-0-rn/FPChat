'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const textSend=read('public/text-send170.js');
const manager=read('public/send-manager177.js');
const app=read('public/app.js');
const media=read('public/media-send170.js');
const voice=read('public/voice.js');
const server=read('server.js');

const submitStart=textSend.indexOf('  async function submit(event) {');
const submitEnd=textSend.indexOf('\n  function dispatchSubmit(event)',submitStart);
assert(submitStart>=0&&submitEnd>submitStart,'existing FPTextSend170 submit executor missing');
const submitBlock=textSend.slice(submitStart,submitEnd);
assert(submitBlock.includes('if (sendingForms.has(form)) return;'),'double-submit guard changed');
assert(submitBlock.includes("contexts.beginOperation(roomId, 'text-send')"),'text operation context changed');
assert(submitBlock.includes('const clientMessageId = crypto.randomUUID();'),'clientMessageId generation changed');
assert(submitBlock.includes('queuePendingTextSend(outbound)'),'existing pending retry handoff changed');

const dispatchStart=textSend.indexOf('  function dispatchSubmit(event) {');
const dispatchEnd=textSend.indexOf('\n  function bindCurrentForm()',dispatchStart);
assert(dispatchStart>=0&&dispatchEnd>dispatchStart,'text dispatch wrapper missing');
const dispatchBlock=textSend.slice(dispatchStart,dispatchEnd);
assert(dispatchBlock.includes('const manager = window.FPSendManager177;'),'text dispatch must resolve SendManager');
assert(dispatchBlock.includes('if (!manager?.dispatch) return false;'),'manager refusal must not fall back');
assert(dispatchBlock.includes('return manager.dispatch(() => submit(event));'),
  'dispatcher must receive exactly the existing FPTextSend170 executor');
assert((dispatchBlock.match(/submit\(event\)/g)||[]).length===1,'dispatch wrapper must have exactly one text executor call site');

const bindStart=textSend.indexOf('  function bindCurrentForm() {');
const bindEnd=textSend.indexOf('\n  window.addEventListener',bindStart);
const bindBlock=textSend.slice(bindStart,bindEnd);
assert(bindBlock.includes('form.onsubmit === dispatchSubmit'),'idempotent bind must recognize dispatcher entry');
assert(bindBlock.includes('form.onsubmit = dispatchSubmit;'),'dispatcher must be the only assigned text submit handler');
assert(!bindBlock.includes('form.onsubmit = submit;'),'old direct submit assignment must be disconnected');

assert(manager.includes('return executor();'),'SendManager must remain a one-executor adapter');
assert(app.includes('const pendingTextSends=new Map()'),'text retry store moved unexpectedly');
assert(app.includes('resendPendingTextMessages();'),'reconnect resend changed');
assert(app.includes('handleWsMessageAck(payload)'),'ACK handling changed');
assert(app.includes("payload?.type==='message:new'"),'echo handling changed');
assert(media.includes("return manager.dispatch(() => executeMediaFromPreview170(root));"),
  '177.19 media entry must now use SendManager');
assert(!voice.includes('FPSendManager177'),'voice must not transfer before 177.20');

assert(server.includes('let row = q.findMessageByClientId.get(room.id, sender.id, clientMessageId);'),
  'server clientMessageId dedupe missing');
assert(server.includes('sendTextMessageAck(ws, room, message);'),'server ACK path missing');
assert(server.includes("if (message.status === 'sent') broadcastTextMessage(room, message, ws.deviceId);"),
  'server echo path missing');

console.log('PASS one text form entry dispatches exactly one existing FPTextSend170 executor');
console.log('PASS text retry/clientMessageId/ACK/echo ownership remains unchanged');
console.log('PASS text contract remains intact after media transfer; voice is still direct');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(9000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.FPSendManager177?.dispatch &&
    window.FPTextSend170?.bindCurrentForm &&
    typeof openChat==='function' &&
    !document.getElementById('bootHold152')
  );

  const fixture=await page.evaluate(async()=>{
    const ids=[];
    const deviceId=getOrCreateDeviceId();
    for(const suffix of ['a','b']){
      const secret='177-text-dispatch-'+suffix;
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const response=await fetch('/api/rooms',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})
      });
      if(!response.ok)throw new Error('room fixture failed: '+response.status);
      const data=await response.json();
      STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
      upsertChat(data.publicId,{});
      ids.push(data.publicId);
    }
    return {ids,deviceId};
  });

  const [roomA,roomB]=fixture.ids;
  const unique='177.18 text '+Date.now();

  const open=async roomId=>{
    await page.evaluate(async room=>{showChatsList();await openChat(room);},roomId);
    await page.waitForSelector('#msgInput');
  };

  const readRoomTexts=async roomId=>page.evaluate(async room=>{
    const persisted=STORAGE.get(STORAGE.roomState(room));
    const response=await fetch(`/api/rooms/${room}/messages?deviceId=${encodeURIComponent(persisted.deviceId)}&limit=100`);
    if(!response.ok)throw new Error('messages '+response.status);
    const data=await response.json();
    const key=await getRoomKey(room,persisted.secret);
    const out=[];
    for(const message of data.messages||[]){
      if(message.type!=='text')continue;
      let text='';
      try{text=await decryptText(message.iv,message.ciphertext,key);}catch{}
      out.push({id:message.id,clientMessageId:message.client_message_id||null,text,status:message.status});
    }
    return out;
  },roomId);

  await open(roomA);

  await page.evaluate(()=>{
    window.__fp17718={offline:true,dropped:[],actual:[],originalSend:WebSocket.prototype.send};
    WebSocket.prototype.send=function(payload){
      try{
        const parsed=JSON.parse(String(payload));
        if(parsed?.type==='message:send'){
          const entry={roomId:String(parsed.roomId||''),clientMessageId:String(parsed.clientMessageId||'')};
          if(window.__fp17718.offline){
            window.__fp17718.dropped.push(entry);
            return;
          }
          window.__fp17718.actual.push(entry);
        }
      }catch{}
      return window.__fp17718.originalSend.call(this,payload);
    };
  });

  try{
    await page.locator('#msgInput').fill(unique);
    await page.evaluate(()=>{
      const form=document.getElementById('sendForm');
      form.requestSubmit();
      form.requestSubmit();
    });

    await page.waitForFunction(()=>window.__fp17718?.dropped?.length>=1);
    await page.waitForFunction(()=>document.getElementById('msgInput')?.value==='');

    const dropped=await page.evaluate(()=>window.__fp17718.dropped);
    assert.equal(new Set(dropped.map(item=>item.clientMessageId)).size,1,
      'double submit must create only one clientMessageId');
    assert(dropped.every(item=>item.roomId===roomA),'all pending attempts must stay bound to room A');
    const clientMessageId=dropped[0].clientMessageId;
    assert(clientMessageId,'clientMessageId missing from text outbound');

    const before=await readRoomTexts(roomA);
    assert.equal(before.filter(item=>item.text===unique).length,0,
      'transport-offline phase must not save the message before reconnect');

    await open(roomB);
    assert.equal(await page.evaluate(()=>state.roomId),roomB,'room B must be active before reconnect');

    await page.evaluate(async deviceId=>{
      window.__fp17718.offline=false;
      window.FPConnection170.closeCurrent({manual:false});
      const ok=await ensureWsConnected(deviceId);
      if(!ok)throw new Error('reconnect failed');
    },fixture.deviceId);

    await page.waitForFunction(()=>window.__fp17718?.actual?.length>=1);

    await page.waitForFunction(({room,text})=>{
      const chat=state.chats.find(item=>item.roomId===room);
      return state.roomId!==room&&chat?.lastMessage===text;
    },{room:roomA,text:unique},{timeout:7000});

    let savedA=[];
    for(let i=0;i<30;i++){
      savedA=await readRoomTexts(roomA);
      if(savedA.some(item=>item.text===unique))break;
      await page.waitForTimeout(100);
    }
    const matchingA=savedA.filter(item=>item.text===unique);
    assert.equal(matchingA.length,1,'room A must contain exactly one saved text message');
    assert.equal(matchingA[0].clientMessageId,clientMessageId,
      'server message must retain the original clientMessageId');

    const savedB=await readRoomTexts(roomB);
    assert.equal(savedB.filter(item=>item.text===unique).length,0,
      'A -> B must never save the text under room B');

    await page.waitForTimeout(2200);
    const transport=await page.evaluate(()=>({
      actual:[...window.__fp17718.actual],
      activeRoom:state.roomId
    }));
    const actual=transport.actual.filter(item=>item.clientMessageId===clientMessageId);
    assert(actual.length>=2,'existing sent-status retry must reuse the same clientMessageId after reconnect');
    assert.equal(new Set(transport.actual.map(item=>item.clientMessageId)).size,1,
      'all reconnect/retry sends must retain one clientMessageId');
    assert(actual.every(item=>item.roomId===roomA),'reconnect/retry must remain in source room A');
    assert.equal(transport.activeRoom,roomB,'ACK/echo must not navigate away from room B');

    await open(roomA);
    await page.waitForFunction(text=>[...document.querySelectorAll('#messages .message-text')].some(el=>el.textContent===text),unique);
    const domCount=await page.locator('#messages .message-text').evaluateAll((nodes,text)=>
      nodes.filter(node=>node.textContent===text).length,unique);
    assert.equal(domCount,1,'ACK/echo must not leave duplicate message bubbles');

    const finalA=await readRoomTexts(roomA);
    assert.equal(finalA.filter(item=>item.text===unique).length,1,
      'server must still contain exactly one message after ACK/echo and retry window');

    console.log('PASS double submit creates one clientMessageId and one logical pending text');
    console.log('PASS transport-offline pending text resends after reconnect');
    console.log('PASS A -> B reconnect send remains bound to source room A');
    console.log('PASS ACK/echo preserves one logical message while existing retry reuses clientMessageId');
    console.log('PASS exactly one text message is saved on the server');
  } finally {
    await page.evaluate(()=>{
      if(window.__fp17718?.originalSend)WebSocket.prototype.send=window.__fp17718.originalSend;
      delete window.__fp17718;
    });
  }

  assert.deepEqual(errors,[]);
  console.log('PASS no uncaught browser errors');
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
