'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const gesture=fs.readFileSync(path.join(root,'public/gesture-manager135.js'),'utf8').replace(/\r\n/g,'\n');

assert(gesture.includes("if ((PRIORITY[next] ?? 0) > (PRIORITY[session.layer] ?? 0)) {"),'layer promotion rule changed');
assert(!gesture.includes("if ((PRIORITY[next] ?? 0) < (PRIORITY[session.layer] ?? 0))"),'gesture manager introduced demotion');
assert(gesture.includes("cancelActions(session, 'layer');"),'upper-layer promotion no longer cancels lower actions');
assert(gesture.includes('session.layer = next;'),'promoted layer is not frozen into the active session');

assert(gesture.includes('session.actions.get(owner) === cancel\n        && claimAction(owner, event)'),'cancelled/released watcher can still claim through a stale lease');
assert(gesture.includes("cancelActions(touchSession, 'restart');"),'touch restart no longer cancels only the old touch actions');
assert(gesture.includes("cancelActions(pointerSession, 'restart');"),'pointer restart no longer cancels only the old pointer actions');
assert(gesture.includes("window.addEventListener('touchcancel', (event) => endSession('touch', event)"),'touchcancel no longer ends only touch session');
assert(gesture.includes("window.addEventListener('pointercancel', (event) => endSession('pointer', event)"),'pointercancel no longer ends only pointer session');

const end=gesture.slice(gesture.indexOf('function endSession'),gesture.indexOf('function currentSession'));
assert(end.includes("const session = kind === 'touch' ? touchSession : pointerSession;"),'endSession no longer selects one session kind');
assert(end.includes("if (kind === 'touch' && touchSession === session) touchSession = null;"),'touch end clears more than its own session');
assert(end.includes("if (kind === 'pointer' && pointerSession === session) pointerSession = null;"),'pointer end clears more than its own session');

const reset=gesture.slice(gesture.indexOf('const reset = () => {'),gesture.indexOf("window.FPLifecycle170?.subscribe"));
assert(reset.includes("cancelActions(touchSession, 'lifecycle');")&&reset.includes("cancelActions(pointerSession, 'lifecycle');"),'global lifecycle reset no longer intentionally clears both session kinds');

console.log('PASS 178.21 active gesture can promote upward but cannot demote back to a lower layer');
console.log('PASS stale lease cannot claim after layer/restart/release cancellation');
console.log('PASS touch restart/cancel and pointer restart/cancel remain isolated by session kind');
console.log('PASS lifecycle reset remains the explicit operation that clears both kinds');
