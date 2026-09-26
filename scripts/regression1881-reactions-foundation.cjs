const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const catalogRaw = JSON.parse(read('public/reactions-catalog188.json'));
const catalogModule = require(path.join(root, 'src/reactions-catalog188.js'));
const { createReactionMutationArbiter188 } = require(path.join(root, 'src/reaction-mutation-arbiter188.js'));
const { createMessageReactions188 } = require(path.join(root, 'src/message-reactions188.js'));

assert.equal(catalogRaw.version, 1);
assert.equal(catalogRaw.maxPerParticipantPerMessage, 3);
assert.equal(catalogRaw.quickLimit, 7);
const ids = catalogRaw.reactions.map((item) => item.id);
assert.equal(new Set(ids).size, ids.length, 'reaction ids must be unique');
const quick = catalogModule.catalog.quick.map((item) => item.value);
assert.deepEqual(quick, ['😂', '❤️', '👍', '👎', '🔥', '🥰', '👏']);
assert.equal(catalogModule.catalog.quick.length, 7);

for (const file of ['public/reaction-arbiter188.js', 'public/reaction-manager188.js', 'src/reaction-mutation-arbiter188.js', 'src/message-reactions188.js']) {
  new Function(read(file));
}

const clientArbiter = read('public/reaction-arbiter188.js');
assert(clientArbiter.includes('const MAX_PER_MESSAGE = 20;'), 'client per-message queue cap changed');
assert(clientArbiter.includes("owns: 'ordering only; no transport/retry/persistence'"), 'client arbiter ownership contract missing');
const clientManager = read('public/reaction-manager188.js');
assert(clientManager.includes("cache: 'RAM only; bounded by history lifecycle'"), 'reaction manager RAM-only contract missing');
assert(!clientManager.includes('localStorage.'), 'reaction manager introduced persistent local queue/cache');
assert(!clientManager.includes('indexedDB'), 'reaction manager introduced IndexedDB persistence');

const messageActions = read('src/message-actions-server.js');
assert(messageActions.includes('messageReactions?.deleteForAll?.(auth.room.id, messageId);'), 'delete-for-all does not delete reaction domain');
const reactionServer = read('src/message-reactions188.js');
assert(reactionServer.includes('ORDER BY count DESC, first_seen_at ASC, reaction_id ASC'), 'stable reaction tie ordering changed');
assert(reactionServer.includes("const latestRoom = q.findRoomById?.get?.(auth.room.id) || auth.room;"), 'queued mutation does not recheck room state');
assert(reactionServer.includes("const activeParticipant = q.findParticipant.get(auth.room.id, auth.deviceId);"), 'queued mutation does not recheck participant access');
assert(reactionServer.includes("userBlocks?.roomSendGuard?.(auth.room.id, auth.deviceId)"), 'queued ADD does not recheck block admission');

const server = read('server.js');
assert(server.includes("const { createMessageReactions188 } = require('./src/message-reactions188');"), 'reaction server owner not composed');
assert(server.includes('fpMessageReactions188.installRoutes(app);'), 'reaction routes not installed');
assert(server.includes('fpMessageReactions188.deleteRoom(roomId);'), 'room deletion does not clear reactions');
const index = read('public/index.html');
assert(index.includes("window.addEventListener('fpchat:boot-ready', loadReactionFoundation188"), 'reaction owners must load after boot-ready');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE rooms (id INTEGER PRIMARY KEY, public_id TEXT, status TEXT);
  CREATE TABLE participants (id INTEGER PRIMARY KEY, room_id INTEGER, display_name TEXT, device_id TEXT, access_revoked INTEGER NOT NULL DEFAULT 0);
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
  INSERT INTO messages VALUES (10, 1, 1, 'text', 0);
  INSERT INTO messages VALUES (11, 1, 1, 'system', 0);
  INSERT INTO messages VALUES (12, 1, 1, 'text', 1);
`);
const q = {
  findRoomByPublicId: db.prepare('SELECT * FROM rooms WHERE public_id=?'),
  findParticipant: db.prepare('SELECT * FROM participants WHERE room_id=? AND device_id=? AND access_revoked=0')
};
const service = createMessageReactions188({
  db,
  q,
  isRoomOpen: (room) => room?.status === 'open',
  roomStatePayload: () => ({ roomStatus: 'open', closedAt: null }),
  userBlocks: { roomSendGuard: () => ({ ok: true }) }
});

let result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'joy', operation: 'add' });
assert.equal(result.changed, true);
assert.equal(result.reactionRevision, 1);
result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'heart', operation: 'add' });
assert.equal(result.reactionRevision, 2);
result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'fire', operation: 'add' });
assert.equal(result.reactionRevision, 3);
result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'thumb_up', operation: 'add' });
assert.equal(result.reactionRevision, 4);
assert.deepEqual(result.myReactions.map((item) => item.reactionId), ['heart', 'fire', 'thumb_up'], 'fourth reaction must evict oldest');

result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'thumb_up', operation: 'add' });
assert.equal(result.changed, false);
assert.equal(result.reactionRevision, 4, 'no-op ADD must not increment revision');
result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'heart', operation: 'remove' });
assert.equal(result.changed, true);
assert.equal(result.reactionRevision, 5);
result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'heart', operation: 'remove' });
assert.equal(result.changed, false);
assert.equal(result.reactionRevision, 5, 'no-op REMOVE must not increment revision');

service.mutate({ roomId: 1, messageId: 10, participantId: 2, reactionId: 'heart', operation: 'add' });
result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'heart', operation: 'add' });
const heart = result.reactions.find((item) => item.reactionId === 'heart');
assert.equal(heart.count, 2);
assert.deepEqual(heart.previewParticipantIds, [1, 2], 'preview participants must be newest first');

assert.throws(
  () => service.mutate({ roomId: 1, messageId: 11, participantId: 1, reactionId: 'heart', operation: 'add' }),
  (error) => error?.code === 'REACTION_MESSAGE_UNSUPPORTED'
);
assert.throws(
  () => service.mutate({ roomId: 1, messageId: 12, participantId: 1, reactionId: 'heart', operation: 'add' }),
  (error) => error?.code === 'MESSAGE_DELETED'
);

service.deleteForAll(1, 10);
assert.equal(service.summary(1, 10, 1).reactionRevision, 0);
assert.deepEqual(service.summary(1, 10, 1).reactions, []);

(async () => {
  const arbiter = createReactionMutationArbiter188();
  const order = [];
  const first = arbiter.enqueue(1, 20, async () => {
    order.push('first:start');
    await Promise.resolve();
    order.push('first:end');
  });
  const second = arbiter.enqueue(1, 20, async () => {
    order.push('second:start');
    order.push('second:end');
  });
  const parallel = arbiter.enqueue(1, 21, async () => {
    order.push('parallel');
  });
  await Promise.all([first, second, parallel]);
  assert(order.indexOf('first:end') < order.indexOf('second:start'), 'same-message mutations must be FIFO');
  assert.equal(arbiter.snapshot().lanes, 0, 'empty server lanes must be released');
  console.log('Build 188.1 reaction foundation regression: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
