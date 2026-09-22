'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const server=read('server.js');
const boot=read('src/message-actions-bootstrap.js');
const pins=read('src/message-pins-server.js');

assert(server.includes("const { installMessagePinsServer } = require('./src/message-pins-server');"),'explicit I2 import missing');
assert.equal((server.match(/installMessagePinsServer\(\{/g)||[]).length,1,'server must call I2 exactly once');
assert.equal((boot.match(/installMessagePinsServer\(\{/g)||[]).length,0,'bootstrap still injects I2');
assert.equal((server.match(/message-pins-server/g)||[]).length,1,'server has duplicate I2 imports/references');

const call=[
  'installMessagePinsServer({',
  '  app,',
  '  db,',
  '  q,',
  '  socketsByDevice,',
  '  sendWsJson,',
  '  sendToRoomParticipants,',
  '  toIsoUtc,',
  '  isRoomOpen,',
  '  roomStatePayload',
  '});'
].join('\n');
assert(server.includes(call),'I2 dependency list/order changed');

const i1=server.lastIndexOf('installMessageActionsServer({');
const i2=server.lastIndexOf('installMessagePinsServer({');
const cleanup=server.lastIndexOf('\ncleanupExpiredSoloRooms();');
assert(i1>=0&&i2>i1&&cleanup>i2,'explicit order must remain I1 -> I2 -> cleanup/listen');

assert(!/__fp[A-Za-z0-9_]*Installed/.test(pins),'I2 idempotency semantics changed during migration');
assert(pins.includes("if (!app || !db || !q) throw new Error('message pins server dependencies are missing');"),'I2 dependency guard changed');
assert(pins.includes('AFTER UPDATE OF deleted_for_all ON messages'),'I2 deleted_for_all trigger changed');
assert(pins.includes('FROM message_hidden'),'I2 message_hidden dependency changed');

const remaining=[
  'installTypingServer','installUsernameServer','installSystemEventsServer','installStorageStats168',
  'installUserBlocks165Server','installUserBlockEventActions165','installChatRequestsServer','installVoiceServer'
];
let previous=-1;
for(const name of remaining){
  const at=boot.indexOf('.'+name+'({');
  assert(at>previous,'remaining bootstrap installer order changed at '+name);
  previous=at;
}
assert.equal((boot.match(/\.install[A-Za-z0-9_]+\(\{/g)||[]).length,8,'bootstrap must contain exactly eight remaining installers');
assert(remaining[0]==='installTypingServer','I3 must be first remaining bootstrap installer');

for(const label of [
  'database user-block initialization',
  'participant presence response',
  'presence broadcaster',
  'text message block guard',
  'legacy/media message block guard',
  'media upload block guard',
  'invite block guard'
]){assert(boot.includes("'"+label+"'"),'unrelated textual patch lost: '+label);}

console.log('PASS 179.4 I2 message-pins install is explicit exactly once');
console.log('PASS 179.4 explicit order remains I1 -> I2 before startup marker');
console.log('PASS 179.4 old bootstrap I2 insertion is removed while I3-I10 keep relative order');
console.log('PASS 179.4 I2 schema/guard semantics and unrelated T1-T7 patches are unchanged');
