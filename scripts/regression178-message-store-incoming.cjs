'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');
const storeSource = fs.readFileSync(path.join(root, 'public/message-store172.js'), 'utf8').replace(/\r\n/g, '\n');

function functionSource(source, name) {
  const wrapped = '\n' + source;
  const match = new RegExp('\\n\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(wrapped);
  assert(match, 'function missing: ' + name);
  const start = Math.max(0, match.index - 1);
  const rest = source.slice(start + 1);
  const next = /\n\s*(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/g;
  next.lastIndex = 1;
  const found = next.exec(rest);
  return found ? rest.slice(0, found.index) : rest;
}

// 178.1 audits ONE writer only: the normal incoming WS message path.
const incoming = functionSource(app, 'processStableIncomingMessage');
const roomUpsert = functionSource(app, 'upsertRoomMessage');

assert(incoming.includes('upsertRoomMessage(roomId,message'), 'incoming WS path does not use the room message writer');
assert(roomUpsert.includes('window.FPMessageStore172?.upsert?.(roomId,message'), 'room writer bypasses FPMessageStore172');
assert(roomUpsert.includes("source:'ws'"), 'incoming writer no longer preserves WS source priority/merge rules');
assert(app.includes("const messageCache=window.FPMessageStore172?.legacyCacheAdapter?.(()=>String(state?.roomId||''))||new Map();"),
  'messageCache is no longer the Store compatibility adapter');

// Run the actual Store in an isolated browser-like context.
const events = [];
const sandbox = {
  console,
  Date,
  Map,
  Set,
  Object,
  String,
  Number,
  Boolean,
  Array,
  Math,
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
};
sandbox.window = {
  addEventListener() {},
  dispatchEvent(event) { events.push(event); return true; },
  FPRuntime: null
};
vm.createContext(sandbox);
vm.runInContext(storeSource, sandbox, { filename: 'message-store172.js' });

const store = sandbox.window.FPMessageStore172;
assert(store, 'FPMessageStore172 did not initialize');

const roomId = 'room-178-1';
const message = {
  id: 101,
  client_message_id: null,
  type: 'text',
  status: 'sent',
  sender_name: 'Иван',
  created_at: '2026-09-22T12:00:00.000Z'
};

const first = store.upsert(roomId, message, {
  text: 'Первое сообщение',
  preview: 'Первое сообщение',
  kind: 'text',
  source: 'ws'
});
assert(first.record, 'incoming message did not create canonical record');
const canonical = first.record;

const second = store.upsert(roomId, { ...message, status: 'delivered' }, {
  text: 'Первое сообщение',
  preview: 'Первое сообщение',
  kind: 'text',
  source: 'ws'
});
assert.strictEqual(second.record, canonical, 'same incoming identity created a second canonical record');
assert.equal(store.roomSnapshot(roomId).messages, 1, 'room contains more than one canonical record for one incoming message');
assert.equal(store.get(roomId, 101), canonical, 'Store get does not return the canonical record');

const adapter = store.legacyCacheAdapter(() => roomId);
const projected = adapter.get(101);
assert(projected, 'legacy adapter cannot read the canonical record');
assert.equal(projected.text, canonical.text, 'legacy adapter returned independent text state');
assert.equal(projected.preview, canonical.preview, 'legacy adapter returned independent preview state');

// A low-priority legacy write must target the same canonical record and must not
// override stronger WS content.
adapter.set(101, { text: 'legacy overwrite', preview: 'legacy overwrite', kind: 'text' });
assert.strictEqual(store.get(roomId, 101), canonical, 'legacy adapter replaced canonical record identity');
assert.equal(canonical.text, 'Первое сообщение', 'legacy adapter overrode stronger incoming WS content');
assert.equal(canonical.preview, 'Первое сообщение', 'legacy adapter overrode stronger incoming WS preview');
assert.equal(store.roomSnapshot(roomId).messages, 1, 'legacy adapter created a second record');

// Compatibility clear/delete must not become independent state owners.
const beforeClear = store.snapshot().compatibilityClears;
adapter.clear();
assert.equal(store.snapshot().compatibilityClears, beforeClear + 1, 'compatibility clear was not recorded');
assert.strictEqual(store.get(roomId, 101), canonical, 'legacy clear destroyed canonical Store state');
assert.equal(adapter.delete(101), false, 'legacy delete unexpectedly claims canonical ownership');
assert.strictEqual(store.get(roomId, 101), canonical, 'legacy delete destroyed canonical Store state');

console.log('PASS 178.1 incoming WS path reaches FPMessageStore172 through upsertRoomMessage');
console.log('PASS one incoming identity maps to one canonical Store record');
console.log('PASS messageCache is a projection/compatibility adapter, not an independent message truth');
console.log('PASS legacy clear/delete cannot destroy canonical Store state');
