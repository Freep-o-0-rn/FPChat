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
assert(app.includes("localStorage.getItem('fpchat:microphone-ever-granted')"), 'previous successful microphone grant marker missing');
assert(app.includes('try { previouslyGranted = localStorage.getItem'), 'microphone marker must be best-effort');
assert(app.includes('try { localStorage.setItem'), 'successful microphone marker must not break stream acquisition');
assert(app.includes("(permission === 'prompt' || permission === 'unknown') && previouslyGranted"), 'Safari/unknown repeat-prompt detection missing');

assert(voice.includes('async function acquireMicrophoneStream182()'), 'voice access adapter missing');
assert(voice.includes('stream = await acquireMicrophoneStream182();'), 'recording still bypasses MediaManager acquisition');
assert(!voice.includes('stream = await navigator.mediaDevices.getUserMedia({'), 'legacy direct recording getUserMedia path remains');
assert(voice.includes('releaseMicrophoneStream182(rec.stream);'), 'recording finalization bypasses MediaManager release');
assert(voice.includes('Настройки веб-сайта → Микрофон → Разрешить'), 'Safari persistent permission guidance missing');
assert(voice.includes('iOS может всё равно повторно запросить доступ'), 'iOS PWA limitation guidance missing');

assert.equal(version.build, '182.4');
assert(updater.includes('set "EXPECTED_BUILD=182.4"'), 'safe updater build gate does not match Build 182.4');

console.log('PASS Build 182 microphone permission ownership');
console.log('PASS repeated permission state is detected without keeping microphone open');
console.log('PASS storage markers are best-effort and cannot break MediaStream acquisition');
console.log('PASS updater/version gate matches Build 182.4');
