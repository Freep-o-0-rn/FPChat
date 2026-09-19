'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const failures = [];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function parseJs(relative) {
  const source = read(relative);
  try { new Function(source); }
  catch (error) { failures.push(`${relative}: syntax error: ${error.message}`); }
  return source;
}

const domSource = parseJs('public/dom-lifecycle173.js');
const layerSource = parseJs('public/layer-manager173.js');
const gestureSource = parseJs('public/gesture-manager135.js');
const appSource = parseJs('public/app.js');
const viewportLayoutSource = parseJs('public/viewport-layout136.js');
const viewportFixSource = parseJs('public/viewport-fix.js');
const voiceSource = parseJs('public/voice.js');
const actionsSource = parseJs('public/message-actions.js');
const pinsSource = parseJs('public/message-pins.js');
const selectionSource = parseJs('public/message-selection.js');
const voiceCancelSource = parseJs('public/voice-cancel125.js');
const gallerySource = parseJs('public/media-gallery134.js');
const contextSource = parseJs('public/message-context.js');
const swipeSource = parseJs('public/swipe-fix.js');
const indexSource = read('public/index.html');
const version = JSON.parse(read('public/version.json'));
const packageJson = JSON.parse(read('package.json'));

assert(Number.isInteger(Number(version.build)) && Number(version.build) >= 173, 'public/version.json must report build 173 or a later integrating build');
assert(packageJson.scripts?.['check:173'] === 'node ./scripts/check-build173.js', 'package.json must expose npm run check:173');

assert(indexSource.includes('/dom-lifecycle173.js'), 'index.html must load dom-lifecycle173.js');
assert(indexSource.includes('/layer-manager173.js'), 'index.html must load layer-manager173.js');
assert(indexSource.includes('domLifecycle.onload = loadLayer'), 'LayerManager must wait for DOM lifecycle when available');
assert(indexSource.includes('layer.onload = loadApp'), 'app.js must wait for LayerManager owner when it loads successfully');
assert(indexSource.includes('store.onload = load173OwnersThenApp'), 'Build 172 MessageStore must remain before Build 173 owners/app');

assert(domSource.includes("observer.observe(document.body || document.documentElement, { childList: true, subtree: true })"), 'FPDOM173 must own the centralized subtree observer');
assert(domSource.includes("message: '.bubble-wrap.msg'"), 'FPDOM173 must expose message mount lifecycle');
assert(domSource.includes("composer: '#sendForm'"), 'FPDOM173 must expose composer mount lifecycle');

assert(layerSource.includes("window.FPLayer173 = Object.freeze"), 'LayerManager public owner is missing');
assert(layerSource.includes("setClaim('selection', 'body:selection'"), 'selection layer must be explicit');
assert(layerSource.includes("setClaim('drawer', 'sidebar:open'"), 'drawer layer must be explicit');
assert(layerSource.includes("setClaim('context', 'legacy-context-menu'"), 'legacy room menu must participate in layer ownership');
assert(layerSource.includes("setClaim('voice', 'composer:voice'"), 'voice layer must be explicit');
assert(layerSource.includes('installCompatibilityDomObserver'), 'LayerManager must keep a fallback if FPDOM173 fails');

assert(gestureSource.includes('window.FPLayer173?.currentLayer'), 'FPGesture135 must use FPLayer173 instead of document scans on the normal path');
assert(gestureSource.includes('session.layerVersion === managerVersion'), 'gesture ownership must stay stable while layer state is unchanged');
assert(gestureSource.includes("publicOwner: 'FPGesture135 + FPLayer173'"), 'gesture ownership diagnostics are missing');

assert(appSource.includes('window.FPScroll173=scrollCoordinator'), 'existing scrollCoordinator must be the Build 173 scroll owner');
assert(appSource.includes('if(window.FPGesture135)return;'), 'legacy app navigation swipe must become fallback-only');

assert(viewportLayoutSource.includes("window.FPDOM173.on('chat', 'mounted', settle)"), 'keyboard layout must consume DOM lifecycle events');
assert(viewportFixSource.includes('window.FPViewport173 = Object.freeze'), 'viewport geometry owner is missing');
assert(viewportFixSource.includes('window.FPScroll173?.requestBottom'), 'viewport must route message scrolling through FPScroll173');
assert(viewportFixSource.includes("window.FPDOM173.on('composer', 'mounted', settleViewport)"), 'viewport must consume composer lifecycle events');

