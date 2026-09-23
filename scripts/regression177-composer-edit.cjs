'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const actionsSource = fs.readFileSync(path.join(root, 'public/message-actions.js'), 'utf8');
const voiceSource = fs.readFileSync(path.join(root, 'public/voice.js'), 'utf8');

const apiStart=appSource.indexOf('const FPComposer177=Object.freeze({');
const apiEnd=appSource.indexOf('window.FPComposer177=FPComposer177;',apiStart);
assert(apiStart>=0&&apiEnd>apiStart,'FPComposer177 missing');
const apiBlock=appSource.slice(apiStart,apiEnd);
for(const command of ['enterEditMode','syncEditInput','exitEditMode']){
  assert(apiBlock.includes(command+'('),'FPComposer177 '+command+' command missing');
}
const enterStart=apiBlock.indexOf('  enterEditMode(');
const enterEnd=apiBlock.indexOf('\n  },',enterStart);
const enterBlock=apiBlock.slice(enterStart,enterEnd);
assert(enterBlock.includes("view.classList.add('fp-editing-message')"),'edit mode class owner missing');
assert(enterBlock.includes("bar.id='editComposerBar'"),'edit bar owner missing');
assert(enterBlock.includes("input.value=String(originalText||'')"),'edit text application missing');
assert(enterBlock.includes('FPComposer177.syncUI(form);'),'edit entry must use unified send/mic sync');
for(const forbidden of ['editState','commitEdit','/messages/','fetch(']){
  assert(!enterBlock.includes(forbidden),'FPComposer177 edit UI took edit semantic/server ownership: '+forbidden);
}

const exitStart=apiBlock.indexOf('  exitEditMode(');
const exitEnd=apiBlock.indexOf('\n  },',exitStart);
const exitBlock=apiBlock.slice(exitStart,exitEnd);
assert(exitBlock.includes("classList.remove('fp-editing-message')"),'edit exit class cleanup missing');
assert(exitBlock.includes("document.getElementById('editComposerBar')?.remove()"),'edit bar cleanup missing');
assert(exitBlock.includes("input.value=snapshot.text||''"),'edit cancel draft text restore missing');
assert(exitBlock.includes("input.dispatchEvent(new Event('input',{bubbles:true}))"),'edit cancel must restore through existing normal input path');
assert(exitBlock.includes('FPComposer177.syncUI('),'edit exit must restore unified send/mic state');

const beginStart=actionsSource.indexOf('  function beginEdit(');
const beginEnd=actionsSource.indexOf('\n  async function commitEdit()',beginStart);
const beginBlock=actionsSource.slice(beginStart,beginEnd);
assert(beginBlock.includes("snapshot: { text: input.value, replyTo: draft?.replyTo || null }"),
  'existing edit draft snapshot must remain');
assert(beginBlock.includes('renderEditBar();'),'existing beginEdit entry must remain');
assert(!beginBlock.includes('send.disabled'),'beginEdit must not calculate send state independently');
assert(!beginBlock.includes('FPVoice?.syncComposer'),'beginEdit must not bypass FPComposer177');

const commitStart=actionsSource.indexOf('  async function commitEdit()');
const commitEnd=actionsSource.indexOf('\n  function closeDeleteDialog()',commitStart);
const commitBlock=actionsSource.slice(commitStart,commitEnd);
assert(commitBlock.includes('/edit'),'existing edit server endpoint must remain');
assert(commitBlock.includes("method: 'PUT'"),'existing edit server PUT must remain');
assert(commitBlock.includes('encryptText(text)'),'existing edit encryption must remain');
assert(commitBlock.includes('cancelEdit(true);'),'existing successful edit cancel/restore path must remain');

const inputListenerStart=actionsSource.indexOf("  document.addEventListener('input'");
const inputListenerEnd=actionsSource.indexOf("  document.addEventListener('submit'",inputListenerStart);
const inputListener=actionsSource.slice(inputListenerStart,inputListenerEnd);
assert(inputListener.includes('event.stopImmediatePropagation();'),'edit input must still isolate draft input handling');
assert(inputListener.includes('window.FPComposer177?.syncEditInput?.(event.target);'),
  'edit input UI must delegate to FPComposer177');
assert(!inputListener.includes('send.disabled'),'edit input must not own send calculation');

const syncStart=voiceSource.indexOf('  function syncComposer(form) {');
const syncEnd=voiceSource.indexOf('\n\n  function ensureComposer()',syncStart);
const syncBlock=voiceSource.slice(syncStart,syncEnd);
assert(syncBlock.includes("const editing = view?.classList.contains('fp-editing-message') === true;"),
  'FPVoice must preserve edit-mode mic suppression');
assert(syncBlock.includes('empty && !editing && !closed && !currentBusy'),
  'mic mode must stay off during edit');
assert(syncBlock.includes('mic.disabled = editing || closed || currentBusy || !empty;'),
  'mic must remain disabled during edit');

console.log('PASS edit state/snapshot/commit ownership remains in message-actions');
console.log('PASS edit form UI delegates to FPComposer177 and send/mic stays owned by FPVoice');

