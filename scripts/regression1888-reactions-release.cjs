const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const reactionServer = read('src/message-reactions188.js');
const serverArbiter = read('src/reaction-mutation-arbiter188.js');
const clientArbiter = read('public/reaction-arbiter188.js');
const clientManager = read('public/reaction-manager188.js');
const renderer = read('public/reaction-renderer188.js');
const interaction = read('public/reaction-interaction188.js');
const picker = read('public/reaction-picker188.js');
const details = read('public/reaction-details188.js');
const history = read('public/history174.js');
const app = read('public/app.js');
const messageActions = read('src/message-actions-server.js');
const index = read('public/index.html');
const version = JSON.parse(read('public/version.json'));
const pkg = JSON.parse(read('package.json'));
const updater = read('update.bat');
const buildUi = read('public/build165-ui.js');
const settingsUi = read('public/settings-ui131.js');

for (const source of [
  reactionServer,
  serverArbiter,
  clientArbiter,
  clientManager,
  renderer,
  interaction,
  picker,
  details,
  history,
  app,
  messageActions
]) new Function(source);

// Final ownership map.
assert(clientManager.includes("owner: 'FPReactionManager188'"), 'ReactionManager owner missing');
assert(clientArbiter.includes("owner: 'FPReactionArbiter188'"), 'client ReactionArbiter owner missing');
assert(serverArbiter.includes("owner: 'FPReactionMutationArbiter188'"), 'server ReactionMutationArbiter owner missing');
assert(renderer.includes("owner: 'FPReactionRenderer188'"), 'ReactionRenderer owner missing');
assert(interaction.includes("owner: 'FPReactionInteractionManager188'"), 'ReactionInteractionManager owner missing');
assert(picker.includes("owner: 'FPReactionPicker188'"), 'ReactionPicker worker missing');
assert(details.includes("owner: 'FPReactionDetails188'"), 'ReactionDetails owner missing');

// Queue/state isolation.
assert(clientArbiter.includes('const MAX_PER_MESSAGE = 20;'), 'client per-message queue cap changed');
assert(clientArbiter.includes("ordering only; no transport/retry/persistence"), 'client arbiter ownership widened');
assert(clientManager.includes("cache: 'RAM only; bounded by FPHistory174 mounted numeric IDs'"), 'reaction RAM cache contract changed');
assert(!clientManager.includes('localStorage.'), 'reaction state became persistent');
assert(!clientManager.includes('indexedDB'), 'reaction state added IndexedDB');
assert(!clientManager.includes('setInterval('), 'reaction manager introduced polling');
assert(!renderer.includes('FPMediaManager177'), 'reaction renderer crossed into media manager');
assert(!picker.includes('FPMediaManager177'), 'reaction picker crossed into media manager');
assert(!details.includes('FPMediaManager177'), 'reaction details crossed into media manager');
assert(!clientManager.includes('caches.'), 'reaction manager writes CacheStorage');
assert(!picker.includes('caches.'), 'reaction picker writes CacheStorage');
assert(!details.includes('caches.'), 'reaction details writes CacheStorage');

// Lazy-history integration stays opt-in/bounded.
assert(history.includes("reactions:'1'"), 'lazy-history no longer explicitly requests reactions');
assert(history.includes('reactions.syncHistoryRange?.(history.roomId,numeric);'), 'reaction RAM is no longer history-window bounded');
assert(clientManager.includes('wsIgnoredUnloaded'), 'unloaded reaction WS guard missing');
assert(app.includes('while(pending.size>300)'), 'pre-manager reaction WS staging became unbounded');

// Reactions must not become chat activity/unread/notifications.
const wsStart = app.indexOf('function handleWsReactionUpdate188(payload)');
const wsEnd = app.indexOf('function rememberLastKnownMessageId', wsStart);
assert(wsStart >= 0 && wsEnd > wsStart, 'reaction WS handler missing');
const wsHandler = app.slice(wsStart, wsEnd);
for (const forbidden of ['noteUnreadEvent(', 'upsertChat(', 'updateUnreadPresentation(', 'showNotification(', 'notifyIncoming']) {
  assert(!wsHandler.includes(forbidden), `reaction WS changed chat/unread/notification state through ${forbidden}`);
}

