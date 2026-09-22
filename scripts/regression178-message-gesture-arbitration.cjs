'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const app=read('public/app.js');
const context=read('public/message-context.js');
const gesture=read('public/gesture-manager135.js');

assert(app.includes('const SWIPE_REPLY_THRESHOLD=52;'),'reply threshold changed');
assert(context.includes('const LONG_PRESS_MS = 450;'),'message long-press threshold changed');
assert(context.includes('const MOVE_CANCEL_PX = 12;'),'message long-press movement cancel changed');

assert(context.includes("watchAction?.('message-long-press', event"),'message long press is not registered with FPGesture135');
assert(context.includes('if(session.actionLease&&!session.actionLease.claim()){cancelContextTouch178();return;}'),'message long press does not claim before opening context');
assert(context.includes('session.actionLease?.release?.();'),'message long-press lease is not released by local cleanup');
assert(context.includes('if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {\n      cancelContextTouch178();'),'old 12px movement cancel no longer releases the arbitration lease');

assert(app.includes("watchAction?.('message-reply-swipe',e,(reason)=>{"),'reply swipe is not registered with FPGesture135');
assert(app.includes('if(!replyClaimed&&Math.abs(currentDx)>=SWIPE_REPLY_THRESHOLD){'),'reply claim no longer occurs at the old 52px threshold');
assert(app.includes('const claimed=replyActionLease?replyActionLease.claim():true;'),'reply swipe does not claim through the existing lease');
assert(app.includes('&&(!window.FPGesture135||replyClaimed);'),'reply execution can bypass gesture ownership');
assert(app.includes('replyActionLease?.release?.();replyActionLease=null;'),'reply lease is not released after gesture cleanup');

assert(gesture.includes("cancelActions(session, 'claimed', owner);"),'claim no longer cancels competing actions');
assert(gesture.includes('if (session.action && session.action !== owner) { cancel(\'claimed\'); return null; }')||gesture.includes("if (session.action && session.action !== owner) { cancel('claimed'); return null; }"),'late watcher no longer loses to an existing claim');

// No new recognizer engine: feature modules still own timers, movement and execution.
assert(context.includes('session.timer = setTimeout(() => {'),'long-press timer left the feature controller');
assert(context.includes('openContext(messageEl, session.target'),'long-press executor left message-context controller');
assert(app.includes('currentDx=Math.max(-110,dx);'),'reply movement recognizer left appendMessage');
assert(app.includes('setSelectedReply(state.roomId,getMessageReplyMeta(m.id))'),'reply executor left app renderer');
assert(!gesture.includes('SWIPE_REPLY_THRESHOLD'),'FPGesture135 absorbed reply threshold logic');
assert(!gesture.includes('LONG_PRESS_MS'),'FPGesture135 absorbed long-press threshold logic');

// One touch session can have only one claimed action.
assert(gesture.includes('if (!session || session.ended || (session.action && session.action !== owner)) return false;'),'gesture manager allows a second claimed action');

console.log('PASS 178.19 old thresholds remain 450ms/12px and 52px');
console.log('PASS message long press and reply swipe both register in the same FPGesture135 session');
console.log('PASS the first recognizer reaching its old condition claims and cancels the competitor');
console.log('PASS feature recognizers/executors remain in their old controllers; no second gesture engine added');
