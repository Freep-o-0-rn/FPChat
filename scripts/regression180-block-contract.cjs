'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');

const server=read('server.js');
const blocks=read('src/user-blocks165.js');
const typing=read('src/typing-server.js');
const voice=read('src/voice-server.js');
const blockedEvents=read('src/blocked-invite-events165.js');
const blockActions=read('src/user-block-event-actions165.js');
const client=read('public/user-blocks165.js');
const systemClient=read('public/chat-request-system147.js');

// Canonical server owner / storage.
assert(server.includes("const fpUserBlocks165 = require('./src/user-blocks165').createUserBlocks165(db);"),'canonical fpUserBlocks165 instance changed');
assert(blocks.includes('CREATE TABLE IF NOT EXISTS chat_request_blocks'),'canonical block table changed');
assert(blocks.includes('blockPair: db.prepare(`SELECT public_id, blocker_device_id, blocked_device_id, created_at FROM chat_request_blocks WHERE blocker_device_id=? AND blocked_device_id=? LIMIT 1`)'),'directed block lookup changed');
assert(blocks.includes('addBlock: db.prepare(`INSERT OR IGNORE INTO chat_request_blocks(public_id, blocker_device_id, blocked_device_id) VALUES(?,?,?)`)'),'block insert semantics changed');
assert(blocks.includes('deleteBlock: db.prepare(`DELETE FROM chat_request_blocks WHERE public_id=? AND blocker_device_id=?`)'),'owned unblock delete changed');

// Directed relationship and send contract.
assert(blocks.includes('const blockedByMe = q.blockPair.get(first, second) || null;'),'blockedByMe direction changed');
assert(blocks.includes('const blockedByPeer = q.blockPair.get(second, first) || null;'),'blockedByPeer direction changed');
assert(blocks.includes("if (rel.blockedByMe) return { ok: false, code: 'USER_BLOCKED_BY_YOU'"),'own-block send rejection changed');
assert(blocks.includes("if (rel.blockedByPeer) return { ok: false, code: 'USER_BLOCKED_BY_PEER'"),'peer-block send rejection changed');

// Presence is intentionally asymmetric: subject -> viewer hides subject presence.
assert(blocks.includes('return !q.blockPair.get(subject, viewer);'),'presence visibility direction changed');
assert(blocks.includes("online: hidden ? false : Boolean(item.online)"),'participant hidden online contract changed');
assert(blocks.includes("lastSeenAt: hidden ? null"),'participant hidden lastSeen contract changed');
assert(server.includes('if (!fpUserBlocks165.canViewerSeePresence(participant.device_id, payload.deviceId)) continue;'),'presence broadcast recipient guard changed');

// Text / message:new / media upload guards.
assert(server.includes('const blockGuard165 = fpUserBlocks165.roomSendGuard(room.id, ws.deviceId);'),'text/message WS roomSendGuard missing');
assert(server.includes("sendMessageRejected(ws, room, clientMessageId, 'blocked', blockGuard165.code)"),'text block ACK semantics changed');
assert(server.includes("sendMessageRejected(ws, room, null, 'blocked', blockGuard165.code)"),'message:new block ACK semantics changed');
assert(server.includes("app.post('/api/rooms/:publicId/media/upload'"),'media upload route missing');
assert(server.includes('const blockGuard165 = fpUserBlocks165.roomSendGuard(room.id, deviceId);'),'encrypted media block guard missing');
assert(server.includes("return res.status(403).json({ ok: false, error: 'blocked', code: blockGuard165.code });"),'encrypted media blocked response changed');

// Voice and typing use the same server truth.
assert(voice.includes('const blockGuard = userBlocks?.roomSendGuard(room.id, deviceId);'),'voice roomSendGuard missing');
assert(voice.includes("return res.status(403).json({ ok: false, error: 'blocked', code: blockGuard.code });"),'voice blocked response changed');
assert(typing.includes('if (userBlocks && !userBlocks.roomSendGuard(room.id, ws.deviceId).ok) return;'),'typing/activity block guard changed');
assert(typing.includes("type: 'typing:update'"),'typing WS effect changed');

