const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const { createMessageReactions188 } = require(path.join(root, 'src/message-reactions188.js'));

const serverSource = read('src/message-reactions188.js');
const detailsSource = read('public/reaction-details188.js');
const interactionSource = read('public/reaction-interaction188.js');
const usernameSearch = read('public/username-search143.js');
const index = read('public/index.html');

for (const source of [serverSource, detailsSource, interactionSource, usernameSearch]) new Function(source);

assert(serverSource.includes('const DETAILS_PAGE_SIZE = 30;'), 'Reaction Details page size changed');
assert(serverSource.includes('REACTION_DETAILS_STALE'), 'revision-stale guard missing');
assert(serverSource.includes('ORDER BY latest.latest_created_at DESC, latest.latest_id DESC, latest.participant_id DESC'), 'All-tab newest-active ordering changed');
assert(serverSource.includes('ORDER BY r.created_at DESC, r.id DESC, r.participant_id DESC'), 'reaction-tab newest ordering changed');
assert(serverSource.includes('COUNT(DISTINCT participant_id)'), 'All tab no longer means one participant = one row');
assert(serverSource.includes('LEFT JOIN user_privacy_settings privacy'), 'profile privacy projection missing');
assert(serverSource.includes('allow_username_search'), 'existing profile visibility setting not respected');
assert(serverSource.includes('blockedByPeer'), 'peer block no longer hides profile action');
assert(serverSource.includes("app.get('/api/rooms/:publicId/messages/:messageId/reactions/details'"), 'Reaction Details route missing');

assert(detailsSource.includes('const PAGE_SIZE = 30;'), 'client Details page size changed');
assert(detailsSource.includes("sheet.setAttribute('aria-modal', 'true');"), 'Reaction Details does not enter existing modal layer contract');
assert(detailsSource.includes('window.FPNetwork171'), 'Reaction Details bypasses FPNetwork171');
assert(detailsSource.includes("response.status === 409 && data?.code === 'REACTION_DETAILS_STALE'"), 'stale pagination response not handled');
assert(detailsSource.includes("markStale(state);"), 'live reaction changes do not mark Details snapshot stale');
assert(detailsSource.includes("window.FPUsernameSearch143?.openProfile"), 'participant rows do not delegate to existing profile owner');
assert(detailsSource.includes("roomContext.signal.addEventListener('abort'"), 'Reaction Details is not bound to RoomContext');
assert(detailsSource.includes('SCROLL_THRESHOLD_PX = 120'), 'lazy scroll threshold changed');
assert(!detailsSource.includes('new WebSocket'), 'Reaction Details creates a second socket');
assert(!detailsSource.includes('MutationObserver'), 'Reaction Details introduced an observer');
assert(!detailsSource.includes('IntersectionObserver'), 'Reaction Details introduced an observer');
assert(!detailsSource.includes('localStorage'), 'Reaction Details introduced persistent state');
assert(!detailsSource.includes('indexedDB'), 'Reaction Details introduced persistent state');
assert(!detailsSource.includes('setInterval('), 'Reaction Details introduced polling');
assert(!detailsSource.includes('setTimeout('), 'Reaction Details introduced timed polling');

