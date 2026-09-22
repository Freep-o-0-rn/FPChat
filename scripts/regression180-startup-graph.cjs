'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');

const index=read('public/index.html');
const app=read('public/app.js');
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

for(const token of [
  'connection170.js',
  'sync-coordinator176.js',
  'room-open170.js',
  'send-manager177.js',
  'text-send170.js',
  "window.addEventListener('fpchat:room-lifecycle-ready174',loadLifecycleOwner,{once:true})"
]) assert(roomContext.includes(token),'room-context startup chain changed: '+token);

assert(textSend.includes('media-send170.js'),'text owner no longer loads media owner through accepted chain');
assert(mediaSend.includes("window.dispatchEvent(new Event('fpchat:send-owners-ready174'))"),'media owner no longer releases FPStartup174 readiness');

const awaitReady=app.indexOf('if(window.FPStartup174?.ready&&!(await FPStartup174.ready))');
const serviceWorker=app.indexOf('await registerServiceWorker();');
const parseInvite=app.indexOf('const inv=parseInvite();');
assert(awaitReady>=0,'app no longer awaits FPStartup174.ready');
assert(serviceWorker>awaitReady,'service-worker/update entry moved before owner readiness');
assert(parseInvite>awaitReady,'initial navigation moved before owner readiness');

for(const token of [
  'window.FPMediaManager177 = FPMediaManager177;',
  'window.FPComposer177=FPComposer177;',
  'window.FPScroll173=scrollCoordinator;'
]) {
  const pos=app.indexOf(token);
  assert(pos>=0,'accepted in-app owner missing: '+token);
  assert(pos<awaitReady,'accepted in-app owner is now installed after startup readiness wait: '+token);
}

const combined=[index,app,roomContext,textSend,mediaSend].join('\n');
assert(!combined.includes('AppCoordinator180'),'180.8 must not introduce a second startup coordinator');

console.log('PASS 180.8 FPStartup174 keeps the accepted dependency/readiness graph explicit');
console.log('PASS 180.8 room lifecycle -> connection -> sync -> room-open -> send chain remains ordered');
console.log('PASS 180.8 app navigation still waits for send-owner readiness');
console.log('PASS 180.8 no AppCoordinator180 was introduced without a demonstrated need');