run(async ({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(7000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.FPComposer177?.enterEditMode &&
    window.FPComposer177?.exitEditMode &&
    window.FPVoice &&
    typeof openChat === 'function' &&
    !document.getElementById('bootHold152')
  );

  const room=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='177-edit-mode';
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
    return data.publicId;
  });

  await page.evaluate(async roomId=>{showChatsList();await openChat(roomId);},room);
  await page.waitForSelector('#msgInput');

  await page.locator('#msgInput').fill('177.14 original message');
  await page.locator('#sendBtn').click();
  await page.waitForFunction(()=>document.getElementById('msgInput')?.value==='');

  await page.locator('#msgInput').fill('177.14 preserved draft');
  await page.waitForTimeout(50);

  const draftBefore=await page.evaluate(()=>({
    text:ensureDraftState(state.roomId).text,
    replyTo:ensureDraftState(state.roomId).replyTo
  }));
  assert.equal(draftBefore.text,'177.14 preserved draft','pre-edit draft fixture missing');

  await page.locator('#messages .bubble-wrap.mine .message-text').first().click({button:'right'});
  await page.locator('[data-fp-message-action="edit"]').click();
  await page.waitForSelector('#editComposerBar');

  const editState=await page.evaluate(()=>({
    text:document.getElementById('msgInput')?.value||'',
    editing:document.querySelector('.chat-view')?.classList.contains('fp-editing-message')===true,
    sendDisabled:document.getElementById('sendBtn')?.disabled,
    micMode:document.getElementById('sendForm')?.classList.contains('fp-voice-mic-mode')===true,
    micDisabled:document.querySelector('.fp-voice-record-btn')?.disabled,
    draftText:ensureDraftState(state.roomId).text
  }));
  assert.equal(editState.text,'177.14 original message','edit must load original message text');
  assert.equal(editState.editing,true,'edit mode class missing');
  assert.equal(editState.sendDisabled,false,'edit original text must enable send');
  assert.equal(editState.micMode,false,'mic mode must be hidden during edit');
  assert.equal(editState.micDisabled,true,'microphone must be disabled during edit');
  assert.equal(editState.draftText,'177.14 preserved draft','entering edit must not overwrite existing draft');

  await page.locator('#msgInput').fill('');
  await page.waitForFunction(()=>{
    const form=document.getElementById('sendForm');
    const input=document.getElementById('msgInput');
    const send=document.getElementById('sendBtn');
    const mic=document.querySelector('.fp-voice-record-btn');
    return Boolean(form&&input&&send&&mic&&input.value===''&&send.disabled===true&&mic.disabled===true&&form.classList.contains('fp-voice-mic-mode')===false);
  });
  const emptyEdit=await page.evaluate(()=>({
    sendDisabled:document.getElementById('sendBtn')?.disabled,
    micMode:document.getElementById('sendForm')?.classList.contains('fp-voice-mic-mode')===true,
    micDisabled:document.querySelector('.fp-voice-record-btn')?.disabled,
    draftText:ensureDraftState(state.roomId).text
  }));
  assert.deepEqual(emptyEdit,{
    sendDisabled:true,
    micMode:false,
    micDisabled:true,
    draftText:'177.14 preserved draft'
  },'empty edit must keep mic suppressed and preserve draft');

  await page.locator('#msgInput').fill('177.14 changed but cancelled');
  await page.locator('#editComposerBar .edit-composer-close').click();

  const cancelled=await page.evaluate(()=>({
    text:document.getElementById('msgInput')?.value||'',
    editing:document.querySelector('.chat-view')?.classList.contains('fp-editing-message')===true,
    bar:Boolean(document.getElementById('editComposerBar')),
    draftText:ensureDraftState(state.roomId).text,
    sendDisabled:document.getElementById('sendBtn')?.disabled,
    micMode:document.getElementById('sendForm')?.classList.contains('fp-voice-mic-mode')===true,
    micDisabled:document.querySelector('.fp-voice-record-btn')?.disabled
  }));
  assert.deepEqual(cancelled,{
    text:'177.14 preserved draft',
    editing:false,
    bar:false,
    draftText:'177.14 preserved draft',
    sendDisabled:false,
    micMode:false,
    micDisabled:true
  },'cancel must restore previous draft form and its send/mic state');

  await page.locator('#msgInput').fill('');
  await page.waitForTimeout(50);
  const normalEmpty=await page.evaluate(()=>({
    sendDisabled:document.getElementById('sendBtn')?.disabled,
    micMode:document.getElementById('sendForm')?.classList.contains('fp-voice-mic-mode')===true,
    micDisabled:document.querySelector('.fp-voice-record-btn')?.disabled
  }));
  assert.deepEqual(normalEmpty,{sendDisabled:true,micMode:true,micDisabled:false},
    'after edit cancel normal empty composer must return to microphone mode');

  assert.deepEqual(errors,[]);
  console.log('PASS edit opens with original message while preserving existing draft');
  console.log('PASS empty edit keeps send disabled and microphone suppressed');
  console.log('PASS cancel restores previous draft form and correct send/mic state');
  console.log('PASS normal composer regains microphone mode after edit exit');
  console.log('PASS no uncaught browser errors');
}).catch(error=>{
  console.error(error?.stack||error);
  process.exitCode=1;
});