// Invite directions and production blocked-invite notification.
assert(blocks.includes("if (creatorBlockedJoiner) return { ok: false, code: 'INVITE_BLOCKED_BY_CREATOR'"),'creator->joiner invite guard changed');
assert(blocks.includes("if (joinerBlockedCreator) return { ok: false, code: 'INVITE_CREATOR_BLOCKED_BY_YOU'"),'joiner->creator invite guard changed');
const joinAt=server.indexOf("app.post('/api/invites/:inviteCode/join'");
const joinEnd=server.indexOf('\n});',joinAt)+4;
const join=server.slice(joinAt,joinEnd);
assert(join.includes('const inviteBlock165 = fpUserBlocks165.inviteGuard(room.id, safeDeviceId);'),'production invite guard missing');
assert(join.includes('fpBlockedInviteEvents165.note({ roomId: room.id, joinerId: safeDeviceId, fallbackName: safeName });'),'production blocked invite event owner changed');
assert(join.includes("code: inviteBlock165.code"),'invite block response code changed');
assert(join.indexOf('inviteGuard(room.id, safeDeviceId)')<join.indexOf('q.consumeInvite.run(safeDeviceId, invite.id)'),'invite guard moved after consumption');

// Private system-chat event dedupe/counter transaction.
assert(blockedEvents.includes("const dedupeKey = `blocked-invite:${creator.room_public_id}:${fingerprint}`;"),'blocked invite dedupe key changed');
assert(blockedEvents.includes('let attemptCount = Math.max(0, Number(previous.attemptCount) || 0) + 1;'),'blocked invite attempt counter changed');
assert(blockedEvents.includes('return transaction.immediate();'),'blocked invite transaction mode changed');
assert(systemClient.includes("if (event?.type !== 'blocked_invite_attempt') return '';"),'system chat blocked-invite preview changed');
assert(systemClient.includes('const count = Math.max(1, Number(event.payload?.attemptCount) || 1);'),'system chat attempt-count presentation changed');
assert(systemClient.includes('/api/user-blocks/pair-status?'),'system chat pair status action changed');
assert(blockActions.includes('const own = userBlocks.relationship(viewer, target).blockedByMe;'),'pair-status server truth changed');

// Current server notification mechanism: snapshot polling -> pair WS refresh.
assert(blocks.includes('const readSnapshot = () => new Map(blocks.q.allBlocks.all().map((row) => [row.public_id, row]));'),'block snapshot owner changed');
assert(blocks.includes('const watcher = setInterval(() => {'),'block snapshot watcher missing');
assert(blocks.includes('}, 1000);'),'block watcher interval changed');
assert(blocks.includes("const payload = { type: 'user-block:changed', roomId: room.public_id };"),'block WS payload changed');
assert(blocks.includes('for (const id of [first, second])'),'block WS recipient pair changed');
assert(blocks.includes('for (const ws of sockets) sendWsJson(ws, payload);'),'block WS socket fanout changed');

// Client is a presentation cache/recovery consumer, never the permission source.
assert(client.includes("const data = await apiJson(`/api/user-blocks/room-status?${params.toString()}`, { cache: 'no-store' });"),'client room-status refresh changed');
assert(client.includes("if (payload?.type === 'user-block:changed' && payload.roomId) {\n        await refreshRoomStatus(payload.roomId, true);"),'client block WS refresh changed');
assert(client.includes("if (!status?.communicationBlocked) return;"),'client blocked composer interception changed');
assert(client.includes('setInterval(() => {\n    const id = currentRoomId();\n    if (id && document.visibilityState === \'visible\') void refreshRoomStatus(id, true);\n  }, 10000);'),'client room-status fallback polling changed');

// No accidental event-driven replacement in this audit step.
assert(blocks.includes('let snapshot = readSnapshot();'),'snapshot state removed prematurely');
assert(!blocks.includes('notifyPair(result.block'),'block mutation started bypassing accepted snapshot notification contract');

console.log('PASS 180.1 canonical block truth remains server-side chat_request_blocks / fpUserBlocks165');
console.log('PASS 180.1 block/unblock, presence, typing, text/media/voice and invite guards preserve current directed semantics');
console.log('PASS 180.1 blocked-invite private system-chat counter/dedupe contract is frozen');
console.log('PASS 180.1 snapshot watcher + user-block:changed + client server-status recovery remain unchanged');
