'use strict';

// Behavioral checks for passive diagnostics, without a browser or live DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {wrap} = require('node:module');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
for (const file of ['public/runtime169.js', 'scripts/server-runtime169.js', 'scripts/db-baseline169.js', 'scripts/start-diagnostics169.js']) {
  new vm.Script(file.startsWith('scripts/') ? wrap(read(file)) : read(file), {filename:file});
}

let now = 10;
let intervals = 0;
const fetch = () => { throw Error('Diagnostics must not request data'); };
const WebSocket = function () { throw Error('Diagnostics must not open WS'); };
const XMLHttpRequest = function () { throw Error('Diagnostics must not upload'); };
const window = {fetch, WebSocket, XMLHttpRequest, addEventListener() {}};
const context = {
  window, URL, console,
  location:{href:'https://fpchat.test/',origin:'https://fpchat.test'},
  navigator:{onLine:true},
  performance:{now:()=>now,getEntriesByType:()=>[]},
  document:{visibilityState:'visible',addEventListener(){},querySelectorAll:()=>[],getElementsByTagName:()=>[],scripts:[],styleSheets:[]},
  setTimeout(){}, setInterval(){intervals++;},
  state:{roomId:'private-room',key:'private-key',chats:[]}
};
vm.createContext(context);
vm.runInContext(read('public/runtime169.js'), context);
const runtime = window.FPRuntime;
const before = runtime.snapshot();
assert.equal(window.fetch, fetch);
assert.equal(window.WebSocket, WebSocket);
assert.equal(window.XMLHttpRequest, XMLHttpRequest);
assert.equal(intervals, 0);
assert.equal(before.mode, 'shadow');
assert.equal(before.bootReadyMs, null);
assert.equal(before.memory.supported, false);
assert.match(before.coverage.timers, /partial/);
assert.match(before.coverage.observers, /partial/);
assert.equal(before.legacyAuditBuild, 168);
assert.equal(before.legacyAuditScope, 'historical-static-baseline-not-current-runtime-counts');
assert(!JSON.stringify(before).includes('private-'));
const resource = runtime.registerResource('test-owner', 'listener', 'test-resource');
assert.equal(runtime.snapshot().registeredResources.length, 1);
assert.equal(runtime.releaseResource(resource), true);
assert.equal(runtime.snapshot().registeredResources.length, 0);
const measurement = runtime.startMeasure('test-operation');
now = 25;
assert.equal(runtime.endMeasure(measurement).durationMs, 15);
assert.equal(runtime.measurementSummary()['test-operation'].count, 1);
vm.runInContext(read('public/runtime169.js'), context);
assert.equal(window.FPRuntime, runtime, 'Installing diagnostics twice must be inert');

// Production diagnostics are opt-in: no imports, timers or process hooks.
vm.runInNewContext(read('scripts/server-runtime169.js'), {
  process:{env:{}},
  require(){throw Error('Disabled server diagnostics loaded a dependency');},
  setInterval(){throw Error('Disabled server diagnostics started a timer');}
});
console.log('[Build169 check] OK — passive diagnostics, partial coverage, measurements and opt-in server sampler.');
console.log('Device performance baselines require separate measured runs.');
