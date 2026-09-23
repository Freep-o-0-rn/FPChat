'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const publicDir=path.join(root,'public');
const publicFiles=fs.readdirSync(publicDir).filter(name=>name.endsWith('.js')).sort();
const publicSources=Object.fromEntries(publicFiles.map(name=>[name,read('public/'+name)]));

const app=publicSources['app.js'];
const lifecycle=publicSources['lifecycle170.js'];
const connection=publicSources['connection170.js'];
const sync=publicSources['sync-coordinator176.js'];
const network=publicSources['network171.js'];
const store=publicSources['message-store172.js'];
const layer=publicSources['layer-manager173.js'];
const gesture=publicSources['gesture-manager135.js'];
const viewport=publicSources['viewport-fix.js'];
const keyboard=publicSources['viewport-layout136.js'];
const roomContext=publicSources['room-context170.js'];
const textSend=publicSources['text-send170.js'];
const mediaSend=publicSources['media-send170.js'];
const voice=publicSources['voice.js'];
const actions=publicSources['message-actions.js'];
const index=read('public/index.html');
const server=read('server.js');
const pkg=JSON.parse(read('package.json'));
const blocks=read('src/user-blocks165.js');
const historyOwner=read('src/history-read179.js');
const chatRequestsServer=read('src/chat-requests-server147.js');
const clientBlocks=publicSources['user-blocks165.js'];

const count=(source,re)=>(source.match(re)||[]).length;
const filesMatching=re=>Object.entries(publicSources).filter(([,source])=>re.test(source)).map(([name])=>name);
const occurrences=(source,needle)=>source.split(needle).length-1;

function exactFn(source,name){
  const m=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(source);
  assert(m,'function missing: '+name);
  const brace=source.indexOf('{',m.index);
  let depth=0;
  for(let i=brace;i<source.length;i+=1){
    if(source[i]==='{')depth+=1;
    else if(source[i]==='}'){depth-=1;if(depth===0)return source.slice(m.index,i+1);}
  }
  assert.fail('function end missing: '+name);
}

