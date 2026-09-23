'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const swipe=read('public/swipe-fix.js');
const app=read('public/app.js');
const context=read('public/message-context.js');

assert(swipe.includes('const EDGE_PX = 32;'),'edge zone changed');
assert(swipe.includes('const DIRECTION_LOCK_PX = 10;'),'navigation direction lock changed');
assert(swipe.includes('const CHAT_BACK_THRESHOLD_PX = 80;'),'chat back threshold changed');
assert(swipe.includes('const SETTINGS_BACK_THRESHOLD_PX = 70;'),'settings back threshold changed');

// Back/navigation claims only after horizontal direction is established.
assert(swipe.includes('if (Math.abs(swipe.dy) >= Math.abs(swipe.dx)) {'),'vertical-vs-horizontal decision changed');
assert(swipe.includes('swipe.axis = "vertical";'),'vertical navigation cancellation missing');
assert(swipe.includes('if (swipe.axis !== "horizontal" || swipe.dx <= 0) return;'),'non-horizontal movement can reach navigation claim');
assert(swipe.includes('manager.claimAction(`navigate:${swipe.mode}`, event)'),'chat/settings back no longer claim through FPGesture135');
assert(swipe.includes('if (event.cancelable) event.preventDefault();\n    event.stopImmediatePropagation();'),'owned horizontal navigation no longer suppresses lower handlers');

// Message reply recognizer gives vertical motion back without preventDefault.
assert(app.includes('if(Math.abs(dy)>Math.abs(dx)){tracking=false;bubble.style.transform=\'\';w.classList.remove(\'swiping\');return;}'),'reply vertical cancellation changed');
const replyMoveStart=app.indexOf("w.addEventListener('touchmove',(e)=>{");
const replyMoveEnd=app.indexOf("\n  },{passive:true});",replyMoveStart);
assert(replyMoveStart>=0&&replyMoveEnd>replyMoveStart,'reply touchmove block missing');
const replyMove=app.slice(replyMoveStart,replyMoveEnd);
assert(!replyMove.includes('preventDefault('),'reply touchmove started blocking native vertical scroll');

// Message long press only prevents default after it has already opened context.
assert(context.includes('if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {\n      cancelContextTouch178();'),'long press movement cancellation changed');
const contextMoveStart=context.indexOf("document.addEventListener('touchmove', (event) => {");
const contextMoveEnd=context.indexOf("document.addEventListener('touchend'",contextMoveStart);
const contextMove=context.slice(contextMoveStart,contextMoveEnd);
assert(contextMove.includes('if (session.triggered && contextState'),'triggered-context movement branch missing');
assert(contextMove.includes('if (event.cancelable) event.preventDefault();'),'opened context no longer owns its gesture');
assert(contextMove.indexOf('preventDefault()')<contextMove.indexOf('const touch = event.touches[0];'),'preventDefault moved into pre-trigger vertical movement path');

// Edge touchstart prevention is the pre-existing Safari/native-back reservation only.
assert(swipe.includes('if (touch.clientX <= EDGE_PX && event.cancelable) event.preventDefault();'),'native iOS back guard changed');
assert(swipe.includes('if ((mode === "drawer" || mode === "settings" || mode === "chat") && touch.clientX > EDGE_PX) return;'),'navigation edge-only rule changed');

// Existing executors remain unchanged.
assert(swipe.includes('if (typeof window.showChatsList === "function") window.showChatsList();'),'chat back executor changed');
assert(swipe.includes('if (current.modernSettings && commitModernSettingsBack()) return;'),'modern settings back executor changed');
assert(app.includes('setSelectedReply(state.roomId,getMessageReplyMeta(m.id))'),'reply executor missing');
assert(context.includes('openContext(messageEl, session.target'),'context executor missing');

console.log('PASS 178.20 chat/settings back keep old edge/threshold rules and claim through FPGesture135');
console.log('PASS vertical message movement cancels reply/long-press without JS scroll prevention');
console.log('PASS only the pre-existing 32px edge zone is reserved immediately for Safari/native-back protection');
