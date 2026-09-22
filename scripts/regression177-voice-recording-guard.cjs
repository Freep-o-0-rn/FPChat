'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const voice = fs.readFileSync(path.join(root, 'public/voice.js'), 'utf8').replace(/\r\n/g, '\n');

// Frozen from the last accepted pre-177.25 state:
// 0863cc96394c4a61f618d827e64b3ee27e53ce2f
// This is a drift guard, not a security hash. Do not update fingerprints merely
// to make a later Build 177 refactor pass.
const BASELINE = Object.freeze({
  beginPressRecording: '0ac2e06b1edb70d8',
  lockRecording: '8932c2b3658354b7',
  cancelRecordingByGesture: 'a83db01ffe41b69b',
  handlePointerMove: '7d7746bd8983da2a',
  stopRecording: '99e678228655cce8',
  finishPress: 'db5b46a5ba53bf0f',
  finalizeRecording: 'efcb3c7859bf8a33',
  showPreview: 'bf0e029b7bb7cabb',
  clearPreview: '19f928bc51f9a26b',
  togglePreviewPlayback: 'f29e758b1265875e',
  sendPreview: '429c70fe26f125e1',
  handleVisibilityLoss: '68b56f6bfcb33e58'
});

function sourceOf(name) {
  const declaration = new RegExp('\\n  (?:async\\s+)?function ' + name + '\\s*\\(');
  const wrapped = '\n' + voice;
  const match = declaration.exec(wrapped);
  assert(match, 'voice function missing: ' + name);

  const start = Math.max(0, match.index - 1);
  const rest = voice.slice(start + 1);
  const nextFunction = /\n  (?:async\s+)?function [A-Za-z0-9_]+\s*\(/g;
  nextFunction.lastIndex = 1;
  const next = nextFunction.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
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

for (const [name, expected] of Object.entries(BASELINE)) {
  assert.equal(
    fingerprint(sourceOf(name)),
    expected,
    name + ' changed: Build 177 forbids rewriting the existing voice-recording path'
  );
}

const recorderConstructions = (voice.match(/new MediaRecorder\s*\(/g) || []).length;
assert.equal(recorderConstructions, 2, 'MediaRecorder construction path count changed');

console.log('PASS Build 177 voice-recording functions match the pre-177.25 baseline');
console.log('PASS press/lock/stop/preview/cancel implementation remains in voice.js');
console.log('PASS MediaRecorder construction path is unchanged');
