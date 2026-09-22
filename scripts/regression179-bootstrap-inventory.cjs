'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');

const pkg=JSON.parse(read('package.json'));
const boot=read('src/message-actions-bootstrap.js');
const server=read('server.js');
const actions=read('src/message-actions-server.js');
const pins=read('src/message-pins-server.js');
const typing=read('src/typing-server.js');
const username=read('src/username-server.js');
const system=read('src/system-events-server.js');
const storage=read('src/storage-stats168.js');
const blocks=read('src/user-blocks165.js');
const blockEvents=read('src/user-block-event-actions165.js');
const requests=read('src/chat-requests-server147.js');
const voice=read('src/voice-server.js');

assert.equal(pkg.scripts.start,'node -r ./src/message-actions-bootstrap.js server.js','production entry no longer preloads bootstrap');
assert(boot.includes("const originalJsLoader = Module._extensions['.js'];"),'original loader capture missing');
assert(boot.includes("if (path.resolve(filename) !== target) return originalJsLoader(module, filename);"),'target-only interception changed');
assert(boot.includes("Module._extensions['.js'] = originalJsLoader;"),'loader is not restored before compile');
assert(boot.includes('module._compile(source, filename);'),'patched source compile missing');

const patchLabels=[
  'database user-block initialization',
  'participant presence response',
  'presence broadcaster',
  'text message block guard',
  'legacy/media message block guard',
  'media upload block guard',
  'invite block guard'
];
let last=-1;
for(const label of patchLabels){
  const at=boot.indexOf("'"+label+"'");
  assert(at>last,'textual patch order changed at '+label);
  last=at;
}
assert(boot.includes('replaceAllChecked(\n    participantMap,'),'participant patch is no longer checked as a group');
assert(boot.includes("    2,\n    'participant presence response'"),'participant presence patch count is no longer exactly two');
assert.equal((server.match(/const participants = q\.listParticipantsByRoom\.all\(room\.id\)\.map\(\(item\) => \(\{/g)||[]).length,2,'base participant presence markers changed');
assert(boot.includes("const marker = '\\ncleanupExpiredSoloRooms();\\nsetInterval(cleanupExpiredSoloRooms, 10 * 60 * 1000);"),'startup marker changed');

const installs=[
  'installMessageActionsServer',
  'installMessagePinsServer',
  'installTypingServer',
  'installUsernameServer',
  'installSystemEventsServer',
  'installStorageStats168',
  'installUserBlocks165Server',
  'installUserBlockEventActions165',
  'installChatRequestsServer',
  'installVoiceServer'
];
last=-1;
for(const name of installs){
  const at=boot.indexOf('.'+name+'({');
  assert(at>last,'installer order changed at '+name);
  last=at;
}
assert(boot.includes('source = source.replace(marker,'),'installer block insertion missing');

assert(boot.includes("const fpUserBlocks165 = require('./src/user-blocks165').createUserBlocks165(db);"),'shared user-block store initialization missing');
assert(boot.includes("const fpBlockedInviteEvents165 = require('./src/blocked-invite-events165').createBlockedInviteEventStore(db);"),'blocked invite event store initialization missing');
assert(boot.includes('fpUserBlocks165.participantPresenceDto(item, safeDeviceId, toIsoUtc)'),'presence DTO privacy dependency missing');
assert(boot.includes('fpUserBlocks165.canViewerSeePresence(participant.device_id, payload.deviceId)'),'presence broadcaster privacy guard missing');
assert.equal((boot.match(/fpUserBlocks165\.roomSendGuard/g)||[]).length,3,'text/media/upload block guards changed');
assert(boot.includes('const inviteBlock165 = fpUserBlocks165.inviteGuard(room.id, safeDeviceId);'),'invite block guard missing');
assert(boot.includes('fpBlockedInviteEvents165.note({ roomId: room.id, joinerId: safeDeviceId, fallbackName: safeName });'),'blocked invite event side effect missing');

assert(!/__fp[A-Za-z0-9_]*Installed/.test(actions),'message-actions unexpectedly gained installer-local guard');
assert(!/__fp[A-Za-z0-9_]*Installed/.test(pins),'message-pins unexpectedly gained installer-local guard');
assert(typing.includes('if (wss.__fpTypingInstalled) return;'),'typing install guard changed');
assert(username.includes('if (app.__fpUsername140Installed) return;'),'username install guard changed');
assert(system.includes('if (app.__fpSystemEvents144Installed) return;'),'system-events install guard changed');
assert(storage.includes('if (app.__fpStorageStats168Installed) return;'),'storage install guard changed');
assert(blocks.includes('if (app.__fpUserBlocks165Installed) return;'),'user-blocks install guard changed');
assert(blockEvents.includes('if (app.__fpUserBlockEventActions165Installed) return;'),'user-block-event-actions install guard changed');
assert(requests.includes('if (app.__fpChatRequests147Installed) return;'),'chat-requests install guard changed');
assert(voice.includes('if (app.__fpVoiceInstalled) return;'),'voice install guard changed');

function routes(source){
  return source.split('\n').filter(line=>/^\s*app\.(?:get|post|put|patch|delete)\(/.test(line)).map(line=>line.trim());
}
assert.equal(routes(actions).length,5,'message-actions route count changed');
assert.equal(routes(pins).length,4,'message-pins route count changed');
assert.equal(routes(username).length,8,'username route count changed');
assert.equal(routes(system).length,3,'system-event route count changed');
assert.equal(routes(storage).length,1,'storage route count changed');
assert.equal(routes(blocks).length,4,'user-block route count changed');
assert.equal(routes(blockEvents).length,1,'user-block pair route count changed');
assert.equal(routes(requests).length,8,'chat-request route registration count changed');
assert.equal(routes(voice).length,2,'voice route count changed');

assert(actions.includes("type: 'message:edited'"),'message edit WS effect missing');
assert(actions.includes("type: 'message:deleted'"),'message delete WS effect missing');
assert(pins.includes("type: 'pins:changed'"),'pins WS effect missing');
assert(typing.includes("wss.on('connection', (ws) => {"),'typing connection listener missing');
assert(typing.includes("type: 'typing:update'"),'typing WS effect missing');
assert(blocks.includes("type: 'user-block:changed'"),'user-block WS effect missing');
for(const [name,source] of [['username',username],['system-events',system],['storage',storage],['user-block-event-actions',blockEvents],['chat-requests',requests],['voice',voice]]){
  assert(!source.includes("wss.on('connection'"),name+' unexpectedly gained a WS connection listener');
}

assert(actions.includes('CREATE TABLE IF NOT EXISTS message_hidden'),'message-actions schema dependency changed');
assert(pins.includes('FROM message_hidden'),'pins no longer depends on message-hidden semantics');
assert(typing.includes('userBlocks && !userBlocks.roomSendGuard(room.id, ws.deviceId).ok'),'typing block guard changed');
assert(blockEvents.includes('userBlocks.relationship(viewer, target).blockedByMe'),'pair-status no longer uses shared block store');
assert(requests.includes("for (const action of ['reject', 'block'])"),'chat request reject/block route pair changed');
assert(voice.includes('const blockGuard = userBlocks?.roomSendGuard(room.id, deviceId);'),'voice upload block guard changed');

console.log('PASS 179.1 production preload/loader interception and patch order are inventoried');
console.log('PASS 179.1 ten installers remain in recorded order before cleanup/listen');
console.log('PASS 179.1 dependency, guard, route and WS-effect signatures match inventory');
console.log('PASS 179.1 message-actions and pins still have no installer-local idempotency flag');
