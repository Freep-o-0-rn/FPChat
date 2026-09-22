'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const textSendSource = fs.readFileSync(path.join(root, 'public/text-send170.js'), 'utf8');

const apiStart = appSource.indexOf('const boundComposerForms177=new WeakSet();');
const apiEnd = appSource.indexOf('window.FPComposer177=FPComposer177;', apiStart);
assert(apiStart >= 0 && apiEnd > apiStart, 'FPComposer177 bind owner missing');
const apiBlock = appSource.slice(apiStart, apiEnd);
assert(apiBlock.includes('boundComposerForms177.has(form)'), 'composer bind must be idempotent per form');
assert(apiBlock.includes('boundComposerForms177.add(form)'), 'composer bound form marker missing');
assert.equal((apiBlock.match(/input\.addEventListener\('input'/g) || []).length, 1, 'normal composer must add one input listener');
assert.equal((apiBlock.match(/input\.addEventListener\('keydown'/g) || []).length, 1, 'normal composer must add one keydown listener');
assert(apiBlock.includes('return window.FPVoice?.syncComposer?.(form);'), '177.9 UI delegate must remain unchanged');

const renderStart = appSource.indexOf("const mediaFileInput=document.getElementById('mediaFileInput')");
const renderEnd = appSource.indexOf('function buildMediaFallbackText', renderStart);
assert(renderStart >= 0 && renderEnd > renderStart, 'render composer segment missing');
const renderBlock = appSource.slice(renderStart, renderEnd);
assert(renderBlock.includes('window.FPComposer177?.bind?.(form,view.roomId);'), 'render must delegate normal bind to FPComposer177 with captured roomId');
assert(!renderBlock.includes("input.addEventListener('input'"), 'render must not own a second normal input listener');
assert(!renderBlock.includes("input.addEventListener('keydown'"), 'render must not own a second normal keydown listener');
assert(renderBlock.includes('window.FPTextSend170?.bindCurrentForm?.();'), 'text submit owner handoff must remain');

assert(textSendSource.includes('if (boundForms.get(form) === context && form.onsubmit === submit) return true;'),
  'FPTextSend170 repeated bind guard missing');
assert.equal((textSendSource.match(/form\.onsubmit\s*=\s*submit;/g) || []).length, 1,
  'FPTextSend170 must keep one submit assignment');

console.log('PASS FPComposer177 owns one idempotent normal form bind');
console.log('PASS renderChatView delegates input/keydown bind without taking text-submit ownership');

run(async ({ browser, origin, errors }) => {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());

  await page.addInitScript(() => {
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (this?.id === 'msgInput' && (type === 'input' || type === 'keydown')) {
        this.__fp17710ListenerAdds ||= {input:0, keydown:0};
        this.__fp17710ListenerAdds[type] += 1;
      }
      if (this?.id === 'sendForm' && type === 'submit') {
        this.__fp17710SubmitAdds = (this.__fp17710SubmitAdds || 0) + 1;
      }
      return original.call(this, type, listener, options);
    };
  });

  await page.goto(origin);
  await page.waitForFunction(() =>
    window.FPComposer177?.bind &&
    window.FPTextSend170?.bindCurrentForm &&
    window.FPVoice?.syncComposer &&
    typeof openChat === 'function'
  );

  const rooms = await page.evaluate(async () => {
    const out = [];
    const deviceId = getOrCreateDeviceId();
    for (const suffix of ['a','b']) {
      const secret = '177-composer-bind-' + suffix;
      const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
      const response = await fetch('/api/rooms', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})
      });
      if(!response.ok) throw new Error('room fixture failed: '+response.status);
      const data = await response.json();
      STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
      upsertChat(data.publicId,{});
      out.push(data.publicId);
    }
    return out;
  });

  const open = async (roomId) => {
    await page.evaluate(room => openChat(room), roomId);
    await page.waitForSelector('#sendForm .fp-voice-record-btn');
    return page.evaluate(() => {
      const form=document.getElementById('sendForm');
      const input=form.querySelector('#msgInput');
      const before={...(input.__fp17710ListenerAdds||{}),submitAdds:form.__fp17710SubmitAdds||0};
      const submitOwner=form.onsubmit;
      for(let i=0;i<4;i++){
        FPComposer177.bind(form);
        FPTextSend170.bindCurrentForm();
      }
      const after={...(input.__fp17710ListenerAdds||{}),submitAdds:form.__fp17710SubmitAdds||0};
      return {
        before,after,
        submitStable:form.onsubmit===submitOwner,
        micCount:form.querySelectorAll('.fp-voice-record-btn').length
      };
    });
  };

  for (let i=0;i<3;i++) {
    for (const room of rooms) {
      const snapshot=await open(room);
      assert.deepEqual(snapshot.after,snapshot.before,'repeated bind must not add listeners to the same mounted form');
      assert.equal(snapshot.submitStable,true,'repeated FPTextSend170 bind must keep one submit handler');
      assert.equal(snapshot.micCount,1,'repeated mounts must keep one microphone');
      assert.equal(snapshot.before.keydown,1,'one normal keydown listener expected');
      assert.equal(snapshot.after.submitAdds,snapshot.before.submitAdds,'repeated bind must not multiply existing service submit listeners');
    }
  }

  await page.locator('#msgInput').fill('177.10 one submit');
  await page.locator('#sendBtn').click();
  await page.waitForFunction(() => document.getElementById('msgInput')?.value === '');

  const result=await page.evaluate(async () => {
    const response=await fetch(`/api/rooms/${state.roomId}/messages?deviceId=${getOrCreateDeviceId()}&limit=100`);
    const messages=(await response.json()).messages;
    return {
      textCount:messages.filter(message => message.type === 'text').length,
      micCount:document.querySelectorAll('#sendForm .fp-voice-record-btn').length,
      errors:[]
    };
  });
  assert.equal(result.textCount,1,'one submit must persist exactly one text message');
  assert.equal(result.micCount,1,'one microphone after text send');
  assert.deepEqual(errors,[]);

  console.log('PASS repeated FPComposer177/FPTextSend170 bind does not stack listeners');
  console.log('PASS repeated A/B room mounts keep per-form bind counts stable and one microphone');
  console.log('PASS one text submit persists exactly one message');
}).catch(error => {
  console.error(error?.stack || error);
  process.exitCode=1;
});
