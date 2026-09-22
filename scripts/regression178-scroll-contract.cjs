'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const app = read('public/app.js');
const history = read('public/history174.js');
const actions = read('public/message-actions.js');
const viewport = read('public/viewport-fix.js');
const lifecycle = read('public/room-lifecycle.js');
const blocks = read('public/user-blocks165.js');

const ownerStart = app.indexOf('const scrollCoordinator=');
const ownerExport = app.indexOf('window.FPScroll173=scrollCoordinator;', ownerStart);
assert(ownerStart >= 0 && ownerExport > ownerStart, 'FPScroll173 owner/export missing');
const owner = app.slice(ownerStart, ownerExport);

assert(owner.includes("write(box,top,behavior='auto')"), 'central scroll writer changed');
assert(owner.includes("if(behavior==='smooth')box.scrollTo({top:next,behavior:'smooth'});else box.scrollTop=next;"), 'scroll write executor changed');

const initialStart = owner.indexOf('async applyInitial(viewState)');
const initialEnd = owner.indexOf('stop(){', initialStart);
assert(initialStart >= 0 && initialEnd > initialStart, 'initial scroll flow missing');
const initial = owner.slice(initialStart, initialEnd);
const unreadBranch = initial.indexOf('if(unreadTarget){');
const noUnreadBranch = initial.indexOf("}else if(!activeChatHistory?.unreadCount&&!activeChatHistory?.unloadedUnreadCount){");
const bottomBranch = initial.indexOf('if(viewState?.atBottom){');
const restoreBranch = initial.indexOf('const target=getViewStateMessageElement(box,viewState);');
assert(unreadBranch >= 0, 'initial unread branch missing');
assert(noUnreadBranch > unreadBranch, 'unread no longer wins the initial decision');
assert(bottomBranch > noUnreadBranch, 'saved bottom decision moved outside the no-unread branch');
assert(restoreBranch > bottomBranch, 'saved anchor no longer follows the existing atBottom decision');
assert(initial.includes("this.write(box,box.scrollTop+rect.bottom-boxRect.top-box.clientHeight+8,'auto');"), 'first-unread target/offset changed');
assert(initial.includes("this.write(box,box.scrollHeight,'auto');"), 'initial bottom fallback changed');
assert(initial.includes("this.write(box,box.scrollTop+rect.top-boxRect.top-offset,'auto');"), 'saved-anchor offset formula changed');

const bottomStart = owner.indexOf('requestBottom(box=this.box)');
const bottomEnd = owner.indexOf('focus(target', bottomStart);
assert(bottomStart >= 0 && bottomEnd > bottomStart, 'requestBottom flow missing');
const bottom = owner.slice(bottomStart, bottomEnd);
const jumpIndex = bottom.indexOf('void FPHistory174.jump();return;');
const openingIndex = bottom.indexOf("if(this.phase==='opening'){this.pendingBottom=true;return;}");
const writeIndex = bottom.indexOf("this.write(box,box.scrollHeight,'auto');");
assert(jumpIndex >= 0 && openingIndex > jumpIndex && writeIndex > openingIndex, 'bottom conflict order changed');

const focusStart = owner.indexOf('focus(target');
const prependStart = owner.indexOf('preservePrepend(', focusStart);
const focus = owner.slice(focusStart, prependStart);
assert(focus.includes('this.isOpening())return false;'), 'focus can now override opening');
const prepend = owner.slice(prependStart);
assert(prepend.includes("if(!isCurrentMessagesBox(box)||this.phase==='opening')return;"), 'prepend can now override opening');

assert(app.includes("function restoreMessagesViewState(box,viewState){const target=getViewStateMessageElement(box,viewState);if(!target||!isCurrentMessagesBox(box)||scrollCoordinator.isOpening())return false;"), 'saved/runtime restore no longer respects opening/current box');
assert(app.includes("return scrollCoordinator.write(box,box.scrollTop+targetTop-boxTop-offset,'auto');"), 'saved/runtime restore bypasses FPScroll173');

