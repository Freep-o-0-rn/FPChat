'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const voiceSource = fs.readFileSync(path.join(root, 'public/voice.js'), 'utf8');
const textSendSource = fs.readFileSync(path.join(root, 'public/text-send170.js'), 'utf8');

const apiStart = appSource.indexOf('const FPComposer177=Object.freeze({');
const apiEnd = appSource.indexOf('window.FPComposer177=FPComposer177;', apiStart);
assert(apiStart >= 0 && apiEnd > apiStart, 'FPComposer177 command missing');
const apiBlock = appSource.slice(apiStart, apiEnd);
const syncCommandStart = apiBlock.indexOf('  syncUI(');
const syncCommandEnd = apiBlock.indexOf('\n  },', syncCommandStart);
assert(syncCommandStart >= 0 && syncCommandEnd > syncCommandStart, 'FPComposer177 syncUI command missing');
const syncCommandBlock = apiBlock.slice(syncCommandStart, syncCommandEnd);
assert(syncCommandBlock.includes("return window.FPVoice?.syncComposer?.(form);"), 'FPComposer177 must delegate to FPVoice.syncComposer');
for (const forbidden of ['.disabled', 'classList', '.value', 'fp-voice-mic-mode']) {
  assert(!syncCommandBlock.includes(forbidden), 'FPComposer177 syncUI became a second button calculator: ' + forbidden);
}

assert(appSource.includes("const syncSendBtn=()=>window.FPComposer177?.syncUI?.(form);"), 'normal composer must use FPComposer177');
assert(!textSendSource.includes('sendBtn.disabled'), 'text-send must not calculate send button state');
assert(!textSendSource.includes('FPVoice?.syncComposer'), 'text-send must use the unified composer command');
assert(textSendSource.includes('window.FPComposer177?.syncUI?.(form);'), 'text-send unified sync call missing');

const syncStart = voiceSource.indexOf('  function syncComposer(form) {');
const syncEnd = voiceSource.indexOf('\n\n  function mountComposerVoiceUi177(form) {', syncStart);
assert(syncStart >= 0 && syncEnd > syncStart, 'FPVoice syncComposer body missing');
const syncBlock = voiceSource.slice(syncStart, syncEnd);
assert(syncBlock.includes('send.disabled = empty;'), 'FPVoice must own normal send disabled calculation');
assert(syncBlock.includes("form.classList.toggle('fp-voice-mic-mode'"), 'FPVoice must retain mic-mode calculation');
assert.equal((syncBlock.match(/send\.disabled\s*=/g) || []).length, 1, 'FPVoice normal sync must calculate send disabled once');

console.log('PASS FPComposer177 is a thin delegate to FPVoice.syncComposer');
console.log('PASS normal app/text-send path has no second send-button calculator');

run(async ({ browser, origin, errors }) => {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(() => window.FPVoice?.syncComposer && window.FPComposer177?.syncUI && typeof openChat === 'function');

  const roomId = await page.evaluate(async () => {
    const deviceId = getOrCreateDeviceId();
    const secret = '177-composer-sync';
    const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
    const response = await fetch('/api/rooms', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok) throw new Error('room fixture failed: '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    return data.publicId;
  });

  await page.evaluate(room => openChat(room), roomId);
  await page.waitForFunction(() => {
    const form=document.getElementById('sendForm');
    const input=form?.querySelector('#msgInput');
    const send=form?.querySelector('#sendBtn');
    const mic=form?.querySelector('.fp-voice-record-btn');
    return Boolean(
      form && input && send && mic
      && input.value===''
      && send.disabled===true
      && mic.disabled===false
      && getComputedStyle(mic).display!=='none'
      && form.querySelectorAll('.fp-voice-record-btn').length===1
    );
  }, null, { timeout: 15000 });

  const state = () => page.evaluate(() => {
    const form=document.getElementById('sendForm');
    const input=form.querySelector('#msgInput');
    const send=form.querySelector('#sendBtn');
    const mic=form.querySelector('.fp-voice-record-btn');
    return {
      text:input.value,
      sendDisabled:send.disabled,
      sendVisible:getComputedStyle(send).display!=='none',
      micDisabled:mic.disabled,
      micVisible:getComputedStyle(mic).display!=='none',
      micCount:form.querySelectorAll('.fp-voice-record-btn').length
    };
  });

  assert.deepEqual(await state(), {
    text:'',sendDisabled:true,sendVisible:false,micDisabled:false,micVisible:true,micCount:1
  });

  // Prove the public command delegates exact form and exact return value.
  const delegation = await page.evaluate(() => {
    const form=document.getElementById('sendForm');
    const original=FPVoice.syncComposer;
    let sameForm=false;
    FPVoice.syncComposer=(received)=>{sameForm=received===form;return 'composer-177-sentinel';};
    const returned=FPComposer177.syncUI(form);
    FPVoice.syncComposer=original;
    original(form);
    return {sameForm,returned};
  });
  assert.deepEqual(delegation,{sameForm:true,returned:'composer-177-sentinel'});

  await page.locator('#msgInput').fill('177.9 text');
  assert.deepEqual(await state(), {
    text:'177.9 text',sendDisabled:false,sendVisible:true,micDisabled:true,micVisible:false,micCount:1
  });

  await page.locator('#sendBtn').click();
  await page.waitForFunction(() => document.getElementById('msgInput')?.value === '');
  await page.waitForFunction(() => {
    const form=document.getElementById('sendForm');
    const send=form?.querySelector('#sendBtn');
    const mic=form?.querySelector('.fp-voice-record-btn');
    return Boolean(send && mic && send.disabled && !mic.disabled && getComputedStyle(mic).display!=='none');
  });

  const messages = await page.evaluate(async () => {
    const response=await fetch(`/api/rooms/${state.roomId}/messages?deviceId=${getOrCreateDeviceId()}&limit=100`);
    return (await response.json()).messages;
  });
  assert.equal(messages.filter(message => message.type === 'text').length,1,'text-send must persist exactly one message');

  assert.deepEqual(await state(), {
    text:'',sendDisabled:true,sendVisible:false,micDisabled:false,micVisible:true,micCount:1
  });
  assert.deepEqual(errors,[]);

  console.log('PASS empty chat starts in one mic / disabled-send state');
  console.log('PASS typed text selects enabled send through FPVoice owner');
  console.log('PASS text-send cleanup restores mic without a second calculator');
  console.log('PASS exactly one text message persisted');
}).catch(error => {
  console.error(error?.stack || error);
  process.exitCode=1;
});
