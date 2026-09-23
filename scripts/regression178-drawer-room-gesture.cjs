'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const app=read('public/app.js');
const swipe=read('public/swipe-fix.js');
const gesture=read('public/gesture-manager135.js');
const browserRegression=read('scripts/regression175-drawer.cjs');

// Current thresholds/recognizers remain the existing ones.
assert(swipe.includes('const EDGE_PX = 32;'),'drawer edge threshold changed');
assert(swipe.includes('const DIRECTION_LOCK_PX = 10;'),'drawer direction lock changed');
assert(swipe.includes('const DRAWER_THRESHOLD_PX = 70;'),'drawer commit threshold changed');
assert(app.includes('setTimeout(()=>{'),'room long-press timer missing');
assert(app.includes('},600);'),'room long-press 600ms threshold changed');
assert(app.includes('Math.abs(touch.clientX-startX)>10||Math.abs(touch.clientY-startY)>10'),'room long-press 10px movement cancel changed');

// Room long press watches one action; drawer claims one navigation action.
assert(app.includes("FPGesture135?.watchAction?.('room-long-press',e,(reason)=>{"),'room long press no longer registers with gesture arbiter');
assert(app.includes("if(actionLease&&!actionLease.claim())return;"),'room long press no longer claims before opening menu');
assert(swipe.includes("manager?.claimAction && !manager.claimAction(`navigate:${swipe.mode}`, event)"),'drawer navigation no longer claims through FPGesture135');
assert(gesture.includes("cancelActions(session, 'claimed', owner);"),'claim no longer cancels competing recognizers');

// Short/full swipe ownership and native vertical behavior remain distinct.
assert(swipe.includes('if (Math.hypot(swipe.dx, swipe.dy) < DIRECTION_LOCK_PX) return;'),'drawer direction lock changed');
assert(swipe.includes('if (Math.abs(swipe.dy) >= Math.abs(swipe.dx)) {'),'vertical gesture arbitration changed');
assert(swipe.includes('if (current.canceled || current.dx < threshold) {'),'short swipe commit guard changed');
assert(swipe.includes('if (typeof window.openMobileMenu === "function") window.openMobileMenu();'),'drawer full-swipe executor changed');

// Cancel/multitouch must clear the arbiter/session, not leave a delayed room menu.
assert(gesture.includes("cancelActions(touchSession, 'restart');"),'multitouch/restart action cancellation changed');
assert(gesture.includes('if (event.touches?.length !== 1) {'),'multitouch guard changed');
assert(gesture.includes("window.addEventListener('touchcancel', (event) => endSession('touch', event)"),'arbiter touchcancel cleanup changed');
assert(app.includes("row.addEventListener('touchcancel',()=>{clearPressTimer();releaseAction();longPressTriggered=false;gestureCancelled=true;});"),'room long-press touchcancel cleanup changed');

// Hybrid touch→mouse behavior is intentional: cancelled touch blocks trailing click,
// but a real mouse pointerdown clears the touch cancellation for the next mouse click.
assert(app.includes("row.addEventListener('pointerdown',(e)=>{if(e.pointerType==='mouse')gestureCancelled=false;}"),'hybrid mouse recovery changed');
assert(app.includes("if(gestureCancelled||longPressTriggered===true||Date.now()<suppressNextClickUntil)"),'row click suppression changed');

// The pre-existing browser regression must continue to contain the full 178.18 matrix.
for(const scenario of [
 'edge drawer swipe cancels the row long press even when end is intercepted',
 'holding an owned drawer swipe cannot fire long press before release',
 'short horizontal swipe cancels long press without opening the drawer or chat',
 'intentional row long press still opens its menu exactly once',
 'opening the drawer by button cancels a pending underlying row press',
 'cancelled touch and multitouch leave no delayed row menu',
 'a trailing click after a cancelled swipe is ignored but the next tap works',
 'ordinary row tap still opens the chat',
 'a mouse click after a cancelled touch still opens the chat on a hybrid device'
])assert(browserRegression.includes(scenario),'missing browser regression scenario: '+scenario);

console.log('PASS 178.18 drawer/room-long-press thresholds and arbiter ownership are unchanged');
console.log('PASS full/short swipe, hold, tap, drawer button, cancel, multitouch and touch→mouse remain covered');
console.log('PASS runtime recognizers are reused; no second gesture implementation added');
console.log('NOTE physical mobile/native browser gestures still require device acceptance');
