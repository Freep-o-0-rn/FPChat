'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const viewport=read('public/viewport-fix.js');
const keyboard=read('public/viewport-layout136.js');
const dom=read('public/dom-lifecycle173.js');
const styles=read('public/styles.css');
const settingsFix=read('public/settings-fix.js');
const pins=read('public/message-pins-screen114.js');

// Keyboard open/close keeps the existing bounded settle sequences.
assert(viewport.includes('for (const delay of [0, 40, 90, 160, 260, 400, 650, 900, 1250]) {'),
  'viewport settle sequence changed or became unbounded');
assert(keyboard.includes('for (const delay of [0, 30, 70, 120, 200, 320, 480, 700]) {'),
  'keyboard settle sequence changed or became unbounded');
assert(viewport.includes('clearSettleTimers();'),'viewport settle no longer cancels previous timers');
assert(keyboard.includes('clearSettleTimers();'),'keyboard settle no longer cancels previous timers');

// Orientation explicitly resets stale geometry/state before scheduling a bounded settle.
assert(viewport.includes("window.addEventListener('orientationchange', () => {\n    closedViewportHeight = 0;\n    expectKeyboardClosedUntil = 0;\n    stopBottomPin();\n    settleViewport();"),
  'viewport orientation reset contract changed');
assert(keyboard.includes("window.addEventListener('orientationchange', () => {\n    baselineHeight = 0;\n    settle();"),
  'keyboard orientation reset contract changed');

// Opening/closing keyboard preserves bottom only when it was already the user's intent.
assert(viewport.includes('pinBottom = Boolean(chatIsOpen() && box && messagesAtBottom(box));'),
  'bottom pin no longer checks current user position');
assert(viewport.includes("document.addEventListener('focusin', (event) => {"),'keyboard focus-in handler missing');
assert(viewport.includes("document.addEventListener('focusout', (event) => {"),'keyboard focus-out handler missing');
assert(viewport.includes("if (event.target?.closest?.('#messages')) stopBottomPin();"),
  'user interaction no longer cancels temporary bottom pin');

// Header/composer remain fixed flex rows around the scrolling message area.
assert(viewport.includes('#appRoot.${MANAGED_CLASS} .chat-view .chat-header {'),'managed header rule missing');
assert(viewport.includes('flex: 0 0 auto !important;'),'fixed header/composer flex contract missing');
assert(viewport.includes('#appRoot.${MANAGED_CLASS} .chat-view .messages {'),'managed messages rule missing');
assert(viewport.includes('flex: 1 1 auto !important;'),'messages no longer consume remaining viewport height');
assert(viewport.includes('#appRoot.${MANAGED_CLASS} .chat-view .composer,'),'managed composer rule missing');

// Safe-area + keyboard-open override stay mutually intentional: default safe area, 8px while iOS keyboard owns bottom.
assert(styles.includes('padding:8px 12px calc(8px + env(safe-area-inset-bottom));'),
  'default composer safe-area padding changed');
assert(keyboard.includes('html.fp-os-ios.fp-keyboard-open #appRoot.fpchat-mobile-chat-viewport .chat-view .composer'),
  'iOS keyboard composer override selector missing');
assert(keyboard.includes('padding-bottom: 8px !important;'),
  'iOS keyboard composer override changed');

// Normal runtime uses the centralized DOM owner; fallback observers are conditional only.
assert(viewport.includes('if (window.FPDOM173?.on) {'),'viewport module no longer prefers FPDOM173');
assert(viewport.includes("window.FPDOM173.on('chat', 'mounted', settleViewport);"),'viewport chat mount subscription missing');
assert(viewport.includes("window.FPDOM173.on('composer', 'mounted', settleViewport);"),'viewport composer mount subscription missing');
assert(viewport.includes('} else {\n    const observer = new MutationObserver(requestViewportSync);'),
  'viewport fallback observer is no longer conditional');
assert(keyboard.includes('if (window.FPDOM173?.on) {'),'keyboard module no longer prefers FPDOM173');
assert(keyboard.includes('} else {\n    // Compatibility fallback only if Build 173 DOM lifecycle failed to load.'),
  'keyboard fallback observer is no longer conditional');

// The centralized observer watches child-list lifecycle, not viewport style/class writes.
assert(dom.includes("observer.observe(document.body || document.documentElement, { childList: true, subtree: true });"),
  'FPDOM173 observer scope changed');
assert(!dom.includes('attributes: true'),'FPDOM173 started observing viewport attribute/style churn');

// Keyboard pane observer cannot self-loop on its own html keyboard classes: it watches only appRoot data-pane/class.
assert(keyboard.includes("attributeFilter: ['data-pane', 'class'],"),'keyboard pane observer scope changed');
assert(keyboard.includes("root.classList.toggle('fp-keyboard-open', next);"),'keyboard state target changed');
assert(keyboard.includes("root.dataset.fpKeyboard = next ? 'open' : 'closed';"),'keyboard dataset target changed');

// Loader guards prevent duplicate viewport modules during normal startup.
assert(settingsFix.includes("if (!document.getElementById('fpchat-viewport-fix-js')) {"),'viewport-fix loader guard missing');
assert(pins.includes("if (!document.querySelector('script[data-fp-viewport-layout136]')) {"),'viewport-layout loader guard missing');
assert(keyboard.includes('if (window.__fpViewport136Installed) return;'),'viewport-layout install idempotency missing');

console.log('PASS 178.28 keyboard/open-close and orientation settle sequences remain finite and cancelling');
console.log('PASS 178.28 header/composer/messages keep the existing flex geometry and safe-area rules');
console.log('PASS 178.28 centralized DOM lifecycle does not observe viewport style/class writes');
console.log('PASS 178.28 viewport module loading remains guarded against duplicate installation');
