'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const pubDir=path.join(root,'public');
const publicSources=Object.fromEntries(
  fs.readdirSync(pubDir).filter(n=>n.endsWith('.js')).sort().map(n=>[n,read('public/'+n)])
);
const app=publicSources['app.js'];
const runtime=publicSources['runtime169.js'];
const lifecycle=publicSources['lifecycle170.js'];
const room=publicSources['room-context170.js'];
const connection=publicSources['connection170.js'];
const sync=publicSources['sync-coordinator176.js'];
const network=publicSources['network171.js'];
const store=publicSources['message-store172.js'];
const history=publicSources['history174.js'];
const dom=publicSources['dom-lifecycle173.js'];
const layer=publicSources['layer-manager173.js'];
const gesture=publicSources['gesture-manager135.js'];
const viewport=publicSources['viewport-fix.js'];
const viewportLayout=publicSources['viewport-layout136.js'];
const send=publicSources['send-manager177.js'];
const textSend=publicSources['text-send170.js'];
const mediaSend=publicSources['media-send170.js'];
const voice=publicSources['voice.js'];
const index=read('public/index.html');
const server=read('server.js');
const pkg=JSON.parse(read('package.json'));

const count=(source,re)=>(source.match(re)||[]).length;
const occurrences=(source,needle)=>source.split(needle).length-1;
const allPublic=Object.values(publicSources).join('\n');

const pass=(name)=>console.log('PASS architecture '+name);

