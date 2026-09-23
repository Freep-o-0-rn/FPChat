'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');

const server=read('server.js');
const blocks=read('src/user-blocks165.js');
const blockedEvents=read('src/blocked-invite-events165.js');
const client=read('public/user-blocks165.js');

// Production passes the one canonical server owner into the blocked-invite event store.
assert(server.includes("const fpUserBlocks165 = require('./src/user-blocks165').createUserBlocks165(db);"),'canonical block owner construction changed');
assert(server.includes("createBlockedInviteEventStore(db, { userBlocks: fpUserBlocks165 })"),'blocked invite event store does not receive canonical owner');
assert(server.indexOf('createUserBlocks165(db)')<server.indexOf('createBlockedInviteEventStore(db, { userBlocks: fpUserBlocks165 })'),'canonical owner must exist before dependent store');

// The bypass is gone: blocked-invite event module may not own/read chat_request_blocks directly.
assert(!blockedEvents.includes('chat_request_blocks'),'blocked invite event store still reads canonical table directly');
assert(!blockedEvents.includes('blockPair: db.prepare'),'blocked invite event store still owns a direct block lookup');
assert(!blockedEvents.includes('q.blockPair.get'),'blocked invite event decision still bypasses owner');

// Exact directed meaning stays creator -> joiner, using the old owner relationship result.
assert(blockedEvents.includes('const block = userBlocks.relationship(creator.device_id, blockedDeviceId).blockedByMe;'),'creator->joiner block decision changed');
assert(blockedEvents.includes("return { ok: false, code: 'BLOCKED_INVITE_EVENT_BLOCK_MISSING' };"),'missing-block error changed');
assert(blockedEvents.includes('blockId: block.public_id'),'system-event blockId changed');

// The canonical owner still derives relationship from SQLite, not from a client snapshot.
assert(blocks.includes('const blockedByMe = q.blockPair.get(first, second) || null;'),'canonical relationship stopped reading server DB');
assert(blocks.includes('const blockedByPeer = q.blockPair.get(second, first) || null;'),'canonical reverse relationship changed');
assert(blocks.includes('blockPair: db.prepare(`SELECT public_id, blocker_device_id, blocked_device_id, created_at FROM chat_request_blocks WHERE blocker_device_id=? AND blocked_device_id=? LIMIT 1`)'),'canonical SQL lookup changed');

// Client remains presentation-only: its cached room status can prevent UX actions but is not wired into server store construction.
assert(client.includes('const roomStatus = new Map();'),'client presentation status cache missing');
assert(client.includes("/api/user-blocks/room-status?${params.toString()}"),'client still refreshes status from server');
assert(!server.includes('communicationBlocked:'),'server does not import a client-derived permission snapshot');

// Notification/polling ownership is deliberately unchanged in 180.2.
assert(blocks.includes('const watcher = setInterval(() => {'),'accepted block snapshot watcher removed');
assert(blocks.includes('}, 1000);'),'accepted block watcher cadence changed');
assert(blocks.includes("const payload = { type: 'user-block:changed', roomId: room.public_id };"),'block change WS contract changed');

console.log('PASS 180.2 blocked-invite event validation now delegates to the canonical fpUserBlocks165 owner');
console.log('PASS 180.2 direct chat_request_blocks read was removed only from the bypassing module');
console.log('PASS 180.2 server SQLite remains permission truth; client status remains presentation-only');
console.log('PASS 180.2 watcher/notification behavior is unchanged');