// UI contracts accepted in 188.3-188.6.
assert(renderer.includes("(count === 1 || count === 2) && preview.length === count"), 'avatar preview no longer limited to 1-2 reactors');
assert(renderer.includes("previewParticipantIds.map(Number)"), 'reaction participant preview IDs missing');
assert(renderer.includes("pill.classList.toggle('is-mine'"), 'own compact reaction highlight missing');
assert(renderer.includes("document.createElement('button')"), 'compact reaction pill is not interactive');
assert(interaction.includes('const LONG_PRESS_MS = 450;'), 'reaction long press timing changed');
assert(interaction.includes('const MOVE_CANCEL_PX = 12;'), 'reaction long press movement threshold changed');
assert(interaction.includes("watchAction?.('reaction-long-press'"), 'reaction long press bypasses FPGesture135');
assert(interaction.includes('manager.getQuickReactions()'), 'quick reactions no longer use canonical catalog');
assert(interaction.includes('manager.getAvailableReactions()'), 'full picker no longer uses canonical catalog');
assert(picker.includes('if (next && !state.rendered) render(state);'), 'full picker no longer lazy-renders');
assert(details.includes('const PAGE_SIZE = 30;'), 'Reaction Details lazy page size changed');
assert(details.includes("sheet.setAttribute('aria-modal', 'true')"), 'Reaction Details left existing modal layer contract');
assert(details.includes('window.FPNetwork171'), 'Reaction Details bypasses FPNetwork171');
assert(details.includes('window.FPUsernameSearch143?.openProfile'), 'Reaction Details bypasses existing profile owner');

// Server conflict/order/load protection.
assert(reactionServer.includes('UNIQUE(message_id, participant_id, reaction_id)'), 'reaction uniqueness changed');
assert(reactionServer.includes('catalog.maxPerParticipantPerMessage'), 'max-three rule not server authoritative');
assert(reactionServer.includes('ORDER BY count DESC, first_seen_at ASC, reaction_id ASC'), 'reaction group ordering changed');
assert(reactionServer.includes('REACTION_DETAILS_STALE'), 'Reaction Details revision race guard missing');
assert(serverArbiter.includes('const WINDOW_MS = 5000;'), 'adaptive admission window changed');
assert(serverArbiter.includes('const USER_BURST_LIMIT = 20;'), 'per-user burst guard changed');
assert(serverArbiter.includes('const ROOM_MIN_BUDGET = 40;'), 'room admission floor changed');
assert(serverArbiter.includes('const ROOM_MAX_BUDGET = 250;'), 'room admission cap changed');
assert(serverArbiter.includes("REACTION_RATE_LIMITED', 429"), 'per-user overload response missing');
assert(serverArbiter.includes("REACTION_BUSY', 503"), 'room overload response missing');
assert(!serverArbiter.includes('setInterval('), 'server admission introduced polling');

// Delete/edit semantics.
const selfStart = messageActions.indexOf("if (scope === 'self')");
const selfEnd = messageActions.indexOf("if (row.sender_device_id !== auth.deviceId)", selfStart);
assert(selfStart >= 0 && selfEnd > selfStart, 'delete-for-self branch missing');
assert(!messageActions.slice(selfStart, selfEnd).includes('messageReactions?.deleteForAll'), 'delete-for-self destroys reaction domain');

const editStart = messageActions.indexOf("app.put('/api/rooms/:publicId/messages/:messageId/edit'");
const editEnd = messageActions.indexOf("app.delete('/api/rooms/:publicId/messages/:messageId'", editStart);
assert(editStart >= 0 && editEnd > editStart, 'edit route missing');
assert(!messageActions.slice(editStart, editEnd).includes('messageReactions'), 'editing a message mutates reaction domain');
assert(messageActions.includes('messageReactions?.deleteForAll?.(auth.room.id, messageId);'), 'delete-for-all does not destroy reaction domain');

// Post-boot optional feature chain.
assert(index.includes("window.addEventListener('fpchat:boot-ready', loadReactionFoundation188"), 'reaction feature entered critical startup gate');
assert(index.includes('renderer.onload = loadReactionPicker188;'), 'reaction renderer/picker order changed');
assert(index.includes('picker.onload = loadReactionDetails188;'), 'picker/details order changed');
assert(index.includes('details.onload = loadReactionInteraction188;'), 'details/interaction order changed');
assert(index.includes('details.onerror = loadReactionInteraction188;'), 'Reaction Details optional fallback missing');

// Release identity.
assert.equal(version.build, '188.8', 'version.json is not Build 188.8');
assert(updater.includes('set "EXPECTED_BUILD=188.8"'), 'updater does not require Build 188.8');
assert(buildUi.includes("const BUILD_LABEL = 'Build 188.8';"), 'build UI label is not 188.8');
assert(settingsUi.includes("const BUILD = '188.8';"), 'settings UI label is not 188.8');
assert.equal(pkg.scripts['test:188'], 'npm run test:188.8', 'final Build 188 alias missing');

