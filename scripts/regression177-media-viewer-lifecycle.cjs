'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const app = read('public/app.js');
const gallery = read('public/media-gallery134.js');
const context = read('public/message-context.js');
const contextFix = read('public/message-context-fix.js');

function functionSource(source, name) {
  const wrapped = '\n' + source;
  const patterns = [
    new RegExp('\\n\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\('),
    new RegExp('\\n\\s*const\\s+' + name + '\\s*=\\s*(?:async\\s*)?\\(')
  ];
  let match = null;
  for (const pattern of patterns) {
    match = pattern.exec(wrapped);
    if (match) break;
  }
  assert(match, 'function missing: ' + name);
  const start = Math.max(0, match.index - 1);
  const rest = source.slice(start + 1);
  const next = /\n\s{2}(?:(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(|const\s+[A-Za-z0-9_]+\s*=\s*(?:async\s*)?\()/g;
  next.lastIndex = 1;
  const found = next.exec(rest);
  return found ? rest.slice(0, found.index) : rest;
}

function appLineFunction(name) {
  const marker = 'function ' + name + '(';
  const index = app.indexOf(marker);
  assert(index >= 0, 'app viewer function missing: ' + name);
  const start = app.lastIndexOf('\n', index) + 1;
  const next = app.indexOf('\nfunction ', index + 1);
  return next >= 0 ? app.slice(start, next) : app.slice(start);
}

function fingerprint(text) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hash ^= BigInt(code & 0xff);
    hash = BigInt.asUintN(64, hash * prime);
    if (code > 0xff) {
      hash ^= BigInt((code >> 8) & 0xff);
      hash = BigInt.asUintN(64, hash * prime);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

const managerStart = app.indexOf('class FPMediaManager177Class {');
const managerEnd = app.indexOf('\nconst FPMediaManager177 =', managerStart);
assert(managerStart >= 0 && managerEnd > managerStart, 'MediaManager177 class missing');
const manager = app.slice(managerStart, managerEnd);

assert(manager.includes('#activeViewer = null;'), 'viewer identity slot missing');
assert(manager.includes('openViewer(viewer, openWorker)'), 'viewer open delegation missing');
assert(manager.includes('closeViewer(viewer, closeWorker)'), 'viewer close delegation missing');
assert(manager.includes('currentViewer()'), 'viewer current identity query missing');
assert(manager.includes('isViewerActive(viewer)'), 'viewer active identity query missing');
const viewerStart = manager.indexOf('  openViewer(viewer, openWorker) {');
const viewerEnd = manager.indexOf('\n  current() {', viewerStart);
assert(viewerStart >= 0 && viewerEnd > viewerStart, 'viewer delegation boundary missing');
const viewerBoundary = manager.slice(viewerStart, viewerEnd);
for (const forbidden of [
  'readEncryptedMedia174', 'fetch(', 'XMLHttpRequest', 'createObjectURL',
  'revokeObjectURL', 'navigator.share', '.download', 'File(', 'Blob('
]) {
  assert(!viewerBoundary.includes(forbidden), 'viewer delegation took media I/O/save ownership: ' + forbidden);
}

assert(gallery.includes('manager?.openViewer'), 'gallery open must delegate to MediaManager');
assert(gallery.includes('manager.openViewer(nextViewer, openViewerWorker177)'), 'gallery open worker boundary missing');
assert(gallery.includes('manager?.closeViewer'), 'gallery close must delegate to MediaManager');
assert(gallery.includes('manager.closeViewer(viewer, closeGalleryWorker177)'), 'gallery close worker boundary missing');
assert(context.includes('manager.closeViewer(viewer, closeViewerBackToContextWorker177)'), 'context viewer close bypass is not delegated');
assert(!functionSource(context, 'closeViewerBackToContext').includes('mediaViewerState = null;'),
  'context close command still mutates viewer state independently');

// Build 185 explicitly authorizes two changes: mountSlot binds active-photo
// geometry after load; navigateGallery serializes/cancels owned transitions.
// Behavioral coverage: regression185-photo-zoom-browser.cjs. I/O, cache, saves
// and the compatibility viewer remain fingerprinted against the old baseline.
const FROZEN = Object.freeze({
  gallery: {
    mountSlot: 'ec4c9914dc27a2b9',
    loadAsset: 'c2c481d707cef73e',
    dropAsset: '73c987110d973502',
    pruneAssetCache: 'd22f05b91e20c181',
    navigateGallery: '4c04706e7e9c706f'
  },
  context: {
    downloadBlob: '1cb886538cd0d077',
    createSaveProgress: '5a64c79657dc190d',
    saveSelectedPhoto: '5d534e1a698b9047'
  },
  contextFix: {
    download: 'fcaf9e718a118f05'
  },
  legacyApp: {
    openMediaViewer: '22060c6832a8e356',
    renderMediaViewer: 'e89130e650994f54',
    loadViewerMedia: '028898e354367a01'
  }
});

for (const [name, expected] of Object.entries(FROZEN.gallery)) {
  assert.equal(fingerprint(functionSource(gallery, name)), expected, 'gallery viewing behavior changed: ' + name);
}
for (const [name, expected] of Object.entries(FROZEN.context)) {
  assert.equal(fingerprint(functionSource(context, name)), expected, 'media save behavior changed: ' + name);
}
for (const [name, expected] of Object.entries(FROZEN.contextFix)) {
  assert.equal(fingerprint(functionSource(contextFix, name)), expected, 'video save behavior changed: ' + name);
}
for (const [name, expected] of Object.entries(FROZEN.legacyApp)) {
  assert.equal(fingerprint(appLineFunction(name)), expected, 'legacy app viewer implementation changed: ' + name);
}

console.log('PASS MediaManager177 owns only media-viewer open/close identity delegation');
console.log('PASS viewer I/O/save guards preserved; Build 185 photo binding and navigation contract pinned');
console.log('PASS message-context independent close entry delegates to the viewer owner');
console.log('PASS existing photo/video save and download mechanisms are unchanged');
