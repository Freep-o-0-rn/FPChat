const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const { createMessageReactions188 } = require(path.join(root, 'src/message-reactions188.js'));

for (const file of [
  'src/message-reactions188.js',
  'server.js',
  'public/reaction-manager188.js',
  'public/history174.js',
  'public/app.js'
]) new Function(read(file));

const reactionServer = read('src/message-reactions188.js');
assert.equal((reactionServer.match(/const bulkSummaryRows = db\.prepare/g) || []).length, 1, 'bulk summary statement duplicated');
assert(reactionServer.includes('ROW_NUMBER() OVER (PARTITION BY r.message_id, r.reaction_id ORDER BY r.id DESC)'), 'preview order is not newest-first');
assert(reactionServer.includes('COUNT(*) OVER (PARTITION BY r.message_id, r.reaction_id)'), 'bulk aggregate count missing');
assert(reactionServer.includes("app.post('/api/rooms/:publicId/reactions/summary'"), 'bounded loaded-window summary endpoint missing');
assert(reactionServer.includes('.slice(0, 300)'), 'loaded-window server cap must remain 300');

const server = read('server.js');
assert(server.includes('includeReactions = String(req.query?.reactions || \'\') === \'1\''), 'history reaction SQL is no longer opt-in on /messages');
assert(server.includes('if (!includeReactions) return page;'), 'non-history message reads now pay reaction summary cost');
assert(server.includes('summariesForMessages('), 'history no longer gets bulk reaction summaries');

const history = read('public/history174.js');
assert(history.includes("reactions:'1'"), 'FPHistory174 does not request reaction summaries with its page');
assert(history.includes('mergeReactionSummaries188(older.reactionSummaries,newer.reactionSummaries)'), 'anchor history does not merge reaction summaries');
assert(history.includes('data.reactionSummaries=filterReactionSummaries188(data.reactionSummaries,data.messages);'), 'trimmed initial history keeps off-window reaction summaries');
assert(history.includes('reactions.syncHistoryRange?.(history.roomId,numeric);'), 'reaction RAM cache is not bound to mounted numeric history IDs');
assert(history.includes('history.reactionSummaries188=null;'), 'staged initial summaries are retained after ingest');
assert(history.includes('pendingReactionUpdates188.clear();'), 'pre-manager WS buffer is not released');
assert(history.includes('syncReactionRange'), 'late-loaded reaction manager cannot adopt current history window');

const managerSource = read('public/reaction-manager188.js');
assert(managerSource.includes("cache: 'RAM only; bounded by FPHistory174 mounted numeric IDs'"), 'bounded RAM ownership contract changed');
assert(managerSource.includes('wsIgnoredUnloaded'), 'unloaded WS rejection metric missing');
assert(managerSource.includes('if (!retained)'), 'unloaded reaction WS path no longer rejects storage');
assert(!managerSource.includes('localStorage.'), 'reaction cache became persistent');
assert(!managerSource.includes('indexedDB'), 'reaction cache introduced IndexedDB');