for (const [name, source] of [
  ['message-actions', actionsSource],
  ['message-pins', pinsSource],
  ['message-selection', selectionSource],
  ['voice', voiceSource],
  ['voice-cancel', voiceCancelSource]
]) {
  assert(source.includes('window.FPDOM173?.on') || source.includes('window.FPDOM173.on'), `${name} must use FPDOM173 on the normal Build 173 path`);
}

assert(voiceSource.includes("window.FPDOM173.on('message', 'mounted'"), 'voice message decoration must use message mount events');
assert(voiceSource.includes("setInterval(() => handleRoomChange173(), 500);"), 'voice must retain the 500 ms room watcher only as compatibility fallback');
assert(contextSource.includes('if (window.FPLayer173 && window.FPDOM173?.on)'), 'message context must defer viewer swipe ownership to the gallery');
assert(gallerySource.includes("manager.currentLayer(event, event.target) !== 'viewer'"), 'gallery gesture must be approved by gesture owner');
assert(swipeSource.includes("window.FPLayer173?.topLayer"), 'navigation swipe hot path must read explicit viewer layer state');

assert(!fs.existsSync(path.join(root, 'public/gesture-manager173.js')), 'do not create a second independent GestureManager in Build 173');

try {
  class FakeElement {
    constructor(kind = '') {
      this.kind = kind;
      this.hidden = false;
      this.isConnected = true;
      this.dataset = {};
      this.classList = {
        contains: () => false
      };
    }
    matches() { return false; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    closest(selector) {
      if (this.kind === 'voice' && String(selector).includes('.fp-voice-record-btn')) return this;
      if (this.kind === 'chat' && String(selector).includes('.chat-view')) return this;
      if (this.kind === 'viewer' && String(selector).includes('.media-viewer-overlay')) return this;
      return null;
    }
  }

  const body = new FakeElement('body');
  body.dataset = {};
  const listeners = {};
  const context = {
    console,
    Element: FakeElement,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init?.detail; }
    },
    MutationObserver: class MutationObserver {
      constructor(fn) { this.fn = fn; }
      observe() {}
      disconnect() {}
    },
    document: {
      body,
      documentElement: body,
      querySelectorAll() { return []; },
      getElementById() { return null; }
    },
    window: {
      FPRuntime: null,
      FPDOM173: null,
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      dispatchEvent() {}
    }
  };
  context.window.window = context.window;
  context.window.document = context.document;
  vm.createContext(context);
  vm.runInContext(layerSource, context, { filename: 'layer-manager173.js' });

  const layers = context.window.FPLayer173;
  assert(Boolean(layers), 'FPLayer173 did not initialize in VM');
  assert(layers.topLayer() === 'base', 'LayerManager must start at base with no claims');

  layers.setClaim('chat', 'test-chat', true);
  assert(layers.topLayer() === 'chat', 'chat claim did not become active');

  layers.setClaim('selection', 'test-selection', true);
  assert(layers.topLayer() === 'selection', 'selection must outrank chat');

  layers.setClaim('viewer', 'test-viewer', true);
  assert(layers.topLayer() === 'viewer', 'viewer must be the highest layer');

  layers.setClaim('viewer', 'test-viewer', false);
  assert(layers.topLayer() === 'selection', 'viewer release must restore selection ownership');

  layers.setClaim('selection', 'test-selection', false);
  layers.setClaim('chat', 'test-chat', false);
  assert(layers.currentLayer(new FakeElement('voice')) === 'voice', 'voice target must resolve without a document-wide scan');
} catch (error) {
  failures.push(`LayerManager VM regression failed: ${error.message}`);
}

if (failures.length) {
  console.error('[Build173 check] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('[Build173 check] OK');
  console.log('Layer, gesture, scroll, viewport and DOM lifecycle ownership invariants are present.');
  console.log('This does not replace the manual mobile gesture/keyboard regression suite.');
}
