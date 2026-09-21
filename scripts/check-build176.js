'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const failures = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) failures.push(message); };
const parse = (relative) => {
  const source = read(relative);
  try { new Function(source); }
  catch (error) { failures.push(`${relative}: syntax error: ${error.message}`); }
  return source;
};

const files = [
  'public/app.js',
  'public/chat-request-cooldown160.js',
  'public/lifecycle170.js',
  'public/room-context170.js',
  'public/voice.js',
  'public/connection170.js',
  'public/sync-coordinator176.js'
];
const source = Object.fromEntries(files.map((file) => [file, parse(file)]));
const index = read('public/index.html');
const version = JSON.parse(read('public/version.json'));

assert(Number(version.build) >= 176, 'version.json must report Build 176 or later');

const lifecycle = source['public/lifecycle170.js'];
const cooldown = source['public/chat-request-cooldown160.js'];
assert(lifecycle.includes("emit(next === 'visible' ? 'foreground' : 'background')"), 'Lifecycle owner must normalize visibility');
assert(lifecycle.includes("emit('online')") && lifecycle.includes("emit('offline')"), 'Lifecycle owner must normalize network state');
assert(lifecycle.includes("emit('pageshow'") && lifecycle.includes("emit('pagehide'"), 'Lifecycle owner must preserve page lifecycle');
assert(lifecycle.includes('function destroy()'), 'Lifecycle owner must expose cleanup');
assert(cooldown.includes('window.FPLifecycle170?.subscribe'), 'Request cooldown must consume LifecycleManager');
assert(cooldown.includes("event.lastType === 'foreground'"), 'Request cooldown must preserve foreground semantics');
assert(cooldown.includes('Compatibility fallback only when the centralized lifecycle owner failed to load.'), 'Lifecycle fallback boundary missing');

const room = source['public/room-context170.js'];
const voice = source['public/voice.js'];
const app = source['public/app.js'];
assert(room.includes('function beginTransition(') && room.includes('function commitTransition('), 'Room transition owner missing');
assert(room.includes('function beginOperation(') && room.includes('function finishOperation(') && room.includes('function cancelOperation('), 'Room operation lifetime missing');
assert(app.includes('unreadVisibleObserver.disconnect();unreadVisibleObserver=null;'), 'Room exit must release unread observer');
assert(voice.includes("beginOperation?.(data.roomId, 'voice-send')"), 'Voice send must use room operation lifetime');
assert(voice.includes('signal: operation?.signal'), 'Voice upload must be cancellable by its operation signal');

const connection = source['public/connection170.js'];
assert(!connection.includes('new WebSocket('), 'ConnectionManager must not create a second WebSocket worker');
assert((app.match(/new WebSocket\s*\(/g) || []).length === 1, 'There must be one existing WebSocket construction path');
for (const legacy of ['stableWsSequence', 'stableWsManualClose', 'stableWsReconnectTimer', 'stableWsReconnectAttempt']) {
  assert(!app.includes(legacy), `Legacy connection owner state remains in app.js: ${legacy}`);
}
for (const api of ['ensureConnected','scheduleReconnect','clearReconnect','beginReplacement','adoptCurrent','releaseCurrent','closeCurrent']) {
  assert(connection.includes(api), `ConnectionManager API missing: ${api}`);
}
assert(connection.includes('let socketGeneration = 0;'), 'ConnectionManager socket generation missing');
assert(connection.includes('let manualClose = false;'), 'ConnectionManager manual-close state missing');

const sync = source['public/sync-coordinator176.js'];
assert(sync.includes('function syncAfterReconnect(') && sync.includes('function syncAfterResume('), 'SyncCoordinator entry adapters missing');
assert(!/stableWsSyncPromise|setTimeout|setInterval|fetchRoomMessagesPage|syncRoomAfterReconnect/.test(sync), 'SyncCoordinator must remain a thin adapter');
assert((app.match(/FPSyncCoordinator176\.syncAfterReconnect\(safeDeviceId\)/g) || []).length === 1, 'Post-reconnect sync must have one coordinator entry');
assert((app.match(/FPSyncCoordinator176\.syncAfterResume\(\)/g) || []).length === 1, 'Resume sync must have one coordinator entry');
assert(app.includes('let stableWsSyncPromise=null;'), 'Existing sync dedupe promise missing');
assert(index.includes("'sync-coordinator176.js':['app.js','connection170.js']"), 'SyncCoordinator startup dependency missing');

assert(app.includes("const currentAfterDecrypt=state.chats.find((item)=>item.roomId===roomId);"), 'Post-decrypt preview invalidation guard missing');
assert(app.includes('const stalePreview=Boolean(currentChat?.lastActivity&&incomingTime&&currentTime>incomingTime);'), 'Monotonic message preview guard missing');
assert(app.includes("if(source==='api'){if(!canApplyUnreadSync(roomId,meta))return false;}"), 'Unread stale API guard missing');
assert(app.includes('inActiveChat=inActiveChat&&isRoomViewCurrent170(view)'), 'Active-room stale DOM guard missing');

if (failures.length) {
  console.error('[Build176 check] FAILED');
  for (const failure of failures) console.error(' - ' + failure);
  process.exitCode = 1;
} else {
  console.log('[Build176 check] OK');
  console.log('Lifecycle, room-session, connection and sync ownership invariants are present.');
  console.log('Physical iOS/Android, push and real microphone acceptance remain separate.');
}
