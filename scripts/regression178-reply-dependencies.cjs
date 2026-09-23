'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const storeSource = fs.readFileSync(path.join(root, 'public/message-store172.js'), 'utf8').replace(/\r\n/g, '\n');
const history = fs.readFileSync(path.join(root, 'public/history174.js'), 'utf8').replace(/\r\n/g, '\n');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');

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

const dispose = functionSource(history, 'dispose');
const render = functionSource(history, 'render');
const reconcile = functionSource(history, 'reconcileBeforeMount');
const replyMeta = functionSource(app, 'getMessageReplyMeta');
const replyRefresh = app.slice(
  app.indexOf("window.addEventListener('fpchat:message-store172-changed'"),
  app.indexOf("async function appendOlderMessages", app.indexOf("window.addEventListener('fpchat:message-store172-changed'"))
);

assert(dispose.includes("node.dataset.fpEvicted174='1'"), 'history eviction marker changed');
assert(dispose.includes('node.remove()'), 'history eviction no longer removes only the DOM node');
assert(!dispose.includes('FPMessageStore172'), 'history DOM eviction started mutating canonical Store state');
assert(!dispose.includes('messageCache'), 'history DOM eviction started mutating legacy reply state');

assert(render.includes('window.FPMessageStore172?.get(view.roomId,message.id)'), 'history return no longer checks Store before render');
assert(render.includes('if(record?.deleted)return;'), 'history return no longer rejects an existing tombstone before decrypt');
assert(render.includes("if(window.FPMessageStore172?.get(view.roomId,message.id)?.deleted)return;"),
  'history return no longer rechecks tombstone after async decrypt');
assert(reconcile.includes('if(record.deleted){dispose(node);continue;}'),
  'history mount reconciliation can remount a deleted source');

assert(replyMeta.includes('window.FPMessageStore172?.resolveReply?.(state.roomId,messageId)'),
  'reply preview no longer resolves through canonical Store');
assert(replyRefresh.includes('refreshReplyBlocks(box)'), 'Store change no longer triggers the existing reply preview refresh');
assert(replyRefresh.includes('draft.replyTo=getMessageReplyMeta(draft.replyTo.messageId)'),
  'Store change no longer refreshes the existing reply composer metadata');

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

const room = 'room-178-3';

// Reply can exist while its source is not mounted/loaded.
store.upsert(room, {
  id: 200,
  type: 'text',
  status: 'sent',
  created_at: '2026-09-22T13:00:02.000Z',
  reply_to_message_id: 100,
  sender_name: 'B'
}, { text: 'reply', preview: 'reply', source: 'history' });

assert.deepEqual(Array.from(store.dependents(room, 100)), ['200'], 'reply dependency was not registered');
let meta = store.resolveReply(room, 100);
assert.equal(meta.state, 'missing', 'unloaded source should resolve as missing before it enters Store');

// Source returns from history. Dependency remains and preview resolves.
events.length = 0;
store.upsert(room, {
  id: 100,
  type: 'text',
  status: 'sent',
  created_at: '2026-09-22T13:00:01.000Z',
  sender_name: 'A'
}, { text: 'source text', preview: 'source text', source: 'history' });

const source = store.get(room, 100);
assert(source, 'returning source was not restored into canonical Store');
assert.deepEqual(Array.from(store.dependents(room, 100)), ['200'], 'source return lost reply dependency');
meta = store.resolveReply(room, 100);
assert.equal(meta.state, 'loaded', 'returned source did not become loaded for reply');
assert.equal(meta.preview, 'source text', 'returned source preview is incorrect');
assert(events.some((event) =>
  event.type === 'fpchat:message-store172-changed' &&
  event.detail?.messageId === 100 &&
  Array.isArray(event.detail?.dependentMessageIds) &&
  event.detail.dependentMessageIds.some((id) => String(id) === '200')
), 'source return did not emit its dependent reply ids');

// Edit uses the same canonical source and existing preview resolution.
events.length = 0;
store.applyEdit(room, {
  id: 100,
  type: 'text',
  status: 'sent',
  created_at: '2026-09-22T13:00:01.000Z',
  edited_at: '2026-09-22T13:05:00.000Z',
  sender_name: 'A'
}, 'edited source', { preview: 'edited source' });

assert.strictEqual(store.get(room, 100), source, 'source edit replaced canonical identity');
meta = store.resolveReply(room, 100);
assert.equal(meta.preview, 'edited source', 'reply preview did not follow existing Store edit');
assert(events.some((event) =>
  event.detail?.messageId === 100 &&
  event.detail?.dependentMessageIds?.some((id) => String(id) === '200')
), 'source edit did not signal dependent replies');

// Delete is a tombstone. A later/stale history return must not resurrect it.
events.length = 0;
store.markDeleted(room, 100, { scope: 'all', source: 'delete' });
meta = store.resolveReply(room, 100);
assert.equal(meta.state, 'deleted', 'deleted source is not exposed as deleted');
assert.equal(meta.preview, 'Сообщение удалено', 'deleted reply preview changed');

store.upsert(room, {
  id: 100,
  type: 'text',
  status: 'read',
  created_at: '2026-09-22T13:00:01.000Z',
  sender_name: 'A'
}, { text: 'stale returned source', preview: 'stale returned source', source: 'history' });

assert.strictEqual(store.get(room, 100), source, 'stale history replaced deleted source identity');
assert.equal(source.deleted, true, 'stale history resurrected deleted source');
assert.equal(source.text, '', 'stale history restored deleted source text');
meta = store.resolveReply(room, 100);
assert.equal(meta.state, 'deleted', 'stale history changed deleted reply state');
assert.equal(meta.preview, 'Сообщение удалено', 'stale history changed deleted reply preview');
assert.deepEqual(Array.from(store.dependents(room, 100)), ['200'], 'delete/history return lost reply dependency');

console.log('PASS 178.3 DOM eviction does not delete reply source from MessageStore');
console.log('PASS returning source preserves dependency and existing reply preview resolution');
console.log('PASS source edit signals dependents through the existing Store change event');
console.log('PASS deleted source cannot be resurrected by stale history');
