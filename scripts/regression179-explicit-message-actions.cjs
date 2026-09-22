'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const server=read('server.js');
const boot=read('src/message-actions-bootstrap.js');
const actions=read('src/message-actions-server.js');

assert(server.includes("const { installMessageActionsServer } = require('./src/message-actions-server');"),'explicit I1 import missing');
assert.equal((server.match(/installMessageActionsServer\(\{/g)||[]).length,1,'server must call I1 exactly once');
assert.equal((boot.match(/installMessageActionsServer\(\{/g)||[]).length,0,'bootstrap still injects I1');
assert.equal((server.match(/message-actions-server/g)||[]).length,1,'server has duplicate I1 imports/references');

const call=[
  'installMessageActionsServer({',
  '  app,',
  '  db,',
  '  q,',
  '  socketsByDevice,',
  '  sendWsJson,',
  '  sendToRoomParticipants,',
  '  broadcastUnreadState,',
  '  toIsoUtc,',
  '  safeUnlink,',
  '  isRoomOpen,',
  '  roomStatePayload',
  '});'
].join('\n');
assert(server.includes(call),'I1 dependency list/order changed');

const cleanupAt=server.lastIndexOf('\ncleanupExpiredSoloRooms();');
const callAt=server.lastIndexOf('installMessageActionsServer({');
assert(callAt>=0&&callAt<cleanupAt,'explicit I1 must execute before cleanup/listen marker');

assert(server.includes("const { installMessagePinsServer } = require('./src/message-pins-server');"),'I2 explicit import missing after 179.4');
assert.equal((server.match(/installMessagePinsServer\(\{/g)||[]).length,1,'I2 explicit install count changed after 179.4');
assert.equal((boot.match(/installMessagePinsServer\(\{/g)||[]).length,0,'I2 returned to bootstrap after 179.4');

const marker='\ncleanupExpiredSoloRooms();\nsetInterval(cleanupExpiredSoloRooms, 10 * 60 * 1000);\nserver.listen(APP_PORT, APP_HOST';
assert(server.includes(marker),'server startup marker changed');
assert(boot.includes("const marker = '\\ncleanupExpiredSoloRooms();\\nsetInterval(cleanupExpiredSoloRooms, 10 * 60 * 1000);"),'bootstrap insertion marker changed');

assert(!/__fp[A-Za-z0-9_]*Installed/.test(actions),'I1 idempotency semantics changed during explicit migration');
assert(actions.includes("if (!app || !db || !q) throw new Error('message actions server dependencies are missing');"),'I1 dependency guard changed');

for(const label of [
  'database user-block initialization',
  'participant presence response',
  'presence broadcaster',
  'text message block guard',
  'legacy/media message block guard',
  'media upload block guard',
  'invite block guard'
]){assert(boot.includes("'"+label+"'"),'unrelated textual patch lost: '+label);}
assert.equal((boot.match(/fpUserBlocks165\.roomSendGuard/g)||[]).length,3,'unrelated room-send guards changed');
assert(boot.includes('const inviteBlock165 = fpUserBlocks165.inviteGuard(room.id, safeDeviceId);'),'invite guard changed');

const remaining=[
 'installTypingServer','installUsernameServer','installSystemEventsServer','installStorageStats168',
 'installUserBlocks165Server','installUserBlockEventActions165','installChatRequestsServer','installVoiceServer'
];
let previous=-1;
for(const name of remaining){
  const at=boot.indexOf('.'+name+'({');
  assert(at>previous,'remaining installer order changed at '+name);
  previous=at;
}
assert.equal((boot.match(/\.install[A-Za-z0-9_]+\(\{/g)||[]).length,8,'bootstrap must contain exactly eight remaining installers');

console.log('PASS 179.3 I1 message-actions install is explicit exactly once');
console.log('PASS 179.3 old bootstrap I1 insertion is removed in the same state');
console.log('PASS 179.3 explicit I1 remains before explicit I2 and startup cleanup/listen');
console.log('PASS 179.3 I1 dependency guard and unrelated textual guards/installers remain preserved after 179.4');
