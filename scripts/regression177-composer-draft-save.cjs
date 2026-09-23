'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

assert(appSource.includes('const DRAFT_SAVE_DEBOUNCE_MS=700;'), 'existing 700 ms draft debounce must remain');
assert(appSource.includes('STORAGE.get(STORAGE.roomState(roomId))'), 'existing room-specific storage key must remain');
assert(appSource.includes("fetch(`/api/rooms/${roomId}/draft`,{method:'PUT'"), 'existing draft PUT must remain');
assert(appSource.includes("fetch(`/api/rooms/${roomId}/draft`,{method:'DELETE'"), 'existing draft DELETE must remain');

const apiStart=appSource.indexOf('const FPComposer177=Object.freeze({');
const apiEnd=appSource.indexOf('window.FPComposer177=FPComposer177;',apiStart);
assert(apiStart>=0&&apiEnd>apiStart,'FPComposer177 missing');
const apiBlock=appSource.slice(apiStart,apiEnd);
const queueStart=apiBlock.indexOf('  queueDraftInput(');
const queueEnd=apiBlock.indexOf('\n  },',queueStart);
assert(queueStart>=0&&queueEnd>queueStart,'FPComposer177 draft input command missing');
const queueBlock=apiBlock.slice(queueStart,queueEnd);
assert(queueBlock.includes('const draft=ensureDraftState(roomId);'),'draft input must use explicit roomId');
assert(queueBlock.includes('draft.text=input.value;'),'draft input text assignment missing');
assert(queueBlock.includes('scheduleDraftSave(roomId);'),'existing debounce worker must receive explicit roomId');
assert(!queueBlock.includes('state.roomId'),'draft input command must not resolve room from global state');
assert(!queueBlock.includes('fetch('),'draft input command must not own server transport');
assert(!queueBlock.includes('encryptText('),'draft input command must not own encryption');

const bindStart=appSource.indexOf('function bindComposerForm177(');
const bindEnd=appSource.indexOf('\nconst FPComposer177=',bindStart);
const bindBlock=appSource.slice(bindStart,bindEnd);
assert(bindBlock.includes("const boundRoomId=String(roomId||'');"),'form bind must capture its roomId');
assert(bindBlock.includes('FPComposer177.queueDraftInput({roomId:boundRoomId,input});'),
  'input listener must use captured form roomId');
assert(!bindBlock.includes('scheduleDraftSave(state.roomId)'),
  'input listener must not save using mutable global roomId');

const renderStart=appSource.indexOf('async function renderChatView(');
const renderEnd=appSource.indexOf('function buildMediaFallbackText',renderStart);
const renderBlock=appSource.slice(renderStart,renderEnd);
assert(renderBlock.includes('window.FPComposer177?.bind?.(form,view.roomId);'),
  'render must bind composer to captured room view');

console.log('PASS draft input entry delegates to existing debounce with explicit roomId');
console.log('PASS storage key, PUT/DELETE transport and encryption workers remain unchanged');

run(async ({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(7000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(()=>window.FPComposer177?.queueDraftInput&&typeof openChat==='function');

  const rooms=await page.evaluate(async()=>{
    const result=[];
    const deviceId=getOrCreateDeviceId();
    for(const suffix of ['a','b']){
      const secret='177-draft-save-'+suffix;
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
      result.push(data.publicId);
    }
    return result;
  });

  const open=async roomId=>{
    await page.evaluate(room=>openChat(room),roomId);
    await page.waitForSelector('#msgInput');
  };

  const readDraft=async roomId=>page.evaluate(async room=>{
    const persisted=STORAGE.get(STORAGE.roomState(room));
    const response=await fetch(`/api/rooms/${room}/draft?deviceId=${encodeURIComponent(persisted.deviceId)}`);
    const data=await response.json();
    const draft=data?.draft||null;
    let text='';
    if(draft?.ciphertext&&draft?.iv){
      const key=await getRoomKey(room,persisted.secret);
      text=await decryptText(draft.iv,draft.ciphertext,key);
    }
    return {draft,text};
  },roomId);

  await open(rooms[0]);
  await page.locator('#msgInput').fill('177.12 save A');
  await page.waitForTimeout(900);
  let serverA=await readDraft(rooms[0]);
  assert.equal(serverA.text,'177.12 save A','normal input must save under room A');
  assert(serverA.draft?.ciphertext&&serverA.draft?.iv,'saved draft must retain encrypted server format');
  assert(!JSON.stringify(serverA.draft).includes('177.12 save A'),'server draft must not contain plaintext');

  await page.locator('#msgInput').fill('');
  await page.waitForTimeout(900);
  serverA=await readDraft(rooms[0]);
  assert.equal(serverA.draft,null,'empty normal input must retain existing DELETE/clear behavior');

  await open(rooms[0]);
  await page.evaluate(()=>{
    window.__fp17712OldInput=document.getElementById('msgInput');
  });

  await open(rooms[1]);
  await page.locator('#msgInput').fill('177.12 stable B');
  await page.waitForTimeout(900);
  const stableB=await readDraft(rooms[1]);
  assert.equal(stableB.text,'177.12 stable B','room B baseline draft save failed');

  await page.evaluate(()=>{
    const input=window.__fp17712OldInput;
    input.value='177.12 late A';
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.waitForTimeout(900);

  const [lateA,afterB]=await Promise.all([readDraft(rooms[0]),readDraft(rooms[1])]);
  assert.equal(lateA.text,'177.12 late A','late event from A must stay bound to room A');
  assert.equal(afterB.text,'177.12 stable B','late event from A must not overwrite room B draft');

  const local=await page.evaluate(ids=>({
    activeRoom:state.roomId,
    a:ensureDraftState(ids[0]).text,
    b:ensureDraftState(ids[1]).text
  }),rooms);
  assert.equal(local.activeRoom,rooms[1],'room B must remain active');
  assert.equal(local.a,'177.12 late A','local room A draft must receive late A event');
  assert.equal(local.b,'177.12 stable B','local room B draft must remain unchanged');

  assert.deepEqual(errors,[]);
  console.log('PASS normal draft input preserves 700 ms encrypted PUT and empty DELETE behavior');
  console.log('PASS stale A input event after A -> B saves only under room A');
  console.log('PASS room B draft is not overwritten by stale room A input');
  console.log('PASS no uncaught browser errors');
}).catch(error=>{
  console.error(error?.stack||error);
  process.exitCode=1;
});
