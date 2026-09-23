'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const failures = [];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function parseJs(relative) {
  const source = read(relative);
  try { new Function(source); }
  catch (error) { failures.push(`${relative}: syntax error: ${error.message}`); }
  return source;
}

const storeSource = parseJs('public/message-store172.js');
const appSource = parseJs('public/app.js');
const actionsSource = parseJs('public/message-actions.js');
const indexSource = read('public/index.html');
const version = JSON.parse(read('public/version.json'));
const buildNumber = Number(String(version.build).split('.')[0]);
const packageJson = JSON.parse(read('package.json'));

assert(Number.isInteger(buildNumber) && buildNumber >= 172, 'public/version.json must report build 172 or a later integrating build');
assert(indexSource.includes('/message-store172.js'), 'index.html must load message-store172.js');
assert(indexSource.includes('store.onload = load173OwnersThenApp') && indexSource.includes('layer.onload = loadApp'), 'app.js must wait for MessageStore when it loads successfully');
assert(appSource.includes("FPMessageStore172?.legacyCacheAdapter"), 'legacy messageCache must be an adapter to MessageStore');
assert(appSource.includes("FPMessageStore172?.resolveReply"), 'reply resolution must use MessageStore');
assert(appSource.includes("if(window.FPMessageStore172){const record=window.FPMessageStore172.updateStatus"), 'MessageStore must be authoritative for message status when available');
assert(appSource.includes("FPMessageStore172?.promote"), 'clientMessageId ack promotion must use MessageStore');
assert(actionsSource.includes("FPMessageStore172?.applyEdit"), 'message edits must merge through MessageStore');
assert(actionsSource.includes("FPMessageStore172?.markDeleted"), 'message deletion/tombstones must merge through MessageStore');
assert(!storeSource.includes('localStorage.setItem'), 'Build 172 MessageStore must not introduce a persistent outbound/message queue');
assert(packageJson.scripts?.['check:172'] === 'node ./scripts/check-build172.js', 'package.json must expose npm run check:172');

try {
  const events = [];
  const context = {
    console,
    Date,
    Map,
    Set,
    Object,
    String,
    Number,
    Boolean,
    Math,
    Array,
    JSON,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    window: {
      dispatchEvent(event) { events.push(event); }
    }
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(storeSource, context, { filename: 'message-store172.js' });

  const store = context.window.FPMessageStore172;
  assert(Boolean(store), 'FPMessageStore172 did not initialize in VM');

  const room = 'room-test';

  // Reply may render before its source. The dependency must exist and resolve
  // automatically once the source enters the canonical store.
  store.upsert(room, {
    id: 20,
    type: 'text',
    status: 'sent',
    created_at: '2026-09-18T01:00:02Z',
    reply_to_message_id: 10,
    sender_name: 'B'
  }, { text: 'reply', preview: 'reply', source: 'history' });

  let reply = store.resolveReply(room, 10);
  assert(reply.state === 'missing', 'missing reply source must be explicit');
  assert(store.dependents(room, 10).some((value) => String(value) === '20'), 'reply dependency was not recorded');

  store.upsert(room, {
    id: 10,
    type: 'text',
    status: 'sent',
    created_at: '2026-09-18T01:00:01Z',
    sender_name: 'A'
  }, { text: 'original', preview: 'original', source: 'history' });

  reply = store.resolveReply(room, 10);
  assert(reply.state === 'loaded' && reply.preview === 'original', 'reply source did not resolve after source arrival');

  // New edit must beat an older history payload.
  store.applyEdit(room, {
    id: 10,
    type: 'text',
    status: 'sent',
    created_at: '2026-09-18T01:00:01Z',
    edited_at: '2026-09-18T01:05:00Z',
    sender_name: 'A'
  }, 'new edit');

  store.upsert(room, {
    id: 10,
    type: 'text',
    status: 'sent',
    created_at: '2026-09-18T01:00:01Z',
    sender_name: 'A'
  }, { text: 'old history', preview: 'old history', source: 'history' });

  assert(store.get(room, 10)?.text === 'new edit', 'older history overwrote a newer edit');

  // Delivery state must never move backwards.
  store.updateStatus(room, 10, 'read');
  store.updateStatus(room, 10, 'sent');
  assert(store.get(room, 10)?.status === 'read', 'message status regressed from read to sent');

  // Delete is a tombstone: later history cannot resurrect content.
  store.markDeleted(room, 10, { scope: 'all' });
  store.upsert(room, {
    id: 10,
    type: 'text',
    status: 'read',
    created_at: '2026-09-18T01:00:01Z',
    sender_name: 'A'
  }, { text: 'resurrected', preview: 'resurrected', source: 'history' });

  assert(store.get(room, 10)?.deleted === true, 'history resurrected a deleted message');
  assert(store.resolveReply(room, 10).preview === 'Сообщение удалено', 'deleted reply preview is incorrect');

  // Existing clientMessageId identity must promote to server id without creating
  // a second mutable message.
  store.upsert(room, {
    id: 'client-1',
    client_message_id: 'client-1',
    type: 'text',
    status: 'sending',
    created_at: '2026-09-18T01:10:00Z',
    sender_name: 'A'
  }, { text: 'optimistic', source: 'optimistic' });
  store.promote(room, 'client-1', 30, { status: 'delivered' });
  assert(store.get(room, 30)?.clientMessageId === 'client-1', 'clientMessageId promotion lost identity');
  assert(store.get(room, 'client-1')?.id === 30, 'clientMessageId lookup did not follow promoted server id');
  assert(store.get(room, 30)?.status === 'delivered', 'promoted status was not preserved');

  // A server snapshot can precede the ACK that connects it to an optimistic id.
  // The collision must remove both the duplicate record and its reply identity.
  const collisionRoom = 'room-collision';
  store.upsert(collisionRoom, {id:'client-2',client_message_id:'client-2',status:'sending',reply_to_message_id:10}, {text:'optimistic'});
  store.upsert(collisionRoom, {id:40,status:'read',reply_to_message_id:10}, {text:'server'});
  store.markDeleted(collisionRoom, 40, {scope:'all'});
  store.upsert(collisionRoom, {id:40,client_message_id:'client-2',status:'sent',reply_to_message_id:10}, {text:'late echo'});
  store.promote(collisionRoom, 'client-2', 40, {status:'sent'});
  assert(store.roomSnapshot(collisionRoom).messages === 1, 'echo before ACK left duplicate canonical records');
  assert(JSON.stringify(store.dependents(collisionRoom, 10)) === '["40"]', 'promotion left an optimistic reply dependency');
  assert(store.get(collisionRoom, 40)?.status === 'read', 'collision regressed read status');
  assert(store.get(collisionRoom, 40)?.deleted && !store.get(collisionRoom, 40)?.text && !store.get(collisionRoom, 40)?.raw, 'collision resurrected deleted content');

  const snap = store.snapshot();
  assert(snap.owner === 'FPMessageStore172', 'snapshot owner is incorrect');
  assert(Number(snap.messages) >= 3, 'snapshot does not report canonical messages');
  assert(events.some((event) => event.type === 'fpchat:message-store172-changed'), 'MessageStore emitted no change events');
} catch (error) {
  failures.push(`MessageStore VM regression failed: ${error.message}`);
}

if (failures.length) {
  console.error('[Build172 check] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('[Build172 check] OK');
  console.log('Canonical merge, reply dependency, tombstone, status and clientMessageId invariants are present.');
  console.log('This does not replace the manual multi-device regression suite.');
}
