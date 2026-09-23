'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const swipe = read('public/swipe-fix.js');
const app = read('public/app.js');
const css = read('public/styles.css');
const gesture = read('public/gesture-manager135.js');
const layer = read('public/layer-manager173.js');
const ownership = read('docs/Build183_1_Chat_Back_Ownership.md');
const voice = read('public/voice.js');
const version = JSON.parse(read('public/version.json'));
const updater = read('update.bat');

new vm.Script(swipe, { filename: 'public/swipe-fix.js' });
new vm.Script(app, { filename: 'public/app.js' });

assert(gesture.includes("if (mode === 'chat') return layer === 'chat';"), 'FPGesture135 no longer owns chat navigation admission');
assert(layer.includes("if (el.closest('.chat-view')) return 'chat';"), 'FPLayer173 no longer identifies the chat layer');
assert(swipe.includes("manager.claimAction(`navigate:${swipe.mode}`, event)"), 'existing navigate:chat claim path is missing');
assert(swipe.includes("if (swipe.mode === 'chat') moveChatBackVisual(swipe.dx);"), 'chat drag is not routed through existing swipe executor');
assert(swipe.includes("if (current.mode === 'chat') resetChatBackVisual();"), 'chat cancel/reset path is missing');
assert(swipe.includes("content.style.transform = 'translate3d(105%,0,0)';"), 'room commit animation does not move content out');
assert(swipe.includes('content.addEventListener(\'transitionend\', finish, { once: true });'), 'commit does not wait for transition completion');
assert(swipe.includes('runExistingChatListExit();'), 'existing showChatsList exit path is not called after animation');
assert(swipe.includes('window.fpCommitChatBackTransition = commitChatBackVisual;'), 'button/system Back bridge to existing swipe executor is missing');

assert(app.includes("window.fpCommitChatBackTransition?.())return;showChatsList();"), 'room Back button does not preserve animated-first/fallback behavior');
assert(app.includes("if(state.roomId){if(window.fpCommitChatBackTransition?.())return true;showChatsList();return true;}"), 'system Back does not preserve animated-first/fallback behavior');
assert(app.includes("if(window.FPGesture135)return;"), 'legacy room touch fallback no longer yields to FPGesture135');
assert(app.includes("function showChatsList(){leaveActiveChat();"), 'existing room leave path changed');

assert(css.includes('.app.fp-chat-back-preview[data-pane="content"] .chat-list'), 'underlying existing chat list preview CSS missing');
assert(css.includes('.app.fp-chat-back-preview[data-pane="content"] .content'), 'content transition CSS missing');
assert(css.includes('pointer-events: none;'), 'underlying chat list must not accept input during preview');
assert(css.includes('transition: transform .18s ease;'), 'cancel/commit transition timing missing');

const visualStart = swipe.indexOf('const chatBackElements =');
const visualEnd = swipe.indexOf('let chatBackCommitInFlight');
assert(visualStart >= 0 && visualEnd > visualStart, 'visual-only helper block not found');
const visualOnly = swipe.slice(visualStart, visualEnd);
for (const forbidden of [
  'state.roomId',
  'scrollTop',
  'scrollTo(',
  'WebSocket',
  'FPRoomContext',
  'FPMessageStore',
  'leaveActiveChat(',
  'showChatsList('
]) {
  assert(!visualOnly.includes(forbidden), `drag/cancel visual block must not mutate owner domain: ${forbidden}`);
}

assert(ownership.includes('no new ChatTransitionManager;'), 'ownership document lost no-new-manager invariant');
assert(ownership.includes('FPScroll173 / ScrollArbiter'), 'scroll ownership not documented');
assert(ownership.includes('RoomContext170 / RoomSessionManager'), 'room ownership not documented');
assert(!voice.includes('FPChat уже получал доступ к микрофону'), 'obsolete iOS microphone instruction alert returned');
assert(!voice.includes('Настройки веб-сайта → Микрофон → Разрешить'), 'microphone instruction UI returned');
assert.equal(String(version.build), '183.9', 'release build mismatch');
assert(updater.includes('set "EXPECTED_BUILD=183.9"'), 'safe updater gate mismatch');

console.log('PASS Build 183 chat-back uses existing Layer/Gesture owners');
console.log('PASS drag/cancel remain visual-only and do not mutate room/scroll/store/WS domains');
console.log('PASS commit waits for animation before existing showChatsList room-leave path');
console.log('PASS Back button and system Back reuse the same existing swipe executor');
console.log('PASS obsolete microphone instruction alert is absent and Build 183.9 cache-bust is active');
