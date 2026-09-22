'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const server=read('server.js'),boot=read('src/message-actions-bootstrap.js'),pkg=JSON.parse(read('package.json'));

const installers=[
 'installMessageActionsServer','installMessagePinsServer','installTypingServer','installUsernameServer',
 'installSystemEventsServer','installStorageStats168','installUserBlocks165Server',
 'installUserBlockEventActions165','installChatRequestsServer','installVoiceServer'
];
let prev=-1;
for(const name of installers){
 const matches=server.match(new RegExp(name+'\\(\\{','g'))||[];
 assert.equal(matches.length,1,name+' must be explicit exactly once');
 const at=server.indexOf(name+'({');
 assert(at>prev,'explicit installer order changed at '+name);
 prev=at;
}
assert.equal((boot.match(/install[A-Za-z0-9_]+\(\{/g)||[]).length,0,'bootstrap contains installer calls');

const dbAt=server.indexOf('const db = createDb(DATABASE_PATH);');
const blockStoreAt=server.indexOf("const fpUserBlocks165 = require('./src/user-blocks165').createUserBlocks165(db);");
const blockedEventAt=server.indexOf("const fpBlockedInviteEvents165 = require('./src/blocked-invite-events165').createBlockedInviteEventStore(db);");
assert(dbAt>=0&&blockStoreAt>dbAt&&blockedEventAt>blockStoreAt,'T1 explicit store order changed');
assert.equal((server.match(/fpUserBlocks165\.participantPresenceDto\(item, safeDeviceId, toIsoUtc\)/g)||[]).length,2,'T2 site count changed');

const presenceAt=server.indexOf('function broadcastPresenceUpdate(roomPublicId, payload) {');
const presence=server.slice(presenceAt,server.indexOf('\n}',presenceAt)+2);
assert(presence.includes('fpUserBlocks165.canViewerSeePresence'),'T3 presence guard missing');
assert(presence.includes('sendWsJson(client, event)'),'T3 WS effect missing');

const textAt=server.indexOf('async function handleTextMessage(ws, payload)');
const textFn=server.slice(textAt,server.indexOf('\n}',textAt)+2);
assert(textFn.includes('fpUserBlocks165.roomSendGuard(room.id, ws.deviceId)'),'T4 missing');
assert(textFn.includes("sendMessageRejected(ws, room, clientMessageId, 'blocked', blockGuard165.code)"),'T4 rejection changed');

const legacyAt=server.indexOf("if (payload.type === 'message:new')");
const legacy=server.slice(legacyAt,server.indexOf('const msgType =',legacyAt));
assert(legacy.includes('fpUserBlocks165.roomSendGuard(room.id, ws.deviceId)'),'T5 missing');

const mediaAt=server.indexOf("app.post('/api/rooms/:publicId/media/upload'");
const media=server.slice(mediaAt,server.indexOf('const mimeType',mediaAt)+120);
assert(media.includes('fpUserBlocks165.roomSendGuard(room.id, deviceId)'),'T6 missing');

const inviteAt=server.indexOf("app.post('/api/invites/:inviteCode/join'");
const invite=server.slice(inviteAt,server.indexOf('const tx = db.transaction',inviteAt));
assert(invite.includes('fpUserBlocks165.inviteGuard(room.id, safeDeviceId)'),'T7 invite guard missing');
assert(invite.includes('fpBlockedInviteEvents165.note({ roomId: room.id, joinerId: safeDeviceId, fallbackName: safeName })'),'T7 blocked invite event missing');

assert.equal((server.match(/server\.listen\(/g)||[]).length,1,'server.listen must execute from one source site');
assert.equal((server.match(/setInterval\(cleanupExpiredSoloRooms, 10 \* 60 \* 1000\)/g)||[]).length,1,'cleanup startup interval count changed');
const cleanup=server.lastIndexOf('\ncleanupExpiredSoloRooms();');
assert(prev<cleanup,'all explicit installers must execute before cleanup/listen');

assert.equal(pkg.scripts.start,'node server.js');
assert(!boot.includes("Module._extensions['.js']"));
assert(!boot.includes('module._compile'));
assert(!boot.includes('source.replace'));
console.log('PASS 179.4 all textual patches/installers are explicit exactly once in preserved order');
console.log('PASS 179.5 direct composition has one startup path and zero loader interception');
