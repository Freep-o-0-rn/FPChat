'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');

const index=read('public/index.html');
const app=read('public/app.js');
const roomContext=read('public/room-context170.js');
const boot=read('public/boot-ready152.js');

const combined=[index,app,roomContext,boot].join('\n');

for(const forbidden of [
  'AppCoordinator180',
  'FPAppCoordinator180',
  'app-coordinator180.js',
  'fpchat:app-coordinator'
]) {
  assert(!combined.includes(forbidden),'180.9 introduced a second startup coordinator: '+forbidden);
}

for(const token of [
  "window.addEventListener('fpchat:room-lifecycle-ready174',loadLifecycleOwner,{once:true})",
  'function loadLifecycleOwner()',
  'loadConnectionOwner',
  'loadSyncCoordinator176',
  'loadRoomOpenOwner',
  'loadSendManager177',
  'loadTextSendOwner'
]) {
  assert(roomContext.includes(token),'existing late-owner readiness chain changed/missing: '+token);
}

const awaitReady=app.indexOf('if(window.FPStartup174?.ready&&!(await FPStartup174.ready))');
const parseInvite=app.indexOf('const inv=parseInvite();');
const parseChat=app.indexOf('const chat=parseChat();');
assert(awaitReady>=0,'FPStartup174.ready navigation gate missing');
assert(parseInvite>awaitReady,'direct /i processing moved before existing readiness gate');
assert(parseChat>awaitReady,'direct /chat processing moved before existing readiness gate');

for(const token of [
  'window.FPBoot152 = Object.freeze({',
  'const coreCompleted = await waitFor(coreReady, 9000);',
  'await waitFor(layersReady, 7000);',
  'await waitForResourceQuiet();',
  "window.dispatchEvent(new CustomEvent('fpchat:boot-ready'"
]) {
  assert((index+'\n'+boot).includes(token),'existing boot compatibility contract changed/missing: '+token);
}

assert(!index.includes('setInterval('),'180.9 must not add startup interval polling to index loader');
assert(!roomContext.includes('setInterval('),'180.9 must not add lifecycle/readiness polling to room-context owner chain');

console.log('PASS 180.9 no AppCoordinator was introduced because 180.8 found no missing boundary');
console.log('PASS 180.9 existing room-lifecycle -> late-owner readiness transition remains intact');
console.log('PASS 180.9 FPStartup174.ready remains the single initial navigation gate');
console.log('PASS 180.9 existing boot readiness/safety behavior remains intact');
console.log('PASS 180.9 no new loader queue or interval polling was introduced');
