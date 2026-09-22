'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./browser-harness174.cjs');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const manager=read('public/send-manager177.js');
const context=read('public/room-context170.js');
const index=read('public/index.html');
const textSend=read('public/text-send170.js');
const mediaSend=read('public/media-send170.js');
const voice=read('public/voice.js');

assert(manager.includes('function dispatch(executor)'), 'dispatcher entry missing');
assert(manager.includes("if (typeof executor !== 'function') return false;"), 'invalid executor refusal changed');
assert(manager.includes('return executor();'), 'dispatcher must call only the provided executor');
for(const forbidden of [
  'addEventListener(', '.onsubmit', '.onclick', 'new Map(', 'new Set(', 'new WeakMap(', 'new WeakSet(',
  'pendingTextSends', 'clientMessageId', 'uploadId', 'beginOperation(', 'queuePendingTextSend(',
  'ensureWsConnected(', 'state.ws.send', 'fetch(', 'XMLHttpRequest', 'startLocalActivity(', 'stopLocalActivity('
]){
  assert(!manager.includes(forbidden),'dispatcher took forbidden ownership: '+forbidden);
}
const dispatchStart=manager.indexOf('  function dispatch(executor) {');
const dispatchEnd=manager.indexOf('\n  }',dispatchStart);
assert(dispatchStart>=0&&dispatchEnd>dispatchStart,'dispatcher implementation missing');
const dispatchBlock=manager.slice(dispatchStart,dispatchEnd);
assert(!/retry|fallback/i.test(dispatchBlock),
  'dispatcher implementation must not contain retry/fallback logic');

const managerLoaderStart=context.indexOf('  function loadSendManager177() {');
const managerLoaderEnd=context.indexOf('\n  function loadSyncCoordinator176()',managerLoaderStart);
assert(managerLoaderStart>=0&&managerLoaderEnd>managerLoaderStart,'SendManager startup loader missing');
const managerLoader=context.slice(managerLoaderStart,managerLoaderEnd);
assert(managerLoader.includes("script.src = `/send-manager177.js${suffix}`;"),'SendManager script source missing');
assert(managerLoader.includes("existing.addEventListener('load', loadTextSendOwner, { once: true });"),
  'existing SendManager script must continue to text owner');
assert(managerLoader.includes('script.onload = loadTextSendOwner;'),
  'new SendManager script must continue to text owner');

const roomLoaderStart=context.indexOf('  function loadRoomOpenOwner() {');
const roomLoaderEnd=context.indexOf('\n  function loadConnectionOwner()',roomLoaderStart);
assert(roomLoaderStart>=0&&roomLoaderEnd>roomLoaderStart,'room-open startup loader missing');
const roomLoader=context.slice(roomLoaderStart,roomLoaderEnd);
assert(roomLoader.includes('loadSendManager177();'),'already-loaded room-open must continue to SendManager');
assert(roomLoader.includes("existing.addEventListener('load', loadSendManager177, { once: true });"),
  'existing room-open script must continue to SendManager');
assert(roomLoader.includes('script.onload = loadSendManager177;'),
  'new room-open script must continue to SendManager');

assert(index.includes("'send-manager177.js':['room-open170.js']"),'startup dependency for SendManager missing');
assert(index.includes("'text-send170.js':['send-manager177.js']"),'text owner dependency on SendManager missing');

assert(textSend.includes("return manager.dispatch(() => submit(event));"),
  '177.18 text entry must use the existing dispatcher');
assert(mediaSend.includes("return manager.dispatch(() => executeMediaFromPreview170(root));"),
  '177.19 media entry must use the existing dispatcher');
assert(voice.includes("return manager.dispatch(() => uploadAndSendVoice(data));"),
  '177.20 ready voice command must use the existing dispatcher');

console.log('PASS FPSendManager177 is a stateless one-executor dispatcher');
console.log('PASS dispatcher owns no listener, queue, pending store, retry, transport, operation or activity');
console.log('PASS dispatcher loads before send owners; text, media and ready-voice entries are transferred');

run(async({browser,origin,errors})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(7000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(()=>window.FPSendManager177?.dispatch&&window.FPTextSend170&&!document.getElementById('bootHold152'));

  const result=await page.evaluate(async()=>{
    let calls=0;
    const falseValue=window.FPSendManager177.dispatch(()=>{calls+=1;return false;});
    const afterFalse=calls;

    let thrown='',throwCalls=0;
    try{
      window.FPSendManager177.dispatch(()=>{throwCalls+=1;throw new Error('executor-refused');});
    }catch(error){thrown=error.message;}

    let rejectCalls=0,rejected='';
    try{
      await window.FPSendManager177.dispatch(async()=>{rejectCalls+=1;throw new Error('executor-rejected');});
    }catch(error){rejected=error.message;}

    let valueCalls=0;
    const exactObject={accepted:true,token:'177.17'};
    const returned=window.FPSendManager177.dispatch(()=>{valueCalls+=1;return exactObject;});

    return {
      falseValue,
      afterFalse,
      throwCalls,
      thrown,
      rejectCalls,
      rejected,
      valueCalls,
      sameObject:returned===exactObject,
      managerKeys:Object.keys(window.FPSendManager177).sort(),
      formOwner:Boolean(window.FPTextSend170)
    };
  });

  assert.deepEqual(result,{
    falseValue:false,
    afterFalse:1,
    throwCalls:1,
    thrown:'executor-refused',
    rejectCalls:1,
    rejected:'executor-rejected',
    valueCalls:1,
    sameObject:true,
    managerKeys:['dispatch'],
    formOwner:true
  });

  assert.deepEqual(errors,[]);
  console.log('PASS executor false refusal is returned after exactly one call');
  console.log('PASS thrown/rejected executor failure propagates after exactly one call');
  console.log('PASS successful executor result is returned unchanged');
  console.log('PASS no second executor or fallback path exists');
  console.log('PASS no uncaught browser errors');
}).catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