// 169 — one passive logical observer.
assert(runtime.includes('window.FPRuntime = window.FPRuntime169;'),'FPRuntime alias no longer points to FPRuntime169');
assert.equal(count(runtime,/setInterval\s*\(/g),0,'Runtime observer gained polling control');
assert.equal(count(runtime,/new\s+WebSocket\s*\(/g),0,'Runtime observer gained transport control');
assert(!runtime.includes('window.fetch ='),'Runtime observer gained fetch control');
assert.equal(occurrences(allPublic,'window.FPRuntime = window.FPRuntime169;'),1,'logical RuntimeObserver alias duplicated');
pass('RuntimeObserver = FPRuntime169/FPRuntime and remains passive');

// App/startup coordination remains one readiness graph, not a second app brain.
assert.equal(occurrences(index,'window.FPStartup174=Object.freeze'),1,'FPStartup174 readiness owner duplicated');
assert(app.includes('if(window.FPStartup174?.ready&&!(await FPStartup174.ready))'),'initial app navigation no longer waits for FPStartup174');
for(const forbidden of ['AppCoordinator180','FPAppCoordinator180','app-coordinator180.js']){
  assert(![index,app,room].join('\n').includes(forbidden),'second AppCoordinator introduced: '+forbidden);
}
pass('AppCoordinator role is satisfied by FPStartup174 startup coordination');

// Lifecycle owner.
assert(lifecycle.includes('window.FPLifecycle170 = Object.freeze'),'FPLifecycle170 missing');
for(const token of [
  "document.addEventListener('visibilitychange', onVisibility",
  "window.addEventListener('online', onOnline",
  "window.addEventListener('offline', onOffline",
  "window.addEventListener('pageshow', onPageShow",
  "window.addEventListener('pagehide', onPageHide"
]) assert.equal(occurrences(lifecycle,token),1,'Lifecycle root listener changed: '+token);
assert.equal(count(lifecycle,/setInterval\s*\(/g),0,'Lifecycle owner gained polling');
pass('LifecycleManager = FPLifecycle170');

// Room/session owner.
assert(room.includes('window.FPRoomContext170 = Object.freeze({'),'FPRoomContext170 missing');
for(const method of ['beginTransition','commitTransition','beginOperation','finishOperation','cancelOperation']){
  assert(room.includes(method),'RoomContext method missing: '+method);
}
assert.equal(occurrences(room,'let activeRoomContext = null;'),1,'active room context duplicated');
assert.equal(occurrences(room,'let pendingTransition = null;'),1,'pending room transition duplicated');
pass('RoomSessionManager = FPRoomContext170 + accepted room-open worker');

// Connection owner with one existing transport worker.
assert(connection.includes("role: 'websocket-current-reconnect'"),'FPConnection170 active-owner contract missing');
for(const method of ['ensureConnected','scheduleReconnect','beginReplacement','adoptCurrent','releaseCurrent','closeCurrent']){
  assert(connection.includes(method),'Connection owner method missing: '+method);
}
const wsFiles=[];
for(const [name,source] of Object.entries(publicSources)){
  const n=count(source,/new\s+WebSocket\s*\(/g);
  for(let i=0;i<n;i++)wsFiles.push(name);
}
assert.deepEqual(wsFiles,['app.js'],'client WebSocket construction escaped/duplicated outside the accepted app worker');
assert(app.includes('if(manager?.ensureConnected)return manager.ensureConnected(deviceId,timeoutMs);'),'app connection entry bypasses FPConnection170');
assert.equal(occurrences(connection,'reconnectTimer = setTimeout(() => {'),1,'reconnect timer owner duplicated');
pass('ConnectionManager owns socket slot/reconnect while app.js remains the single transport worker');

// Sync coordinator remains a thin facade to existing workers.
assert(sync.includes('return syncAllRoomsAfterReconnect(deviceId);'),'reconnect sync no longer delegates to existing worker');
assert(sync.includes('return startAppSessionSync();'),'resume sync no longer delegates to existing worker');
assert.equal(count(sync,/setInterval\s*\(|setTimeout\s*\(|\bfetch\s*\(/g),0,'SyncCoordinator gained its own worker/timer/network path');
assert.equal(occurrences(app,'window.FPSyncCoordinator176.syncAfterReconnect(safeDeviceId)'),1,'reconnect coordinator entry changed');
assert.equal(occurrences(app,'window.FPSyncCoordinator176.syncAfterResume()'),1,'resume coordinator entry changed');
pass('SyncCoordinator = FPSyncCoordinator176 thin trigger facade');

// Network / Cache / Resource arbitration.
assert(network.includes("Object.defineProperty(window, 'fetch', {"),'FPNetwork171 no longer owns fetch accessor');
assert(network.includes("Object.defineProperty(xhrProto, 'open', {"),'FPNetwork171 no longer owns XHR open');
assert(network.includes("Object.defineProperty(xhrProto, 'send', {"),'FPNetwork171 no longer owns XHR send');
assert(network.includes("role: 'fetch-xhr-cache-owner'"),'FPNetwork171 owner registration missing');
assert(network.includes('mediaBudget'),'FPNetwork171 media resource budget missing');
assert.equal(count(network,/setInterval\s*\(/g),0,'Network/resource arbiter gained polling');
pass('NetworkManager/CacheManager/ResourceArbiter remain one FPNetwork171 ownership surface');

// MessageStore canonical state.
assert(store.includes('window.FPMessageStore172 = Object.freeze'),'FPMessageStore172 missing');
assert(store.includes('function legacyCacheAdapter(roomResolver)'),'MessageStore compatibility adapter missing');
assert(app.includes("const messageCache=window.FPMessageStore172?.legacyCacheAdapter?.(()=>String(state?.roomId||''))||new Map();"),'app messageCache no longer prefers Store adapter');
assert.equal(count(store,/setInterval\s*\(/g),0,'MessageStore gained polling');
pass('MessageStore = FPMessageStore172 with legacy cache only as adapter/failure fallback');

// History + render + DOM lifecycle.
assert(history.includes('window.FPHistory174=Object.freeze'),'FPHistory174 missing');
assert(history.includes('window.FPMessageStore172?.get'),'History no longer reads canonical Store');
assert(app.includes('window.FPChatList174=Object.freeze'),'FPChatList174 missing');
assert(app.includes('window.FPMessageRender178=FPMessageRender178;'),'FPMessageRender178 missing');
assert(dom.includes('window.FPDOM173 = Object.freeze'),'FPDOM173 missing');
pass('HistoryManager/RenderCoordinator use FPHistory174, FPChatList174, FPMessageRender178 and FPDOM173');

// Read state.
assert(app.includes('const FPReadState178=Object.freeze({admitVisible:admitVisibleMessageRead178,flushPending:flushPendingReadsWorker178});'),'FPReadState178 owner missing');
assert(app.includes('entries.forEach((entry)=>FPReadState178.admitVisible(entry,box));'),'IntersectionObserver bypasses ReadState admission');
assert(app.includes('return window.FPReadState178?.flushPending?.(roomId,deviceId)??flushPendingReadsWorker178(roomId,deviceId);'),'read flush compatibility entry no longer delegates to ReadState');
pass('ReadStateManager = FPReadState178');

// Composer owner delegates UI state to existing voice worker; send is separate.
assert(app.includes('const FPComposer177=Object.freeze({'),'FPComposer177 missing');
for(const token of ['queueDraftInput','syncReplyMode','enterEditMode','exitEditMode','applyRestoredDraft']){
  assert(app.includes(token),'Composer responsibility missing: '+token);
}
assert(app.includes('return window.FPVoice?.syncComposer?.(form);'),'Composer send/mic sync no longer delegates to existing voice worker');
assert(textSend.includes('form.onsubmit = dispatchSubmit;'),'text submit not owned by FPTextSend170 dispatch entry');
pass('ComposerManager = FPComposer177, separate from send execution');

// Send dispatcher is stateless and delegates to existing type executors.
assert(send.includes('window.FPSendManager177 = Object.freeze({ dispatch });'),'FPSendManager177 missing');
for(const forbidden of ['addEventListener(','.onsubmit','setInterval(','setTimeout(','fetch(','XMLHttpRequest','state.ws.send']){
  assert(!send.includes(forbidden),'SendManager became an independent worker: '+forbidden);
}
assert(textSend.includes('const manager = window.FPSendManager177;'),'text executor bypasses SendManager');
assert(mediaSend.includes('const manager = window.FPSendManager177;'),'media executor bypasses SendManager');
assert(voice.includes('const manager = window.FPSendManager177;'),'voice ready-send executor bypasses SendManager');
pass('SendManager = FPSendManager177 dispatcher over existing text/media/voice executors');

// Media lifetime owner; codec/recorder remains existing voice worker.
assert(app.includes('class FPMediaManager177Class'),'FPMediaManager177 missing');
assert(voice.includes('window.FPMediaManager177'),'voice UI no longer delegates media lifetime ownership');
const recorderFiles=Object.entries(publicSources).filter(([,source])=>/new\s+MediaRecorder\s*\(/.test(source)).map(([name])=>name);
assert.deepEqual(recorderFiles,['voice.js'],'MediaRecorder implementation duplicated/moved outside voice.js');
pass('MediaManager = FPMediaManager177 while recording implementation remains voice.js');

// Layer / gesture arbiters.
assert(layer.includes('window.FPLayer173 = Object.freeze'),'FPLayer173 missing');
assert.equal(occurrences(layer,'const claims = new Map();'),1,'layer claim registry duplicated');
assert(gesture.includes('window.FPGesture135 = Object.freeze'),'FPGesture135 missing');
assert(gesture.includes('window.FPLayer173?.currentLayer'),'GestureArbiter no longer consults LayerArbiter');
assert.equal(count(gesture,/setInterval\s*\(/g),0,'Gesture arbiter gained polling');
pass('LayerArbiter/GestureArbiter = FPLayer173/FPGesture135');

// Scroll arbiter.
assert.equal(occurrences(app,'window.FPScroll173=scrollCoordinator;'),1,'FPScroll173 export duplicated');
assert(app.includes("write(box,top,behavior='auto')"),'central message-scroll writer missing');
assert(viewport.includes('if (window.FPScroll173?.requestBottom)'),'Viewport does not prefer central scroll owner');
pass('ScrollArbiter = FPScroll173 with guarded compatibility fallback only');

// Viewport ownership is deliberately split by resource.
assert(viewport.includes('window.FPViewport173 = Object.freeze'),'FPViewport173 geometry owner missing');
assert(viewportLayout.includes('window.FPViewport136 = Object.freeze'),'FPViewport136 keyboard-state owner missing');
for(const variable of ['--fpchat-visible-height','--fpchat-viewport-correction-y']){
  const writers=Object.entries(publicSources).filter(([,source])=>source.includes("setProperty('"+variable+"'")||source.includes("removeProperty('"+variable+"'")).map(([name])=>name);
  assert(writers.length>0,'viewport writer missing: '+variable);
  assert(writers.every(name=>name==='viewport-fix.js'),'viewport numeric property has competing writer: '+variable+' -> '+writers.join(','));
}
pass('ViewportManager keeps geometry in FPViewport173 and keyboard state in FPViewport136');

// Server composition is explicit and singular.
assert.equal(pkg.scripts.start,'node server.js','production server entry is not explicit server.js composition');
for(const name of [
  'installMessageActionsServer','installMessagePinsServer','installTypingServer','installUsernameServer',
  'installSystemEventsServer','installStorageStats168','installUserBlocks165Server',
  'installUserBlockEventActions165','installChatRequestsServer','installVoiceServer'
]){
  assert.equal(count(server,new RegExp('\\b'+name+'\\s*\\(\\{','g')),1,'server installer count changed: '+name);
}
assert.equal(occurrences(server,"const fpUserBlocks165 = require('./src/user-blocks165').createUserBlocks165(db);"),1,'block authority instance duplicated');
assert.equal(occurrences(server,'const fpHistoryRead179 = createHistoryRead179({'),1,'history DB read owner duplicated');
pass('Server composition/history/block authority are explicit and singular');

console.log('PASS architecture final role map: managers, arbiters and observer have concrete ownership evidence');
console.log('PASS architecture no second global manager/arbiter system was introduced merely for naming');
console.log('PASS architecture current code still uses existing workers behind the accepted ownership boundaries');
