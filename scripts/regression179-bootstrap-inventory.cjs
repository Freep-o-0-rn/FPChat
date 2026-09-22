'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const doc=read('docs/Build179_1_Server_Bootstrap_Inventory.md');
const modules={
 actions:read('src/message-actions-server.js'),
 pins:read('src/message-pins-server.js'),
 typing:read('src/typing-server.js'),
 username:read('src/username-server.js'),
 system:read('src/system-events-server.js'),
 storage:read('src/storage-stats168.js'),
 blocks:read('src/user-blocks165.js'),
 blockEvents:read('src/user-block-event-actions165.js'),
 requests:read('src/chat-requests-server147.js'),
 voice:read('src/voice-server.js')
};
for(const token of ['T1','T2a','T2b','T3','T4','T5','T6','T7','T8','I1','I2','I3','I4','I5','I6','I7','I8','I9','I10']){
  assert(doc.includes(token),'historical 179.1 inventory lost '+token);
}
assert(!/__fp[A-Za-z0-9_]*Installed/.test(modules.actions),'message-actions guard semantics changed');
assert(!/__fp[A-Za-z0-9_]*Installed/.test(modules.pins),'message-pins guard semantics changed');
assert(modules.typing.includes('wss.__fpTypingInstalled'),'typing guard missing');
assert(modules.username.includes('app.__fpUsername140Installed'),'username guard missing');
assert(modules.system.includes('app.__fpSystemEvents144Installed'),'system-events guard missing');
assert(modules.storage.includes('app.__fpStorageStats168Installed'),'storage guard missing');
assert(modules.blocks.includes('app.__fpUserBlocks165Installed'),'blocks guard missing');
assert(modules.blockEvents.includes('app.__fpUserBlockEventActions165Installed'),'block-event guard missing');
assert(modules.requests.includes('app.__fpChatRequests147Installed'),'chat-request guard missing');
assert(modules.voice.includes('app.__fpVoiceInstalled'),'voice guard missing');
assert(modules.actions.includes("type: 'message:edited'")&&modules.actions.includes("type: 'message:deleted'"),'message action WS contract signature missing');
assert(modules.pins.includes("type: 'pins:changed'"),'pins WS signature missing');
assert(modules.typing.includes("type: 'typing:update'"),'typing WS signature missing');
assert(modules.blocks.includes("type: 'user-block:changed'"),'block WS signature missing');
console.log('PASS 179.1 historical inventory remains frozen while composition migrates');
