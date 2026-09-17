'use strict';

const fs = require('fs');
const path = require('path');

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
  try {
    // Parse only. Do not execute browser code in Node.
    new Function(source);
  } catch (error) {
    failures.push(`${relative}: syntax error: ${error.message}`);
  }
  return source;
}

const files = [
  'public/room-context170.js',
  'public/lifecycle170.js',
  'public/connection170.js',
  'public/room-open170.js',
  'public/typing.js',
  'public/message-actions.js',
  'public/message-pins.js',
  'public/message-pins-screen115.js',
  'public/build165-ui.js'
];

const sources = Object.fromEntries(files.map((file) => [file, parseJs(file)]));
const version = JSON.parse(read('public/version.json'));

assert(Number(version.build) === 170, 'public/version.json must report build 170');
assert(!sources['public/connection170.js'].includes('new WebSocket('), 'connection170 must never create a second WebSocket');
assert(sources['public/connection170.js'].includes("Object.defineProperty(state, 'ws'"), 'connection170 must observe the canonical state.ws slot');
assert(sources['public/room-open170.js'].includes('beginTransition'), 'room-open170 must use room transition generations');
assert(sources['public/room-open170.js'].includes('cancelPendingNavigation'), 'room-open170 must cancel stale pending opens on navigation');

assert(!sources['public/message-actions.js'].includes('setInterval(attachCurrentWs, 500)'), 'message-actions still has 500ms WS attachment polling');
assert(!sources['public/message-pins.js'].includes('setInterval(attachCurrentWs, 500)'), 'message-pins still has 500ms WS attachment polling');
assert(!sources['public/message-pins-screen115.js'].includes('setInterval(attachWs, 500)'), 'message-pins-screen115 still has 500ms WS attachment polling');
assert(!sources['public/typing.js'].includes('setInterval(() => {\n    attachCurrentWs();'), 'typing still has its legacy 500ms WS/room polling loop');

for (const file of ['public/message-actions.js', 'public/message-pins.js', 'public/message-pins-screen115.js', 'public/typing.js']) {
  assert(sources[file].includes('fpchat:connection170'), `${file} is not subscribed to connection170`);
}

const storage167 = read('public/storage167.js');
assert(storage167.includes("fpchat-media-v167"), 'managed media cache format name must remain fpchat-media-v167');

if (failures.length) {
  console.error('[Build170 check] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('[Build170 check] OK');
  console.log('Syntax parsed and critical ownership invariants are present.');
  console.log('This does not replace the manual multi-device regression suite.');
}