// Server domain acceptance with real SQLite.
const { createMessageReactions188 } = require(path.join(root, 'src/message-reactions188.js'));
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE rooms (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
  );
  CREATE TABLE participants (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL,
    display_name TEXT,
    device_id TEXT NOT NULL,
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

  INSERT INTO rooms VALUES(1,'room-a','open');
  INSERT INTO participants VALUES
    (1,1,'Vadim','device-1',0),
    (2,1,'Ivan','device-2',0),
    (3,1,'Alex','device-3',0),
    (4,1,'Oleg','device-4',0),
    (5,1,'Anna','device-5',0);

  INSERT INTO messages VALUES
    (10,1,1,'text',0),
    (11,1,1,'media',0),
    (12,1,1,'voice',0),
    (13,1,1,'system',0),
    (14,1,1,'text',1);
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
  userBlocks: { roomSendGuard: () => ({ ok: true }) },
  getOnlineParticipantCount: () => 5
});

// Text/media/voice supported.
for (const messageId of [10, 11, 12]) {
  const result = service.mutate({
    roomId: 1,
    messageId,
    participantId: 1,
    reactionId: 'heart',
    operation: 'add'
  });
  assert.equal(result.changed, true, `supported message ${messageId} rejected reaction`);
}

// System/deleted-for-all rejected.
assert.throws(
  () => service.mutate({ roomId: 1, messageId: 13, participantId: 1, reactionId: 'heart', operation: 'add' }),
  (error) => error?.code === 'REACTION_MESSAGE_UNSUPPORTED'
);
assert.throws(
  () => service.mutate({ roomId: 1, messageId: 14, participantId: 1, reactionId: 'heart', operation: 'add' }),
  (error) => error?.code === 'MESSAGE_DELETED'
);

// Max three, fourth evicts oldest.
service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'joy', operation: 'add' });
service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'fire', operation: 'add' });
let result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'thumb_up', operation: 'add' });
assert.deepEqual(
  result.myReactions.map((item) => item.reactionId),
  ['joy', 'fire', 'thumb_up'],
  'fourth reaction did not evict the oldest own reaction'
);

// Explicit ADD/REMOVE no-op revision behavior.
const beforeNoop = result.reactionRevision;
result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'thumb_up', operation: 'add' });
assert.equal(result.changed, false);
assert.equal(result.reactionRevision, beforeNoop);
result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'joy', operation: 'remove' });
assert.equal(result.changed, true);
const afterRemove = result.reactionRevision;
result = service.mutate({ roomId: 1, messageId: 10, participantId: 1, reactionId: 'joy', operation: 'remove' });
assert.equal(result.changed, false);
assert.equal(result.reactionRevision, afterRemove);

// Popularity ordering + compact avatar rule.
service.deleteForAll(1, 11);
service.mutate({ roomId: 1, messageId: 11, participantId: 1, reactionId: 'heart', operation: 'add' });
service.mutate({ roomId: 1, messageId: 11, participantId: 2, reactionId: 'heart', operation: 'add' });
let summary = service.summary(1, 11, 1);
let heart = summary.reactions.find((item) => item.reactionId === 'heart');
assert.equal(heart.count, 2);
assert.deepEqual(heart.previewParticipantIds, [2, 1], 'two-person preview order changed');

service.mutate({ roomId: 1, messageId: 11, participantId: 3, reactionId: 'heart', operation: 'add' });
service.mutate({ roomId: 1, messageId: 11, participantId: 4, reactionId: 'fire', operation: 'add' });
service.mutate({ roomId: 1, messageId: 11, participantId: 5, reactionId: 'fire', operation: 'add' });
service.mutate({ roomId: 1, messageId: 11, participantId: 1, reactionId: 'joy', operation: 'add' });
summary = service.summary(1, 11, 1);
assert.deepEqual(summary.reactions.map((item) => item.reactionId), ['heart', 'fire', 'joy']);
heart = summary.reactions[0];
assert.equal(heart.count, 3);
assert.equal(Object.prototype.hasOwnProperty.call(heart, 'previewParticipantIds'), false, '3+ reaction still carries avatar preview');
const fire = summary.reactions[1];
assert.deepEqual(fire.previewParticipantIds, [5, 4]);

// Delete-for-all destroys rows and reaction revision.
service.deleteForAll(1, 11);
summary = service.summary(1, 11, 1);
assert.equal(summary.reactionRevision, 0);
assert.deepEqual(summary.reactions, []);
assert.deepEqual(summary.myReactions, []);

console.log('Build 188.8 reactions release acceptance: PASS');
