'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const layer=read('public/layer-manager173.js');
const gesture=read('public/gesture-manager135.js');
const dom=read('public/dom-lifecycle173.js');
const app=read('public/app.js');
const settings=read('public/settings-ui131.js');
const voice=read('public/voice.js');
const selection=read('public/message-selection.js');
const context=read('public/message-context.js');
const pins=read('public/message-pins-screen115.js');
const gallery=read('public/media-gallery134.js');
const actions=read('public/message-actions.js');
const pinDialog=read('public/message-pins.js');

function priority(source){
  const m=/const PRIORITY = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(source);
  assert(m,'PRIORITY missing');
  const out={};
  for(const x of m[1].matchAll(/([a-z]+):\s*(\d+)/g))out[x[1]]=Number(x[2]);
  return out;
}

const expected={base:0,chat:10,drawer:20,settings:30,voice:40,selection:50,context:60,modal:70,viewer:80};
assert.deepEqual(priority(layer),expected,'FPLayer173 priority order changed');
assert.deepEqual(priority(gesture),expected,'FPGesture135 fallback priority diverged from FPLayer173');

assert.equal((layer.match(/const claims = new Map\(\)/g)||[]).length,1,'FPLayer173 claims map count changed');
assert(layer.includes("['chat', 'chat']"),'chat DOM claim missing');
assert(layer.includes("['settings', 'settings']"),'settings DOM claim missing');
assert(layer.includes("['context', 'context']"),'context DOM claim missing');
assert(layer.includes("['modal', 'modal']"),'modal DOM claim missing');
assert(layer.includes("['viewer', 'viewer']"),'viewer DOM claim missing');
assert(layer.includes("setClaim('drawer', 'sidebar:open'"),'drawer claim token changed');
assert(layer.includes("setClaim('selection', 'body:selection'"),'selection claim token changed');
assert(layer.includes("setClaim('context', 'legacy-context-menu'"),'legacy context claim changed');
assert(layer.includes("setClaim('voice', 'composer:voice'"),'voice claim token changed');

for(const [kind,needle] of Object.entries({
  chat:"chat: '.chat-view'",
  settings:"settings: '.fp-settings131'",
  context:"context: '.message-context-root'",
  viewer:"viewer: '.media-viewer-overlay'"
}))assert(dom.includes(needle),`FPDOM173 ${kind} selector changed`);
assert(dom.includes("modal: '.media-preview-overlay,.fp-pins114-screen,.fp-pins114-action-overlay,.fp-pins114-delete-overlay,.message-delete-overlay,.message-selection-delete-overlay,.destructive-modal-overlay,.message-pin-overlay,[aria-modal=\"true\"]'"),'FPDOM173 modal family changed');

assert(app.includes('function openMobileMenu(){')&&app.includes("els.sidebar?.classList.add('open')"),'drawer open controller changed');
assert(app.includes('function closeMobileMenu(){')&&app.includes("els.sidebar?.classList.remove('open')"),'drawer close controller changed');
assert(app.includes("document.addEventListener('touchcancel',()=>{edgeSwipe.tracking=false;},{passive:true});"),'drawer legacy cancel path changed');

assert(app.includes('async function openChat('),'chat open controller missing');
assert(app.includes('function showChatsList(){leaveActiveChat();'),'chat close/navigation controller changed');
assert(app.includes('function setupChatBackSwipe(chatView){'),'legacy chat-back fallback missing');
assert(app.includes('// Keep this legacy handler only as a fallback if that owner failed to load.\n    if(window.FPGesture135)return;'),'legacy chat back is no longer fallback-only');

assert(settings.includes('renderSettings = function renderSettings131() { renderMain(); };'),'settings open/render controller changed');
assert(settings.includes("root.querySelector('.fp-settings131-back').onclick = onBack;"),'settings close/back controller changed');
assert(settings.includes("root.addEventListener('pointercancel', cancel"),'settings gesture cancel changed');

assert(voice.includes("form.classList.toggle('fp-voice-recording', active)"),'voice recording claim state changed');
assert(voice.includes("form.classList.add('fp-voice-previewing')"),'voice preview claim state changed');
assert(voice.includes("function stopRecording(action = 'cancel')"),'voice close/cancel controller changed');
assert(voice.includes("document.addEventListener('pointercancel', (event) => finishPress(event, true)"),'voice pointer cancel changed');

assert(selection.includes('function startSelection(id, mine)'),'selection open controller changed');
assert(selection.includes('document.body.classList.add(MODE_CLASS);'),'selection claim-open state changed');
assert(selection.includes('function exitSelection()'),'selection close controller changed');
assert(selection.includes('document.body.classList.remove(MODE_CLASS);'),'selection claim-close state changed');
assert(selection.includes("document.addEventListener('touchcancel'"),'selection gesture cancel changed');

assert(context.includes('function openContext(messageEl, sourceTarget, point = null)'),'message context open controller changed');
assert(context.includes("root.className = 'message-context-root';"),'message context DOM claim source changed');
assert(context.includes('function closeContext({ restoreScroll = true } = {})'),'message context close controller changed');
assert(context.includes('current.root?.remove();'),'message context close no longer removes claimed DOM');
assert(context.includes("document.addEventListener('touchcancel'"),'message context pending-gesture cancel changed');

assert(actions.includes("overlay.className = 'message-delete-overlay';")&&actions.includes('function closeDeleteDialog()'),'message-delete modal controller changed');
assert(pinDialog.includes("overlay.className = 'message-pin-overlay';")&&pinDialog.includes('function closePinDialog()'),'message-pin modal controller changed');
assert(pins.includes("root.className = 'fp-pins114-screen';")&&pins.includes('function closeScreen()'),'pins modal controller changed');
assert(pins.includes("overlay.className = 'fp-pins114-action-overlay';")&&pins.includes('function closeActionSheet()'),'pins action modal controller changed');

assert(gallery.includes('openMediaViewer = function openMediaViewer134'),'viewer open controller changed');
assert(gallery.includes('function closeGallery(viewer = currentGalleryState())'),'viewer close controller changed');
assert(gallery.includes("window.addEventListener('pointercancel', (event) => finish(event, true)"),'viewer pointer cancel changed');
assert(gallery.includes("window.addEventListener('touchcancel', end"),'viewer touch cancel changed');

assert(gesture.includes('function claimAction(owner, event)'),'gesture claim action missing');
assert(gesture.includes('function watchAction(owner, event, cancel)'),'gesture watcher missing');
assert(gesture.includes("cancelActions(session, 'claimed', owner);"),'competing gesture cancellation changed');
assert(gesture.includes("cancelActions(session, 'layer');"),'upper-layer promotion cancellation changed');

console.log('PASS 178.15 exact layer priority order is locked in FPLayer173 and FPGesture135');
console.log('PASS existing claim sources are guarded; no second layer stack added');
console.log('PASS feature controllers still own open/close/cancel for every layer family');
console.log('PASS FPGesture135 remains arbiter-only and does not replace feature controllers');