assert(history.includes("if(!history||!isCurrentMessagesBox(box)||history.loading||scrollCoordinator.isOpening())return false;"), 'history load can now override opening');
assert(history.includes("const anchor=getFirstVisibleMessageAnchor(box),total=unread(box)+history.unloadedUnreadCount;"), 'history window no longer captures the current visible anchor at mount');
assert(history.includes("finishMount(history,box,total);restoreAnchor(box,anchor);trim(direction);"), 'history window no longer restores its captured anchor before/through trim');
assert(history.includes("const anchor=getFirstVisibleMessageAnchor(box);"), 'bounded-DOM trim no longer captures a visible anchor');
assert(history.includes("rebuildDateSeparators(box);syncUnreadDivider(box);restoreAnchor(box,anchor);"), 'bounded-DOM trim no longer restores the visible anchor');
assert(history.includes("if(target)scrollCoordinator.focus(target,'auto',8);"), 'history jump target no longer delegates to focus');
assert(history.includes("else scrollCoordinator.write(box,box.scrollHeight,'auto');"), 'history tail jump no longer delegates to bottom write');

assert(actions.includes("window.FPScroll173?.requestBottom(box);"), 'message removal bottom path no longer delegates to FPScroll173');
assert(actions.includes("window.FPScroll173?.write(box, beforeTop - removedHeight, 'auto');"), 'message removal remove-above path changed its target/offset/behavior');

assert(app.includes("if(autoScroll){scrollCoordinator.requestBottom(box);window.FPHistory174?.trim('newer');}"), 'normal append auto-bottom no longer uses coordinator');
assert(lifecycle.includes("if (autoScroll) scrollCoordinator.requestBottom(box);"), 'room lifecycle event auto-bottom no longer uses coordinator');
assert(blocks.includes("scrollCoordinator.requestBottom(box)"), 'block event auto-bottom no longer uses coordinator');

const scrollListener = app.match(/box\.addEventListener\('scroll',\(\)=>\{([^}]*)\}\);/);
assert(scrollListener, 'messages native scroll observer missing');
assert(scrollListener[1].includes('scheduleViewStateSave();'), 'native scroll no longer saves view state');
assert(scrollListener[1].includes('recomputePendingUnread();'), 'native scroll no longer refreshes unread state');
assert(!scrollListener[1].includes('scrollCoordinator.') && !scrollListener[1].includes('FPScroll173'), 'native user scroll gained a programmatic scroll writer');
assert(history.includes("box.addEventListener('scroll',()=>{\n      if(scrollCoordinator.isOpening())return;"), 'history edge observer no longer respects opening');
assert(history.includes("if(box.scrollTop<=CHAT_HISTORY_LOAD_THRESHOLD_PX)void load('older');"), 'older edge history trigger changed');
assert(history.includes("else if(box.scrollHeight-box.clientHeight-box.scrollTop<=CHAT_HISTORY_LOAD_THRESHOLD_PX)void load('newer');"), 'newer edge history trigger changed');

assert(viewport.includes('pinBottom = Boolean(chatIsOpen() && box && messagesAtBottom(box));'), 'keyboard bottom pin no longer requires the user to already be at bottom');
assert(viewport.includes('window.FPScroll173.requestBottom(box);'), 'keyboard bottom pin bypasses FPScroll173 normal path');
assert(viewport.includes("if (event.target?.closest?.('#messages')) stopBottomPin();"), 'deliberate history interaction no longer cancels keyboard bottom pin');
assert(viewport.includes('box.scrollTop = box.scrollHeight;'), 'known viewport compatibility fallback disappeared without its dedicated migration step');

console.log('PASS 178.22 FPScroll173 remains the existing message-scroll owner');
console.log('PASS 178.22 opening/unread/restore/bottom conflict order is unchanged');
console.log('PASS 178.22 history load/trim/jump preserve the existing anchor/focus/bottom rules');
console.log('PASS 178.22 deletion compensation keeps the existing target/offset/auto behavior');
console.log('PASS 178.22 user scroll stays native/observational and keyboard pin remains conditional');
console.log('PASS 178.22 remaining direct fallback stays explicit for one-at-a-time migration');
