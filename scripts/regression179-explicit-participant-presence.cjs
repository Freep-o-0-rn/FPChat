'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const server=read('server.js'),boot=read('src/message-actions-bootstrap.js');
assert.equal((server.match(/fpUserBlocks165\.participantPresenceDto\(item, safeDeviceId, toIsoUtc\)/g)||[]).length,2);
assert(!boot.includes("'participant presence response'"));
console.log('PASS 179.4 T2 explicit participant presence');
