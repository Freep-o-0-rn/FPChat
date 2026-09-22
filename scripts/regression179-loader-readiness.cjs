'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');

const pkg=JSON.parse(read('package.json'));
const boot=read('src/message-actions-bootstrap.js');
const server=read('server.js');

const remainingInstallers=[...boot.matchAll(/require\('([^']+)'\)\.(install[A-Za-z0-9_]+)\(\{/g)].map(m=>m[2]);
const patchLabels=[
  'database user-block initialization',
  'participant presence response',
  'presence broadcaster',
  'text message block guard',
  'legacy/media message block guard',
  'media upload block guard',
  'invite block guard'
].filter(label=>boot.includes("'"+label+"'"));

assert.deepEqual(remainingInstallers,[
  'installTypingServer',
  'installUsernameServer',
  'installSystemEventsServer',
  'installStorageStats168',
  'installUserBlocks165Server',
  'installUserBlockEventActions165',
  'installChatRequestsServer',
  'installVoiceServer'
],'179.5 readiness changed: unexpected remaining installer set/order');
assert.equal(patchLabels.length,7,'179.5 readiness changed: unexpected remaining textual patch set');

const ready=remainingInstallers.length===0&&patchLabels.length===0;
assert.equal(ready,false,'179.5 readiness unexpectedly became true without updating this acceptance gate');

assert.equal(pkg.scripts.start,'node -r ./src/message-actions-bootstrap.js server.js','production preload must remain until readiness becomes true');
assert(boot.includes("Module._extensions['.js']"),'loader interception was removed before last dependency');
assert(boot.includes('module._compile(source, filename);'),'patched server compile path was removed before last dependency');

assert.equal((server.match(/installMessageActionsServer\(\{/g)||[]).length,1,'explicit I1 count changed');
assert.equal((server.match(/installMessagePinsServer\(\{/g)||[]).length,1,'explicit I2 count changed');
assert.equal((boot.match(/installMessageActionsServer\(\{/g)||[]).length,0,'I1 returned to bootstrap');
assert.equal((boot.match(/installMessagePinsServer\(\{/g)||[]).length,0,'I2 returned to bootstrap');

console.log('PASS 179.5 readiness gate: loader removal is correctly blocked');
console.log('REMAINING installers: '+remainingInstallers.join(', '));
console.log('REMAINING textual patches: '+patchLabels.join(', '));
console.log('NOTE finish 179.4 item-by-item before deleting loader interception or changing production entry');