assert(interactionSource.includes('const detailsOwner = window.FPReactionDetails188;'), 'long-press/right-click is not delegated to Reaction Details');
assert(usernameSearch.includes('window.FPUsernameSearch143 = Object.freeze({'), 'existing public profile opener is not exposed');
assert(index.includes('reaction-details188.js'), 'Reaction Details asset is not registered');
assert(index.includes('picker.onload = loadReactionDetails188;'), 'Details is not ordered after picker');
assert(index.includes('details.onload = loadReactionInteraction188;'), 'interaction is not ordered after Details');
assert(index.includes('details.onerror = loadReactionInteraction188;'), 'Build 188.4 fallback is lost if Details asset fails');

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
    online INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT,
    updated_at TEXT,
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
  CREATE TABLE user_profiles (
    device_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL UNIQUE,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE user_identities (
    device_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE user_privacy_settings (
    device_id TEXT PRIMARY KEY,
    allow_username_search INTEGER NOT NULL DEFAULT 1,
    allow_chat_requests INTEGER NOT NULL DEFAULT 1,
    show_online_status INTEGER NOT NULL DEFAULT 1,
    show_last_seen_exact INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT INTO rooms(id,public_id,status) VALUES(1,'room-a','open');
  INSERT INTO messages(id,room_id,sender_id,type,deleted_for_all) VALUES(10,1,1,'text',0);
`);

const addParticipant = db.prepare(`
  INSERT INTO participants(id,room_id,display_name,device_id,access_revoked)
  VALUES(?,1,?,?,0)
`);
for (let i = 1; i <= 35; i += 1) {
  addParticipant.run(i, `User ${i}`, `device-${String(i).padStart(4, '0')}`);
}

db.exec(`
  INSERT INTO user_profiles(device_id,username,username_normalized,display_name,role)
  VALUES
    ('device-0001','userone','userone','Profile One','user'),
    ('device-0002','usertwo','usertwo','Profile Two','user'),
    ('device-0003','userthree','userthree','Profile Three','user');
  INSERT INTO user_identities(device_id,display_name)
  VALUES
    ('device-0001','Identity One'),
    ('device-0002','Identity Two'),
    ('device-0003','Identity Three');
  INSERT INTO user_privacy_settings(device_id,allow_username_search)
  VALUES
    ('device-0001',1),
    ('device-0002',0),
    ('device-0003',1);
`);

const q = {
  findRoomByPublicId: db.prepare('SELECT * FROM rooms WHERE public_id=?'),
  findRoomById: db.prepare('SELECT * FROM rooms WHERE id=?'),
  findParticipant: db.prepare('SELECT * FROM participants WHERE room_id=? AND device_id=? AND access_revoked=0')
};
const userBlocks = {
  roomSendGuard: () => ({ ok: true }),
  relationship(viewer, subject) {
    return {
      blockedByMe: null,
      blockedByPeer: viewer === 'device-0001' && subject === 'device-0003' ? { public_id: 'blocked' } : null,
      communicationBlocked: false
    };
  }
};
const service = createMessageReactions188({
  db,
  q,
  isRoomOpen: (room) => room?.status === 'open',
  roomStatePayload: () => ({ roomStatus: 'open', closedAt: null }),
  userBlocks
});

for (let participantId = 1; participantId <= 35; participantId += 1) {
  service.mutate({
    roomId: 1,
    messageId: 10,
    participantId,
    reactionId: 'heart',
    operation: 'add'
  });
}

const firstHeart = service.reactionDetailsPage({
  roomId: 1,
  messageId: 10,
  viewerParticipantId: 1,
  viewerDeviceId: 'device-0001',
  reactionId: 'heart'
});
assert.equal(firstHeart.reactionRevision, 35);
assert.equal(firstHeart.rows.length, 30);
assert.equal(firstHeart.hasMore, true);
assert.ok(firstHeart.nextCursor);
assert.equal(firstHeart.pageSize, 30);
assert.equal(firstHeart.tabs.allCount, 35);
assert.equal(firstHeart.tabs.reactions.find((item) => item.reactionId === 'heart')?.count, 35);

const secondHeart = service.reactionDetailsPage({
  roomId: 1,
  messageId: 10,
  viewerParticipantId: 1,
  viewerDeviceId: 'device-0001',
  reactionId: 'heart',
  cursor: firstHeart.nextCursor,
  expectedRevision: firstHeart.reactionRevision
});
assert.equal(secondHeart.rows.length, 5);
assert.equal(secondHeart.hasMore, false);
const heartIds = [...firstHeart.rows, ...secondHeart.rows].map((row) => row.participantId);
assert.equal(new Set(heartIds).size, 35, 'keyset pagination duplicated/omitted a reactor');

service.mutate({
  roomId: 1,
  messageId: 10,
  participantId: 1,
  reactionId: 'fire',
  operation: 'add'
});
assert.throws(
  () => service.reactionDetailsPage({
    roomId: 1,
    messageId: 10,
    viewerParticipantId: 1,
    viewerDeviceId: 'device-0001',
    reactionId: 'heart',
    cursor: firstHeart.nextCursor,
    expectedRevision: 35
  }),
  (error) => error?.code === 'REACTION_DETAILS_STALE' && error?.reactionRevision === 36,
  'mixed-revision lazy page was accepted'
);

const allFirst = service.reactionDetailsPage({
  roomId: 1,
  messageId: 10,
  viewerParticipantId: 1,
  viewerDeviceId: 'device-0001',
  reactionId: 'all'
});
const allSecond = service.reactionDetailsPage({
  roomId: 1,
  messageId: 10,
  viewerParticipantId: 1,
  viewerDeviceId: 'device-0001',
  reactionId: 'all',
  cursor: allFirst.nextCursor,
  expectedRevision: allFirst.reactionRevision
});
const allRows = [...allFirst.rows, ...allSecond.rows];
assert.equal(allFirst.tabs.allCount, 35);
assert.equal(new Set(allRows.map((row) => row.participantId)).size, 35, 'All tab is not one participant = one row');

const row1 = allRows.find((row) => row.participantId === 1);
const row2 = allRows.find((row) => row.participantId === 2);
const row3 = allRows.find((row) => row.participantId === 3);
assert.deepEqual(row1.reactions.map((item) => item.reactionId), ['fire', 'heart']);
assert.equal(row1.profile?.username, 'userone', 'visible profile missing');
assert.equal(row1.profile?.displayName, 'Identity One');
assert.equal(row2.profile, null, 'hidden public profile leaked through Reaction Details');
assert.equal(row3.profile, null, 'peer-blocked public profile leaked through Reaction Details');

const ownHiddenFirst = service.reactionDetailsPage({
  roomId: 1,
  messageId: 10,
  viewerParticipantId: 2,
  viewerDeviceId: 'device-0002',
  reactionId: 'all'
});
const ownHiddenSecond = service.reactionDetailsPage({
  roomId: 1,
  messageId: 10,
  viewerParticipantId: 2,
  viewerDeviceId: 'device-0002',
  reactionId: 'all',
  cursor: ownHiddenFirst.nextCursor,
  expectedRevision: ownHiddenFirst.reactionRevision
});
const ownRow2 = [...ownHiddenFirst.rows, ...ownHiddenSecond.rows].find((row) => row.participantId === 2);
assert.equal(ownRow2.profile?.username, 'usertwo', 'self profile should remain openable to self');

const heartCreatedBeforeDelete = row1.reactions.find((item) => item.reactionId === 'heart')?.createdAt;
service.mutate({
  roomId: 1,
  messageId: 10,
  participantId: 1,
  reactionId: 'fire',
  operation: 'remove'
});

const afterDeleteFirst = service.reactionDetailsPage({
  roomId: 1,
  messageId: 10,
  viewerParticipantId: 1,
  viewerDeviceId: 'device-0001',
  reactionId: 'all'
});
const afterDeleteSecond = service.reactionDetailsPage({
  roomId: 1,
  messageId: 10,
  viewerParticipantId: 1,
  viewerDeviceId: 'device-0001',
  reactionId: 'all',
  cursor: afterDeleteFirst.nextCursor,
  expectedRevision: afterDeleteFirst.reactionRevision
});
const afterDeleteRows = [...afterDeleteFirst.rows, ...afterDeleteSecond.rows];
const afterDeleteRow1 = afterDeleteRows.find((row) => row.participantId === 1);
assert.equal(afterDeleteRows.at(-1)?.participantId, 1, 'removing a reaction incorrectly moved participant upward in All');
assert.equal(afterDeleteRow1.reactions.length, 1);
assert.equal(afterDeleteRow1.reactions[0].reactionId, 'heart');
assert.equal(afterDeleteRow1.reactions[0].createdAt, heartCreatedBeforeDelete, 'remaining reaction timestamp was rewritten after deletion');

console.log('Build 188.6 Reaction Details regression: PASS');