const app = read('public/app.js');
assert(app.includes('reactionSummaries188:Array.isArray(data.reactionSummaries)?data.reactionSummaries:[]'), 'initial reaction summaries are not staged with active history');
assert(app.includes('pendingReactionUpdates188:new Map()'), 'bounded pre-manager WS bridge missing');
assert(app.includes('while(pending.size>300)'), 'pre-manager WS bridge is unbounded');
const handlerStart = app.indexOf('function handleWsReactionUpdate188(payload)');
const handlerEnd = app.indexOf('function rememberLastKnownMessageId', handlerStart);
assert(handlerStart >= 0 && handlerEnd > handlerStart, 'reaction WS handler missing');
const handler = app.slice(handlerStart, handlerEnd);
assert(!handler.includes('noteUnreadEvent'), 'reaction WS changes unread state');
assert(!handler.includes('upsertChat('), 'reaction WS changes chat list activity');
assert(app.includes("if(handleWsPresenceUpdate(payload)||handleWsMessageAck(payload)||handleWsMessageStatus(payload)||handleWsUnreadState(payload)||handleWsReactionUpdate188(payload))"), 'reaction WS event is not routed through existing socket worker');
assert(app.includes('/reactions/summary'), 'reconnect current-window reaction reconciliation missing');
assert(app.includes('.slice(0,300)'), 'reconnect reaction batch must remain bounded to history window');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE rooms (id INTEGER PRIMARY KEY, public_id TEXT, status TEXT);
  CREATE TABLE participants (
    id INTEGER PRIMARY KEY,
    room_id INTEGER,
    display_name TEXT,
    device_id TEXT,
    access_revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    deleted_for_all INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE message_hidden (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    UNIQUE(room_id, message_id, device_id)
  );

  INSERT INTO rooms VALUES (1, 'room-a', 'open');
  INSERT INTO participants VALUES (1, 1, 'A', 'device-a', 0);
  INSERT INTO participants VALUES (2, 1, 'B', 'device-b', 0);
  INSERT INTO participants VALUES (3, 1, 'C', 'device-c', 0);
  INSERT INTO messages VALUES (10, 1, 1, 'text', 0);
  INSERT INTO messages VALUES (11, 1, 1, 'text', 0);
  INSERT INTO messages VALUES (12, 1, 1, 'text', 0);
`);
const q = {
  findRoomByPublicId: db.prepare('SELECT * FROM rooms WHERE public_id=?'),
  findRoomById: db.prepare('SELECT * FROM rooms WHERE id=?'),
  findParticipant: db.prepare('SELECT * FROM participants WHERE room_id=? AND device_id=? AND access_revoked=0')
};
const service = createMessageReactions188({
  db,
  q,
  isRoomOpen: (room) => room?.status === 'open',
  roomStatePayload: () => ({ roomStatus: 'open', closedAt: null }),
  userBlocks: { roomSendGuard: () => ({ ok: true }) }
});

service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'heart', operation: 'add' });
service.mutate({ roomId: 1, messageId: 10, participantId: 2, reactionId: 'heart', operation: 'add' });
service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'fire', operation: 'add' });

service.mutate({ roomId: 1, messageId: 11, participantId: 1, reactionId: 'joy', operation: 'add' });
service.mutate({ roomId: 1, messageId: 11, participantId: 2, reactionId: 'joy', operation: 'add' });
service.mutate({ roomId: 1, messageId: 11, participantId: 3, reactionId: 'joy', operation: 'add' });

service.mutate({ roomId: 1, messageId: 12, participantId: 1, reactionId: 'thumb_up', operation: 'add' });
service.mutate({ roomId: 1, messageId: 12, participantId: 1, reactionId: 'thumb_up', operation: 'remove' });

const summaries = service.summariesForMessages(1, [10, 11, 12], 1);
assert.deepEqual(summaries.map((item) => item.messageId), [10, 11, 12], 'bulk summary omitted revision-only message');

const ten = summaries.find((item) => item.messageId === 10);
assert.equal(ten.reactions[0].reactionId, 'heart');
assert.equal(ten.reactions[0].count, 2);
assert.equal(ten.reactions[0].mine, true);
assert.deepEqual(ten.reactions[0].previewParticipantIds, [2, 1], 'two-person preview must be newest first');
assert.equal(ten.reactions[1].reactionId, 'fire');
assert.deepEqual(ten.myReactions.map((item) => item.reactionId), ['heart', 'fire']);

const eleven = summaries.find((item) => item.messageId === 11);
assert.equal(eleven.reactions[0].count, 3);
assert.equal(Object.prototype.hasOwnProperty.call(eleven.reactions[0], 'previewParticipantIds'), false, '3+ summary must not carry avatars');

const twelve = summaries.find((item) => item.messageId === 12);
assert.equal(twelve.reactionRevision, 2);
assert.deepEqual(twelve.reactions, [], 'revision-only empty state must survive for authoritative clearing');

const fakeWindow = {
  addEventListener() {},
  dispatchEvent() {},
  FPReactionArbiter188: {
    hasPending() { return false; },
    cancelMessage() {},
    cancelRoom() {}
  },
  FPRuntime: null,
  FPHistory174: null
};
function CustomEventFake(type, init) { this.type = type; this.detail = init?.detail; }
new Function('window', 'CustomEvent', 'fetch', 'queueMicrotask', managerSource)(
  fakeWindow,
  CustomEventFake,
  async () => { throw new Error('catalog fetch not expected'); },
  (fn) => fn()
);
const manager = fakeWindow.FPReactionManager188;
manager.syncHistoryRange('room-a', [10, 11]);
manager.ingestHistoryPage('room-a', [{
  messageId: 10,
  reactionRevision: 2,
  reactions: [{ reactionId: 'heart', type: 'emoji', value: '❤️', count: 1, mine: true, previewParticipantIds: [1] }],
  myReactions: [{ reactionId: 'heart', type: 'emoji', value: '❤️', createdAt: '2026-09-26T10:00:00Z' }],
  catalogVersion: 1
}], { messageIds: [10, 11] });

manager.ingestWs({
  type: 'reaction:update',
  roomId: 'room-a',
  messageId: 999,
  reactionRevision: 1,
  reactions: [{ reactionId: 'fire', type: 'emoji', value: '🔥', count: 1 }],
  changedParticipantId: 2,
  changedParticipantReactions: ['fire'],
  catalogVersion: 1
}, 1);
assert.equal(manager.get('room-a', 999), null, 'WS for unloaded message polluted RAM');

manager.ingestWs({
  type: 'reaction:update',
  roomId: 'room-a',
  messageId: 10,
  reactionRevision: 3,
  reactions: [{ reactionId: 'heart', type: 'emoji', value: '❤️', count: 2, previewParticipantIds: [2, 1] }],
  changedParticipantId: 2,
  changedParticipantReactions: ['heart'],
  catalogVersion: 1
}, 1);
assert.equal(manager.get('room-a', 10).reactionRevision, 3);
assert.equal(manager.get('room-a', 10).reactions[0].mine, true, 'peer WS update lost viewer ownership');

manager.syncHistoryRange('room-a', [11]);
assert.equal(manager.get('room-a', 10), null, 'evicted history message kept reaction RAM state');
assert.equal(manager.snapshot().loaded, 1);
assert.equal(manager.snapshot().stats.wsIgnoredUnloaded, 1);

console.log('Build 188.2 reaction history/state regression: PASS');
