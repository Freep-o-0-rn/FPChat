'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {run} = require('./browser-harness174.cjs');

const storeFile = path.join(process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..'), 'public/message-store172.js');
if (fs.existsSync(storeFile)) {
const context = {window: {dispatchEvent() {}}, CustomEvent: class {}};
vm.runInNewContext(fs.readFileSync(storeFile, 'utf8'), context);
const store = context.window.FPMessageStore172;
const optimistic = {id: 'pending-175', client_message_id: 'pending-175', status: 'sending', type: 'text', created_at: '2026-09-21T00:00:00.999Z'};
store.upsert('test', optimistic, {source: 'optimistic', text: 'original'});
store.promote('test', 'pending-175', 175, {status: 'sent'});
assert.equal(store.get('test', 175).raw.id, 175, 'ACK must promote raw identity as well as canonical identity');
store.upsert('test', {...optimistic, id: 175, created_at: '2026-09-21T00:00:00.000Z'}, {source: 'history', text: 'stale'});
assert.equal(store.get('test', 175).raw.id, 175);
assert.equal(store.get('test', 175).text, 'original', 'identity reconciliation must not weaken content merge');
store.upsert('test', {...optimistic, created_at: '2026-09-21T00:00:01Z'}, {source: 'optimistic', text: 'late local content'});
assert.equal(store.get('test', 175).raw.id, 175, 'late optimistic input cannot downgrade the server identity');
console.log('PASS ACK, older history and late optimistic content keep the numeric identity');
}

run(async ({browser, origin, errors}) => {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.FPVoice && typeof openChat === 'function' && !document.getElementById('bootHold152'));
  const room = await page.evaluate(async () => {
    const deviceId = getOrCreateDeviceId(), secret = 'identity-regression-175';
    const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
    const response = await fetch('/api/rooms', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({displayName: state.nick, deviceId, roomSecret: secret, ...recovery})});
    if (!response.ok) throw Error('fixture failed');
    const data = await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId), {deviceId, secret}); upsertChat(data.publicId, {});
    await openChat(data.publicId); return data.publicId;
  });
  await page.locator('#msgInput').fill('identity remains editable'); await page.locator('#sendBtn').click();
  await page.waitForFunction(() => document.querySelector('#messages .mine')?.dataset.status === 'sent');
  await page.evaluate(async roomId => { showChatsList(); await openChat(roomId); }, room);
  assert.equal(await page.evaluate(() => {
    const node = document.querySelector('#messages .mine');
    return Number.isSafeInteger(Number(node?.dataset.messageId)) && Number(node.dataset.messageId) > 0;
  }), true, 'history remount must preserve the server id');
  await page.locator('#messages .mine .message-text').click({button: 'right'});
  await page.waitForSelector('[data-fp-message-action="edit"]');
  await page.waitForSelector('[data-fp-message-action="delete"]');
  assert.deepEqual(errors, []);
  console.log('PASS real send, ACK, room reopen and edit/delete menu keep message identity');
}).catch(error => { console.error(error); process.exitCode = 1; });
