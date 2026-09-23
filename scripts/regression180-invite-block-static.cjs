'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const server=read('server.js');
const blocked=read('src/blocked-invite-events165.js');

const start=server.indexOf("app.post('/api/invites/:inviteCode/join'");
const end=server.indexOf("\n});\n\napp.get('/i/:publicId'",start);
assert(start>=0&&end>start,'invite join route missing');
const route=server.slice(start,end);

const guardAt=route.indexOf('const inviteBlock165 = fpUserBlocks165.inviteGuard(room.id, safeDeviceId);');
const participantAnyAt=route.indexOf('q.findParticipantAny.get(room.id, safeDeviceId)');
const txAt=route.indexOf('const tx = db.transaction(() => {');
const consumeAt=route.indexOf('q.consumeInvite.run(safeDeviceId, invite.id);');
const participantAt=route.indexOf('q.upsertParticipant.run(room.id, safeName, safeDeviceId);');
const joinedEventAt=route.indexOf('q.createSystemEvent.run(room.id, participant.id, eventKey, SYSTEM_JOINED, safeName);');
assert(guardAt>=0&&guardAt<participantAnyAt&&participantAnyAt<txAt&&txAt<consumeAt&&consumeAt<participantAt&&participantAt<joinedEventAt,'invite admission/consume/join order changed');
assert(route.includes("return res.status(403).json({ ok: false, error: 'Вход недоступен: пользователь вас заблокировал.', code: inviteBlock165.code });"),'creator-blocked response changed');
assert(route.includes('fpBlockedInviteEvents165.note({ roomId: room.id, joinerId: safeDeviceId, fallbackName: safeName });'),'blocked attempt event call changed');
assert(route.includes("if (!consume.changes) return { ok: false, reason: 'used' };"),'single-consume guard changed');
assert(route.includes("return res.status(410).json({ error: 'invite expired or used' });"),'used invite response changed');

assert(blocked.includes('let attemptCount = Math.max(0, Number(previous.attemptCount) || 0) + 1;'),'attempt counter changed');
assert(blocked.includes('const dedupeKey = `blocked-invite:${creator.room_public_id}:${fingerprint}`;'),'dedupe key changed');
assert(blocked.includes('return transaction.immediate();'),'blocked-event transaction changed');

console.log('PASS 180.3 static invite guard precedes consume/participant/event writes');
console.log('PASS 180.3 static single-consume and blocked-event counter/dedupe contracts are frozen');
