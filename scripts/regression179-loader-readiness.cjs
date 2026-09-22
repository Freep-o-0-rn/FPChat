'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const pkg=JSON.parse(read('package.json'));
const boot=read('src/message-actions-bootstrap.js');

const remainingInstallers=[...boot.matchAll(/require\('([^']+)'\)\.(install[A-Za-z0-9_]+)\(\{/g)].map(m=>m[2]);
const knownPatchLabels=[
 'database user-block initialization',
 'participant presence response',
 'presence broadcaster',
 'text message block guard',
 'legacy/media message block guard',
 'media upload block guard',
 'invite block guard'
];
const remainingPatches=knownPatchLabels.filter(label=>boot.includes("'"+label+"'"));
const ready=remainingInstallers.length===0&&remainingPatches.length===0;

if(!ready){
  assert.equal(pkg.scripts.start,'node -r ./src/message-actions-bootstrap.js server.js','preload removed while bootstrap work remains');
  assert(boot.includes("Module._extensions['.js']"),'loader interception removed while bootstrap work remains');
  assert(boot.includes('module._compile(source, filename);'),'patched compile removed while bootstrap work remains');
}
console.log('179 loader readiness: '+(ready?'READY':'BLOCKED'));
console.log('remaining installers: '+(remainingInstallers.join(', ')||'none'));
console.log('remaining textual patches: '+(remainingPatches.join(', ')||'none'));
