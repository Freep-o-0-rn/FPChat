'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');
const storeSource = fs.readFileSync(path.join(root, 'public/message-store172.js'), 'utf8').replace(/\r\n/g, '\n');
const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8').replace(/\r\n/g, '\n');

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

assert(!app.includes('messageStatusByKey'), 'legacy independent status Map still exists');
assert(!app.includes('function messageStatusKey('), 'legacy independent status-key path still exists');

const remember = functionSource(app, 'rememberMessageStatus');
const effective = functionSource(app, 'getEffectiveMessageStatus');
const ack = functionSource(app, 'handleWsMessageAck');
const promoteEl = functionSource(app, 'promoteMessageElement');

assert(remember.includes('window.FPMessageStore172.updateStatus(roomId,messageId,normalized,clientMessageId)'),
  'status writer no longer preserves the existing Store.updateStatus arguments');
assert(remember.includes('strongerMessageStatus(normalized,record.status)'),
  'status writer no longer preserves stronger-status return semantics');
assert(effective.includes('window.FPMessageStore172.get(roomId,message?.id)||window.FPMessageStore172.get(roomId,message?.client_message_id)'),
  'effective status no longer reads canonical Store identity first');
assert(ack.includes('rememberMessageStatus(roomId,messageId,payload.status||payload.message?.status||\'sent\',clientMessageId)'),
  'ACK status arguments changed');
assert(ack.includes('promoteMessageElement(roomId,messageId,clientMessageId,status,payload.message?.created_at||null)'),
  'ACK promotion arguments changed');
assert(promoteEl.includes('window.FPMessageStore172?.promote?.(roomId,clientMessageId,messageId,{status,createdAt})'),
  'numeric identity promotion no longer uses Store.promote with the existing arguments');
assert(indexHtml.includes("'app.js':['room-context170.js','lifecycle170.js','network171.js','message-store172.js'"),
  'Store startup ownership is no longer guaranteed before app.js');

// Execute the real Store and cover the mandatory 178.2 regressions.
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

// ACK/echo + numeric identity after remount.
const ackRoom = 'room-178-2-ack';
const optimistic = store.upsert(ackRoom, {
  id: 'client-178-2',
  client_message_id: 'client-178-2',
  type: 'text',
  status: 'sending',
  created_at: '2026-09-22T12:00:00.000Z',
  sender_name: 'Me'
}, { text: 'hello', preview: 'hello', kind: 'text', source: 'optimistic' }).record;

assert(optimistic && optimistic.id === null, 'optimistic record unexpectedly has a numeric id');

store.updateStatus(ackRoom, 501, 'delivered', 'client-178-2');
const promoted = store.promote(ackRoom, 'client-178-2', 501, {
  status: 'delivered',
  createdAt: '2026-09-22T12:00:01.000Z'
});
assert.strictEqual(promoted, optimistic, 'ACK promotion replaced the optimistic canonical object');
assert.equal(promoted.id, 501, 'ACK promotion did not attach numeric server id');
assert.equal(promoted.status, 'delivered', 'ACK promotion lost delivered status');
assert.strictEqual(store.get(ackRoom, 501), promoted, 'numeric lookup after ACK does not return canonical record');
assert.strictEqual(store.get(ackRoom, 'client-178-2'), promoted, 'client id lookup no longer follows numeric promoted record');

// A remount/render payload with the numeric id must resolve the same record.
const remounted = store.upsert(ackRoom, {
  id: 501,
  client_message_id: 'client-178-2',
  type: 'text',
  status: 'sent',
  created_at: '2026-09-22T12:00:00.000Z',
  sender_name: 'Me'
}, { text: 'hello', preview: 'hello', kind: 'text', source: 'render' }).record;
assert.strictEqual(remounted, promoted, 'numeric id after remount created a second canonical record');
assert.equal(store.roomSnapshot(ackRoom).messages, 1, 'ACK/remount left duplicate canonical records');
assert.equal(remounted.status, 'delivered', 'weaker remount status regressed delivered');

