'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

const setStart=appSource.indexOf('function setSelectedReply(');
const setEnd=appSource.indexOf('\nfunction clearSelectedReply',setStart);
const setBlock=appSource.slice(setStart,setEnd);
assert(setBlock.includes('draft.replyTo=replyTo;'),'reply source must keep existing draft.replyTo assignment');
assert(setBlock.includes('markReplyTargetRead(replyTo?.messageId);'),'reply source must keep existing mark-read call');
assert(setBlock.includes('updateReplyComposerBar();'),'reply source must keep existing composer update entry');
assert(setBlock.includes('void saveDraftNow(roomId);'),'reply source must keep existing draft save');
assert(setBlock.includes("document.getElementById('msgInput')?.focus();"),'reply source must keep existing input focus');

const clearStart=appSource.indexOf('function clearSelectedReply(');
const clearEnd=appSource.indexOf('\nfunction updateReplyComposerBar',clearStart);
const clearBlock=appSource.slice(clearStart,clearEnd);
assert(clearBlock.includes('draft.replyTo=null;'),'reply cancel must keep existing draft clear');
assert(clearBlock.includes('updateReplyComposerBar();'),'reply cancel must keep existing composer update entry');
assert(clearBlock.includes('void saveDraftNow(roomId);'),'reply cancel must keep existing draft save');

const updateStart=appSource.indexOf('function updateReplyComposerBar(');
const updateEnd=appSource.indexOf('\nfunction scheduleDraftSave',updateStart);
const updateBlock=appSource.slice(updateStart,updateEnd);
assert(updateBlock.includes('getMessageReplyMeta(reply.messageId)'),'existing canonical reply source must remain');
assert(updateBlock.includes('draft.replyTo=canonical;'),'existing canonical draft reply update must remain');
assert(updateBlock.includes('window.FPComposer177?.syncReplyMode?.({bar,reply,onCancel:()=>clearSelectedReply(state.roomId)});'),
  'reply UI must delegate to FPComposer177 while retaining existing cancel path');
assert(!updateBlock.includes("bar.classList.add('hidden')"),'legacy reply DOM hide path must leave updateReplyComposerBar');
assert(!updateBlock.includes("bar.innerHTML="),'legacy reply DOM renderer must leave updateReplyComposerBar');

const apiStart=appSource.indexOf('const FPComposer177=Object.freeze({');
const apiEnd=appSource.indexOf('window.FPComposer177=FPComposer177;',apiStart);
const apiBlock=appSource.slice(apiStart,apiEnd);
const replyStart=apiBlock.indexOf('  syncReplyMode(');
const replyEnd=apiBlock.indexOf('\n  },',replyStart);
assert(replyStart>=0&&replyEnd>replyStart,'FPComposer177 reply-mode command missing');
const replyBlock=apiBlock.slice(replyStart,replyEnd);
assert(replyBlock.includes("bar.classList.add('hidden')"),'reply-mode hide UI missing');
assert(replyBlock.includes("bar.classList.remove('hidden')"),'reply-mode show UI missing');
assert(replyBlock.includes("reply-composer-close"),'reply-mode cancel control missing');
for(const forbidden of ['draft.replyTo=','markReplyTargetRead','saveDraftNow','getMessageReplyMeta','fetch(']){
  assert(!replyBlock.includes(forbidden),'FPComposer177 reply-mode took forbidden ownership: '+forbidden);
}

const menuStart=appSource.indexOf('function showMessageReplyMenu(');
const menuEnd=appSource.indexOf('\nfunction hideMessageReplyMenu',menuStart);
const menuBlock=appSource.slice(menuStart,menuEnd);
assert(menuBlock.includes('const replyTo=getMessageReplyMeta(messageId);'),'reply source resolution changed');
assert(menuBlock.includes('setSelectedReply(state.roomId,replyTo);'),'reply source entry changed');