// RoomContext: one mutable transition authority.
assert.equal(occurrences(roomContext,'let activeRoomContext = null;'),1,'active room context owner duplicated');
assert.equal(occurrences(roomContext,'let pendingTransition = null;'),1,'pending room transition owner duplicated');
assert.equal(occurrences(roomContext,'const operations = new Map();'),1,'room operation registry duplicated');
assert.equal(count(roomContext,/setInterval\s*\(/g),0,'RoomContext gained polling ownership');

// Lifecycle publisher/listeners.
assert.equal(occurrences(lifecycle,"new CustomEvent('fpchat:lifecycle170'"),1,'lifecycle normalized event publisher duplicated');
for(const token of [
  "document.addEventListener('visibilitychange', onVisibility",
  "window.addEventListener('online', onOnline",
  "window.addEventListener('offline', onOffline",
  "window.addEventListener('focus', onFocus",
  "window.addEventListener('blur', onBlur",
  "window.addEventListener('pageshow', onPageShow",
  "window.addEventListener('pagehide', onPageHide"
]) assert.equal(occurrences(lifecycle,token),1,'lifecycle listener missing/duplicated: '+token);
assert.equal(count(lifecycle,/setInterval\s*\(/g),0,'Lifecycle owner gained polling timer');

// WebSocket construction/reconnect ownership.
const wsConstructors=[];
for(const [name,source] of Object.entries(publicSources)){
  const n=count(source,/new\s+WebSocket\s*\(/g);
  for(let i=0;i<n;i++)wsConstructors.push(name);
}
assert.deepEqual(wsConstructors,['app.js'],'client WebSocket construction must have one existing worker in app.js');
assert.equal(count(connection,/new\s+WebSocket\s*\(/g),0,'Connection170 created a second WebSocket');
for(const event of ['open','close','error']){
  assert.equal(occurrences(connection,"socket.addEventListener('"+event+"'"),1,'Connection170 socket listener duplicated: '+event);
}
assert.equal(occurrences(connection,'reconnectTimer = setTimeout(() => {'),1,'Connection170 reconnect timer writer duplicated');

// SyncCoordinator stays a thin trigger facade.
assert.equal(count(sync,/setInterval\s*\(|setTimeout\s*\(/g),0,'SyncCoordinator gained timer ownership');
assert.equal(count(sync,/\bfetch\s*\(/g),0,'SyncCoordinator gained network worker');
assert.equal(occurrences(app,'FPSyncCoordinator176.syncAfterReconnect(safeDeviceId)'),1,'reconnect sync coordinator entry count changed');
assert.equal(occurrences(app,'FPSyncCoordinator176.syncAfterResume()'),1,'resume sync coordinator entry count changed');
assert.equal(occurrences(app,'let stableWsSyncPromise=null;'),1,'existing sync dedupe promise count changed');

// Fetch ownership: physical accessor + known legacy adapters only.
assert.equal(occurrences(network,"Object.defineProperty(window, 'fetch', {"),1,'FPNetwork171 fetch accessor count changed');
const legacyBlock=network.slice(network.indexOf('const LEGACY_SPECS'),network.indexOf('const XHR_LEGACY_SPECS'));
const legacyFiles=[...legacyBlock.matchAll(/'([^']+\.js)'\s*:/g)].map(m=>m[1]).sort();
const fetchAssignmentFiles=Object.entries(publicSources)
  .filter(([,source])=>/window\.fetch\s*=/.test(source))
  .map(([name])=>name)
  .sort();
assert.deepEqual(fetchAssignmentFiles,legacyFiles,'unregistered legacy window.fetch assignment exists');
assert.equal(occurrences(network,"Object.defineProperty(xhrProto, 'open', {"),1,'XHR open owner accessor count changed');
assert.equal(occurrences(network,"Object.defineProperty(xhrProto, 'send', {"),1,'XHR send owner accessor count changed');
const xhrAssignmentFiles=Object.entries(publicSources)
  .filter(([,source])=>/xhrProto\.open\s*=|xhrProto\.send\s*=/.test(source))
  .map(([name])=>name)
  .sort();
assert.deepEqual(xhrAssignmentFiles,['typing.js'],'unexpected direct XHR compatibility assignment exists');

// Managed CacheStorage physical mutation owner.
const cacheNames=new Set();
for(const source of Object.values(publicSources)){
  for(const match of source.matchAll(/fpchat-media-v\d+/g))cacheNames.add(match[0]);
}
assert.deepEqual([...cacheNames].sort(),['fpchat-media-v167'],'managed media cache namespace count changed');
assert.equal(filesMatching(/nativeCachePut\.call\(/).join(','),'network171.js','physical managed cache put escaped FPNetwork171');
assert.equal(filesMatching(/nativeCacheDelete\.call\(/).join(','),'network171.js','physical managed cache delete escaped FPNetwork171');
assert.equal(occurrences(network,'releaseMediaSlot(weight);'),1,'media budget physical release primitive duplicated');
assert.equal(count(network,/setInterval\s*\(/g),0,'network/media budget gained interval polling');

// MessageStore / compatibility adapter.
assert.equal(occurrences(app,"const messageCache=window.FPMessageStore172?.legacyCacheAdapter?.(()=>String(state?.roomId||''))||new Map();"),1,'normal messageCache adapter declaration changed');
assert.equal(occurrences(store,'function legacyCacheAdapter(roomResolver)'),1,'MessageStore compatibility adapter duplicated');
const adapter=exactFn(store,'legacyCacheAdapter');
assert(adapter.includes('markDeleted(roomId, key'),'legacy adapter deletion metadata bypasses Store');
assert(adapter.includes('setPreviewMeta(roomId, key, value);'),'legacy adapter set bypasses Store');
assert(adapter.includes('delete() {\n        // Canonical state is not deleted by compatibility callers.\n        return false;'),'legacy adapter delete became canonical writer');
assert.equal(count(store,/setInterval\s*\(/g),0,'MessageStore gained polling timer');

// Rendering ownership.
assert.equal(count(app,/function appendMessage\s*\(/g),1,'message template function duplicated');
assert(app.includes('FPMessageRender178.mountIncoming(box,roomId,message,text,nearBottom);'),'active incoming path bypasses FPMessageRender178');
assert(app.includes('return window.FPChatList174.render();'),'legacy chat-list entry no longer delegates to FPChatList174');

// Read queue/writer/timer.
assert.equal(occurrences(app,'const pendingReadQueue=new Map();'),1,'pending read queue duplicated');
assert(app.includes('const FPReadState178=Object.freeze({admitVisible:admitVisibleMessageRead178,flushPending:flushPendingReadsWorker178});'),'FPReadState178 flush owner missing');
const readWorker=exactFn(app,'flushPendingReadsWorker178');
assert.equal(occurrences(readWorker,'entry.retryTimer=setTimeout(()=>{'),1,'read retry timer writer duplicated');
const readCompat=exactFn(app,'flushPendingReads');
assert(readCompat.includes('window.FPReadState178?.flushPending?.(roomId,deviceId)'),'legacy read flush is not a facade');

// Composer + submit ownership.
const composerStart=app.indexOf('const boundComposerForms177=new WeakSet();');
const composerEnd=app.indexOf('window.FPComposer177=FPComposer177;',composerStart);
assert(composerStart>=0&&composerEnd>composerStart,'FPComposer177 owner block missing');
const composer=app.slice(composerStart,composerEnd);
assert.equal(count(composer,/input\.addEventListener\('input'/g),1,'normal composer input listener duplicated');
assert.equal(count(composer,/input\.addEventListener\('keydown'/g),1,'normal composer keydown listener duplicated');
assert.equal(count(textSend,/form\.onsubmit\s*=\s*dispatchSubmit;/g),1,'text submit assignment duplicated');
assert(textSend.includes('if (boundForms.get(form) === context && form.onsubmit === dispatchSubmit) return true;'),'text submit repeated-bind guard missing');

// SendManager is arbitration only.
const sendManager=publicSources['send-manager177.js'];
for(const forbidden of ['addEventListener(','.onsubmit','.onclick','setInterval(','setTimeout(','state.ws.send','fetch(','XMLHttpRequest']){
  assert(!sendManager.includes(forbidden),'SendManager took worker/listener/timer ownership: '+forbidden);
}

// MediaManager boundary + MediaRecorder remains voice-owned.
assert.equal(count(app,/class FPMediaManager177Class\s*\{/g),1,'MediaManager class duplicated');
const mediaRecorderFiles=filesMatching(/new\s+MediaRecorder\s*\(/);
assert.deepEqual(mediaRecorderFiles,['voice.js'],'MediaRecorder implementation moved/duplicated outside voice.js');
assert(voice.includes("window.FPDOM173.on('composer', 'mounted', ({ node }) => ensureComposer(node));"),'voice UI normal mount no longer uses FPDOM173');
assert(voice.includes("window.FPDOM173.on('composer', 'unmounted', ({ node }) => unmountComposer(node));"),'voice UI normal unmount no longer uses FPDOM173');
assert.equal(occurrences(voice,'setInterval(() => handleRoomChange173(), 500);'),1,'voice room-change compatibility timer count changed');

// Layer / gesture ownership.
assert.equal(occurrences(layer,'const claims = new Map();'),1,'layer claims map duplicated');
assert.equal(count(layer,/setInterval\s*\(/g),0,'LayerManager gained polling timer');
for(const token of [
  "window.addEventListener('touchstart', touchStart",
  "window.addEventListener('touchmove', touchMove",
  "window.addEventListener('pointerdown', pointerStart",
  "window.addEventListener('pointermove', pointerMove"
]) assert.equal(occurrences(gesture,token),1,'gesture root listener missing/duplicated: '+token);
assert.equal(count(gesture,/setInterval\s*\(/g),0,'gesture arbiter gained polling timer');

// Message scroll: normal writer + explicit failed-owner fallback only.
assert.equal(occurrences(app,'window.FPScroll173=scrollCoordinator;'),1,'FPScroll173 export duplicated');
assert(app.includes("if(behavior==='smooth')box.scrollTo({top:next,behavior:'smooth'});else box.scrollTop=next;"),'FPScroll173 central executor changed');
const removal=exactFn(actions,'keepViewportWhileRemoving');
assert(!/box\.scrollTop\s*=/.test(removal),'message removal reintroduced direct message scroll writer');
assert(viewport.includes('if (window.FPScroll173?.requestBottom) {\n          window.FPScroll173.requestBottom(box);\n          return;'),'viewport does not prefer FPScroll173 before fallback');
assert(viewport.includes("if (typeof scrollCoordinator !== 'undefined' && scrollCoordinator?.requestBottom) {\n          scrollCoordinator.requestBottom(box);\n          return;"),'legacy scroll coordinator fallback guard changed');
assert.equal(occurrences(viewport,'box.scrollTop = box.scrollHeight;'),1,'known failed-owner message-scroll fallback count changed');

// Viewport numeric property writers.
for(const variable of ['--fpchat-visible-height','--fpchat-viewport-correction-y']){
  const writerFiles=Object.entries(publicSources)
    .filter(([,source])=>source.includes("setProperty('"+variable+"'")||source.includes("removeProperty('"+variable+"'"))
    .map(([name])=>name);
  assert(writerFiles.length>0,'viewport property writer missing: '+variable);
  assert(writerFiles.every(name=>name==='viewport-fix.js'),'competing viewport writer found for '+variable+': '+writerFiles.join(','));
}
assert(!keyboard.includes("setProperty('--fpchat-visible-height'"),'keyboard-state owner became viewport numeric writer');
assert(!keyboard.includes("setProperty('--fpchat-viewport-correction-y'"),'keyboard-state owner became viewport correction writer');

// History read owner.
assert.equal(occurrences(server,'const fpHistoryRead179 = createHistoryRead179({'),1,'history read owner instance duplicated');
assert.equal(occurrences(historyOwner,'const readPageTx = db.transaction('),1,'history read transaction owner duplicated');
assert(!/new\s+Database\s*\(/.test(historyOwner),'history owner opened a second SQLite connection');

// Explicit server composition.
assert.equal(pkg.scripts.start,'node server.js','production server entry regained preload/bootstrap owner');
for(const name of [
  'installMessageActionsServer','installMessagePinsServer','installTypingServer','installUsernameServer',
  'installSystemEventsServer','installStorageStats168','installUserBlocks165Server',
  'installUserBlockEventActions165','installChatRequestsServer','installVoiceServer'
]){
  assert.equal(count(server,new RegExp('\\b'+name+'\\s*\\(\\{','g')),1,'server installer call count changed: '+name);
}

// Block authority + timers are separated by responsibility.
assert.equal(occurrences(server,"const fpUserBlocks165 = require('./src/user-blocks165').createUserBlocks165(db);"),1,'canonical block owner instance duplicated');
assert.equal(occurrences(blocks,'const watcher = setInterval(() => {'),1,'server block watcher count changed');
assert(blocks.includes('}, 1000);'),'server block watcher cadence changed');
assert.equal(count(clientBlocks,/setInterval\s*\(/g),2,'client block compatibility/status timer inventory changed');
assert(clientBlocks.includes('}, 700);'),'client block wrapper-install compatibility timer changed');
assert(clientBlocks.includes('}, 10000);'),'client block status refresh timer changed');
assert(server.includes('fpUserBlocks165.roomSendGuard(room.id, ws.deviceId)'),'server text send guard missing');
assert(server.includes('fpUserBlocks165.inviteGuard(room.id, safeDeviceId)'),'server invite guard missing');

// Accepted worker/safety timers remain outside thin coordinators.
assert.equal(occurrences(actions,'syncTimer = setInterval(() => {'),1,'message-actions reconciliation watchdog count changed');
assert(actions.includes('}, 30000);'),'message-actions watchdog cadence changed');
assert.equal(occurrences(chatRequestsServer,'const timer = setInterval(reconcile, 30000);'),1,'chat-request server reconciliation timer count changed');

// Startup readiness uniqueness.
assert.equal(occurrences(index,'window.FPStartup174=Object.freeze'),1,'FPStartup174 owner duplicated');
assert.equal(occurrences(index,"window.addEventListener('fpchat:send-owners-ready174'"),1,'startup final readiness listener duplicated');
assert.equal(occurrences(roomContext,"window.addEventListener('fpchat:room-lifecycle-ready174',loadLifecycleOwner,{once:true})"),1,'room-lifecycle init listener duplicated');
assert.equal(occurrences(mediaSend,"window.dispatchEvent(new Event('fpchat:send-owners-ready174'))"),1,'send-owner ready publisher duplicated');
const combined=[index,app,roomContext,textSend,mediaSend].join('\n');
for(const forbidden of ['AppCoordinator180','FPAppCoordinator180','app-coordinator180.js']){
  assert(!combined.includes(forbidden),'second startup coordinator found: '+forbidden);
}

console.log('PASS 180.11 RoomContext/lifecycle/WS/sync owners have one writer/listener/timer boundary');
console.log('PASS 180.11 fetch/XHR/cache/media-budget physical mutation ownership is singular');
console.log('PASS 180.11 MessageStore/render/read/composer/send ownership is singular');
console.log('PASS 180.11 media UI, layer, gesture, scroll and viewport ownership is singular with documented guarded fallbacks');
console.log('PASS 180.11 history/server composition/block authority have one canonical writer path');
console.log('PASS 180.11 accepted safety/compatibility timers remain visible and separated from authority');
console.log('PASS 180.11 startup readiness still has one coordination boundary and no second coordinator');