// Echo may arrive before ACK. It must still collapse into one record.
const echoRoom = 'room-178-2-echo';
store.upsert(echoRoom, {
  id: 'client-echo',
  client_message_id: 'client-echo',
  type: 'text',
  status: 'sending',
  created_at: '2026-09-22T12:10:00.000Z',
  sender_name: 'Me'
}, { text: 'echo', preview: 'echo', source: 'optimistic' });
store.upsert(echoRoom, {
  id: 601,
  client_message_id: 'client-echo',
  type: 'text',
  status: 'read',
  created_at: '2026-09-22T12:10:00.000Z',
  sender_name: 'Me'
}, { text: 'echo', preview: 'echo', source: 'ws' });
store.promote(echoRoom, 'client-echo', 601, { status: 'sent' });
assert.equal(store.roomSnapshot(echoRoom).messages, 1, 'echo before ACK created duplicate Store records');
assert.equal(store.get(echoRoom, 601).status, 'read', 'late ACK weakened stronger echo status');

// Old history must not beat edit.
const editRoom = 'room-178-2-edit';
store.upsert(editRoom, {
  id: 701,
  type: 'text',
  status: 'sent',
  created_at: '2026-09-22T12:20:00.000Z',
  sender_name: 'A'
}, { text: 'old', preview: 'old', source: 'history' });
store.applyEdit(editRoom, {
  id: 701,
  type: 'text',
  status: 'sent',
  created_at: '2026-09-22T12:20:00.000Z',
  edited_at: '2026-09-22T12:21:00.000Z',
  sender_name: 'A'
}, 'edited');
store.upsert(editRoom, {
  id: 701,
  type: 'text',
  status: 'sent',
  created_at: '2026-09-22T12:20:00.000Z',
  sender_name: 'A'
}, { text: 'old history', preview: 'old history', source: 'history' });
assert.equal(store.get(editRoom, 701).text, 'edited', 'older history overwrote newer edit');

// Old history must not resurrect delete.
const deleteRoom = 'room-178-2-delete';
store.upsert(deleteRoom, {
  id: 801,
  type: 'text',
  status: 'sent',
  created_at: '2026-09-22T12:30:00.000Z',
  sender_name: 'A'
}, { text: 'alive', preview: 'alive', source: 'history' });
store.markDeleted(deleteRoom, 801, { scope: 'all', source: 'delete' });
store.upsert(deleteRoom, {
  id: 801,
  type: 'text',
  status: 'read',
  created_at: '2026-09-22T12:30:00.000Z',
  sender_name: 'A'
}, { text: 'resurrect', preview: 'resurrect', source: 'history' });
assert.equal(store.get(deleteRoom, 801).deleted, true, 'history resurrected deleted record');
assert.equal(store.get(deleteRoom, 801).text, '', 'history restored deleted content');

// Status rank is unchanged: stronger state survives weaker late data.
const statusRoom = 'room-178-2-status';
store.upsert(statusRoom, {
  id: 901,
  type: 'text',
  status: 'sent',
  created_at: '2026-09-22T12:40:00.000Z'
}, { text: 'status', source: 'history' });
store.updateStatus(statusRoom, 901, 'read');
store.updateStatus(statusRoom, 901, 'delivered');
store.upsert(statusRoom, {
  id: 901,
  type: 'text',
  status: 'sent',
  created_at: '2026-09-22T12:40:00.000Z'
}, { text: 'status', source: 'history' });
assert.equal(store.get(statusRoom, 901).status, 'read', 'stronger read status regressed');

console.log('PASS 178.2 legacy messageStatusByKey truth is removed');
console.log('PASS ACK/echo keep one canonical record and numeric identity survives remount');
console.log('PASS old history cannot beat edit or resurrect delete');
console.log('PASS stronger message status is preserved by unchanged Store rank rules');