console.log('PASS reply source/cancel/draft/mark-read ownership remains unchanged');
console.log('PASS reply-mode DOM rendering delegates to FPComposer177 only');

run(async ({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(7000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(()=>window.FPComposer177?.syncReplyMode&&typeof openChat==='function');

  const room=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='177-reply-mode';
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

  await page.evaluate(roomId=>openChat(roomId),room);
  await page.waitForSelector('#msgInput');

  await page.locator('#msgInput').fill('177.13 reply source message');
  await page.locator('#sendBtn').click();
  await page.waitForFunction(()=>document.getElementById('msgInput')?.value==='');

  const messageId=await page.evaluate(async()=>{
    const persisted=STORAGE.get(STORAGE.roomState(state.roomId));
    const response=await fetch(`/api/rooms/${state.roomId}/messages?deviceId=${encodeURIComponent(persisted.deviceId)}&limit=100`);
    const data=await response.json();
    const textMessages=(data.messages||[]).filter(message=>message.type==='text');
    return Number(textMessages[textMessages.length-1]?.id||0);
  });
  assert(Number.isSafeInteger(messageId)&&messageId>0,'reply source fixture message missing');

  await page.evaluate(id=>showMessageReplyMenu(id,20,120),messageId);
  await page.locator('.message-reply-menu button').click();
  await page.waitForSelector('#replyComposerBar:not(.hidden) .reply-composer-close');

  const selected=await page.evaluate(()=>({
    roomId:state.roomId,
    replyId:ensureDraftState(state.roomId).replyTo?.messageId||null,
    barHidden:document.getElementById('replyComposerBar')?.classList.contains('hidden'),
    author:document.querySelector('#replyComposerBar .reply-composer-author')?.textContent||'',
    preview:document.querySelector('#replyComposerBar .reply-composer-preview')?.textContent||''
  }));
  assert.equal(selected.replyId,messageId,'reply source must populate existing draft.replyTo');
  assert.equal(selected.barHidden,false,'reply-mode bar must be visible');
  assert(selected.author.length>0,'reply author must render');
  assert(selected.preview.length>0,'reply preview must render');

  await page.waitForTimeout(150);
  const saved=await page.evaluate(async()=>{
    const persisted=STORAGE.get(STORAGE.roomState(state.roomId));
    const response=await fetch(`/api/rooms/${state.roomId}/draft?deviceId=${encodeURIComponent(persisted.deviceId)}`);
    return response.json();
  });
  assert.equal(Number(saved?.draft?.reply_to_message_id||0),messageId,
    'existing draft reply id must still persist to server');

  await page.locator('#replyComposerBar .reply-composer-close').click();
  await page.waitForFunction(()=>document.getElementById('replyComposerBar')?.classList.contains('hidden'));

  const cancelled=await page.evaluate(()=>({
    reply:ensureDraftState(state.roomId).replyTo,
    barHtml:document.getElementById('replyComposerBar')?.innerHTML||''
  }));
  assert.equal(cancelled.reply,null,'existing cancel path must clear draft.replyTo');
  assert.equal(cancelled.barHtml,'','reply-mode cancel must clear bar UI');

  await page.waitForTimeout(150);
  const cleared=await page.evaluate(async()=>{
    const persisted=STORAGE.get(STORAGE.roomState(state.roomId));
    const response=await fetch(`/api/rooms/${state.roomId}/draft?deviceId=${encodeURIComponent(persisted.deviceId)}`);
    return response.json();
  });
  assert.equal(cleared?.draft??null,null,'existing cancel save/clear behavior must remain');

  assert.deepEqual(errors,[]);
  console.log('PASS reply source opens FPComposer177 reply-mode with existing draft reply');
  console.log('PASS reply draft persists existing reply_to_message_id');
  console.log('PASS existing cancel clears draft reply, UI and server draft');
  console.log('PASS no uncaught browser errors');
}).catch(error=>{
  console.error(error?.stack||error);
  process.exitCode=1;
});
