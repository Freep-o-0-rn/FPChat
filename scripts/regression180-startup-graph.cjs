'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\\r\\n/g,'\\n');

const index=read('public/index.html');
const app=read('public/app.js');
const server=read('server.js');
const roomContext=read('public/room-context170.js');
const textSend=read('public/text-send170.js');
const mediaSend=read('public/media-send170.js');

for(const token of [
  "window.FPStartup174=Object.freeze",
  "window.addEventListener('fpchat:send-owners-ready174'",
  "'app.js':['room-context170.js','lifecycle170.js','network171.js','message-store172.js','dom-lifecycle173.js','layer-manager173.js','work174.js','history174.js']",
  "'sync-coordinator176.js':['app.js','connection170.js']",
  "'room-open170.js':['room-lifecycle.js','room-context170.js','lifecycle170.js','connection170.js','sync-coordinator176.js']",
  "'send-manager177.js':['room-open170.js']",
  "'text-send170.js':['send-manager177.js']",
  "'media-send170.js':['text-send170.js']"
]) assert(index.includes(token),'FPStartup174 dependency/readiness contract changed: '+token);

const preloadStart=index.indexOf("const preload174 = [");
assert(preloadStart>=0,'preload174 list missing');
const preloadEnd=index.indexOf('];',preloadStart);
assert(preloadEnd>preloadStart,'preload174 list is not closed');
const preloadSource=index.slice(preloadStart,preloadEnd+2);
const preloaded=[...preloadSource.matchAll(/'([^']+)'/g)].map(match=>match[1]);
assert.deepEqual(preloaded,[
  'room-context170.js',
  'lifecycle170.js',
  'network171.js',
  'message-store172.js',
  'dom-lifecycle173.js',
  'layer-manager173.js',
  'work174.js',
  'history174.js',
  'app.js',
  'settings-fix.js',
  'room-lifecycle.js'
],'180.8 early preload order changed');

for(const late of [
  'connection170.js',
  'sync-coordinator176.js',
  'room-open170.js',
  'send-manager177.js',
  'text-send170.js',
  'media-send170.js'
]) assert(!preloaded.includes(late),'late owner was promoted into early preload: '+late);

for(const token of [
  'connection170.js',
  'sync-coordinator176.js',
  'room-open170.js',
  'send-manager177.js',
  'text-send170.js',
  "window.addEventListener('fpchat:room-lifecycle-ready174',loadLifecycleOwner,{once:true})"
]) assert(roomContext.includes(token),'room-context startup chain changed: '+token);

for(const [from,to] of [
  ['loadLifecycleOwner','loadConnectionOwner'],
  ['loadConnectionOwner','loadSyncCoordinator176'],
  ['loadSyncCoordinator176','loadRoomOpenOwner'],
  ['loadRoomOpenOwner','loadSendManager177'],
  ['loadSendManager177','loadTextSendOwner']
]){
  const functionStart=roomContext.indexOf('function '+from+'(');
  assert(functionStart>=0,'startup loader missing: '+from);
  const nextFunction=roomContext.indexOf('\\n  function ',functionStart+1);
  const body=roomContext.slice(functionStart,nextFunction>=0?nextFunction:roomContext.length);
  assert(body.includes(to),'startup transition changed: '+from+' -> '+to);
}

assert(textSend.includes('media-send170.js'),'text owner no longer loads media owner through accepted chain');
assert(mediaSend.includes("window.dispatchEvent(new Event('fpchat:send-owners-ready174'))"),'media owner no longer releases FPStartup174 readiness');

for(const token of [
  "app.get('/i/:publicId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));",
  "app.get('/chat/:publicId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));"
]) assert(server.includes(token),'direct-entry server route changed: '+token);

for(const token of [
  "function parseInvite(){const m=location.pathname.match(/^\\/i\\/([A-Z0-9]{16,64})$/i);if(!m)return null; if(location.hash){return {error:'legacy'};} return {inviteCode:m[1]};}",
  "function parseChat(){const m=location.pathname.match(/^\\/chat\\/([A-Z0-9]{16})$/); return m?m[1]:null;}"
]) assert(app.includes(token),'direct-entry client parser changed: '+token);

const awaitReady=app.indexOf('if(window.FPStartup174?.ready&&!(await FPStartup174.ready))');
const serviceWorker=app.indexOf('await registerServiceWorker();');
const parseInvite=app.indexOf('const inv=parseInvite();');
const parseChat=app.indexOf('const chat=parseChat();');
const joinInvite=app.indexOf('await joinByInviteText(',parseInvite);
const openDirectChat=app.indexOf('await openChat(chat);',parseChat);

assert(awaitReady>=0,'app no longer awaits FPStartup174.ready');
assert(serviceWorker>awaitReady,'service-worker/update entry moved before owner readiness');
assert(parseInvite>awaitReady,'direct /i parsing moved before owner readiness');
assert(parseChat>awaitReady,'direct /chat parsing moved before owner readiness');
assert(parseInvite<parseChat,'direct entry parse order changed');
assert(joinInvite>parseInvite,'direct /i no longer enters through existing joinByInviteText worker');
assert(openDirectChat>parseChat,'direct /chat no longer enters through existing openChat worker');

for(const token of [
  'window.FPMediaManager177 = FPMediaManager177;',
  'window.FPComposer177=FPComposer177;',
  'window.FPScroll173=scrollCoordinator;'
]) {
  const pos=app.indexOf(token);
  assert(pos>=0,'accepted in-app owner missing: '+token);
  assert(pos<awaitReady,'accepted in-app owner is now installed after startup readiness wait: '+token);
}

const combined=[index,app,server,roomContext,textSend,mediaSend].join('\\n');
assert(!combined.includes('AppCoordinator180'),'180.8 must not introduce a second startup coordinator');

console.log('PASS 180.8 early preload order is unchanged and late owners remain late');
console.log('PASS 180.8 room lifecycle -> connection -> sync -> room-open -> send chain remains ordered');
console.log('PASS 180.8 direct /i and /chat server/client entry contracts remain unchanged');
console.log('PASS 180.8 direct /i and /chat processing still occurs after FPStartup174 readiness');
console.log('PASS 180.8 no AppCoordinator180 was introduced without a demonstrated need');
