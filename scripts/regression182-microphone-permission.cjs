'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const app = read('public/app.js');
const voice = read('public/voice.js');
const updater = read('update.bat');
const version = JSON.parse(read('public/version.json'));

for (const [name, source] of [['public/app.js', app], ['public/voice.js', voice]]) {
  new vm.Script(source, { filename: name });
}

assert(app.includes('#microphoneRequestPromise = null;'), 'MediaManager microphone request owner missing');
assert(app.includes("navigator.permissions.query({ name: 'microphone' })"), 'microphone permission query missing');
assert(app.includes('async acquireMicrophoneStream({'), 'MediaManager microphone acquisition missing');
assert(app.includes('if (this.#microphoneRequestPromise) return this.#microphoneRequestPromise;'), 'concurrent microphone request dedupe missing');
assert(app.includes('releaseMicrophoneStream(stream)'), 'MediaManager microphone release missing');

assert(voice.includes('async function acquireMicrophoneStream182()'), 'voice access adapter missing');
assert(voice.includes('stream = await acquireMicrophoneStream182();'), 'recording still bypasses MediaManager acquisition');
assert(!voice.includes('stream = await navigator.mediaDevices.getUserMedia({'), 'legacy direct recording getUserMedia path remains');
assert(voice.includes('releaseMicrophoneStream182(rec.stream);'), 'recording finalization bypasses MediaManager release');
assert(!voice.includes('Настройки веб-сайта → Микрофон → Разрешить'), 'instructional microphone alert returned');
assert(!voice.includes('FPChat уже получал доступ к микрофону'), 'long iOS microphone guidance alert returned');
assert(!voice.includes('onPersistentPermissionHint'), 'voice still wires microphone instruction callbacks');

assert.equal(version.build, '183.9');
assert(updater.includes('set "EXPECTED_BUILD=183.9"'), 'safe updater build gate does not match Build 183.9');

console.log('PASS Build 182 microphone permission ownership');
console.log('PASS microphone access stays centralized without extra instructional UI');
console.log('PASS voice recording relies on browser permission UI only');
console.log('PASS updater/version gate matches Build 183.9');
