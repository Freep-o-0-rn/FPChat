'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const dom=read('public/dom-lifecycle173.js');
const layer=read('public/layer-manager173.js');
const gesture=read('public/gesture-manager135.js');
const app=read('public/app.js');
const pins=read('public/message-pins-screen115.js');
const pinDialog=read('public/message-pins.js');
const actions=read('public/message-actions.js');
const selection=read('public/message-selection.js');
const lifecycle=read('public/room-lifecycle.js');
const gallery=read('public/media-gallery134.js');
const profile=read('public/username-search143.js');
const system=read('public/chat-request-actions146.js');

assert(dom.includes('if (root.matches?.(selector)) out.push(root);'),'FPDOM173 no longer checks an added root itself');
assert(dom.includes('root.querySelectorAll?.(selector).forEach((node) => out.push(node));'),'FPDOM173 no longer discovers nested modal descendants');
assert(dom.includes("modal: '.media-preview-overlay,.fp-pins114-screen,.fp-pins114-action-overlay,.fp-pins114-delete-overlay,.message-delete-overlay,.message-selection-delete-overlay,.destructive-modal-overlay,.message-pin-overlay,[aria-modal=\"true\"]'"),'modal registry coverage changed');

for(const [label,source,needle] of [
 ['media preview',app,'media-preview-overlay'],
 ['pins screen',pins,'fp-pins114-screen'],
 ['pins action',pins,'fp-pins114-action-overlay'],
 ['pins delete',pins,'fp-pins114-delete-overlay'],
 ['message delete',actions,'message-delete-overlay'],
 ['selection delete',selection,'message-selection-delete-overlay'],
 ['destructive room delete',lifecycle,'destructive-modal-overlay'],
 ['message pin',pinDialog,'message-pin-overlay'],
 ['viewer',gallery,'media-viewer-overlay']
])assert(source.includes(needle),label+' overlay source missing');

assert(layer.includes("if (el.closest('.media-viewer-overlay')) return 'viewer';"),'viewer target layer changed');
assert(layer.includes("if (el.closest(MODAL_TARGETS)) return 'modal';"),'modal target layer changed');
assert(layer.includes("if (el.closest('.message-context-root')) return 'context';"),'context target layer changed');

assert(profile.includes('fp-profile144-overlay'),'profile wrapper missing');
assert(profile.includes('aria-modal'),'profile has no nested aria-modal contract');
assert(system.includes("root.className = 'fp-system145-overlay';"),'system wrapper missing');
assert(system.includes("sheet.setAttribute('aria-modal', 'true');"),'system wrapper has no nested aria-modal contract');

assert(profile.includes('function closeProfile()'),'profile close controller missing');
assert(system.includes('function closeOverlay()'),'system close controller missing');
assert(pins.includes('function closeScreen()'),'pins close controller missing');
assert(actions.includes('function closeDeleteDialog()'),'message delete close controller missing');
assert(pinDialog.includes('function closePinDialog()'),'pin dialog close controller missing');
assert(gallery.includes('function closeGallery(viewer = currentGalleryState())'),'viewer close controller missing');

for(const [name,source] of [
 ['app',app],['pins',pins],['pinDialog',pinDialog],['actions',actions],['selection',selection],
 ['lifecycle',lifecycle],['gallery',gallery],['profile',profile],['system',system]
]){
 assert(!source.includes('FPLayer173.claim('),name+' introduced a manual FPLayer173.claim');
 assert(!source.includes('FPLayer173.setClaim('),name+' introduced a manual FPLayer173.setClaim');
}

assert(gesture.includes("return ['viewer', 'modal', 'context', 'selection', 'voice'].includes(layer);"),'upper layer navigation block changed');
assert(!layer.includes('appendChild('),'FPLayer173 started creating feature UI');
assert(!layer.includes('.remove();'),'FPLayer173 started closing feature UI');

console.log('PASS 178.16 every audited overlay already reaches an existing FPLayer173 claim');
console.log('PASS wrapper overlays are covered through nested aria-modal discovery');
console.log('PASS no manual overlay claim or second layer stack was added');
console.log('PASS feature controllers still open/close UI; arbiter only blocks lower layers');
