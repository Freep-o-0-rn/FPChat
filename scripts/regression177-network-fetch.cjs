'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const networkSource = fs.readFileSync(path.join(root, 'public/network171.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

const fail = (message) => {
  throw new Error(message);
};

if (!appSource.includes("fetch(`/api/rooms/${publicId}/recovery`")) {
  fail('177.1 target recovery fetch caller is missing from app.js');
}

let currentScript = { src: 'https://fpchat.test/network171.js?v=177' };
let nativeMode = 'success';
let nativeCalls = 0;
const nativeObservations = [];
const responseSentinel = Object.freeze({ ok: true, status: 200, marker: 'native-response' });
const errorSentinel = new Error('native recovery failure');

const nativeFetch = async (input, init) => {
  nativeCalls += 1;
  nativeObservations.push({ input, init });
  if (nativeMode === 'error') throw errorSentinel;
  return responseSentinel;
};

const context = {
  console,
  URL,
  DOMException,
  ReadableStream,
  Response,
  location: { href: 'https://fpchat.test/', origin: 'https://fpchat.test' },
  CustomEvent: class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  },
  document: {},
  window: {
    fetch: nativeFetch,
    dispatchEvent() {},
    addEventListener() {}
  }
};
Object.defineProperty(context.document, 'currentScript', { get: () => currentScript });
context.window.window = context.window;
context.window.document = context.document;
context.window.location = context.location;
context.globalThis = context;

vm.createContext(context);
vm.runInContext(networkSource, context, { filename: 'network171.js' });

const expectedLegacyOrder = [
  ['storage-cache-copy167', 100, 'cache-fix'],
  ['storage-clear-guard167', 200, 'clear-guard'],
  ['storage-cache167', 300, 'storage'],
  ['voice-block-feedback166', 400, 'voice-block'],
  ['chat-request-cooldown160', 500, 'cooldown'],
  ['chat-request-owner147', 600, 'request-owner'],
  ['room-lifecycle98', 700, 'lifecycle'],
  ['typing-activity121', 800, 'typing']
];

const fileByLabel = {
  'cache-fix': 'storage167-cache-fix.js',
  'clear-guard': 'storage167-clear-guard.js',
  storage: 'storage167.js',
  'voice-block': 'build165-ui.js',
  cooldown: 'chat-request-cooldown160.js',
  'request-owner': 'chat-request-owner147.js',
  lifecycle: 'room-lifecycle.js',
  typing: 'typing.js'
};

const order = [];
const install = (label) => {
  currentScript = { src: `https://fpchat.test/${fileByLabel[label]}?v=177` };
  const baseFetch = context.window.fetch.bind(context.window);
  context.window.fetch = async function legacyAdapter(input, init) {
    order.push(label);
    return baseFetch(input, init);
  };
};

// Deliberately not priority order: FPNetwork171 must make registration timing irrelevant.
for (const label of ['typing', 'storage', 'request-owner', 'cache-fix', 'lifecycle', 'voice-block', 'clear-guard', 'cooldown']) {
  install(label);
}
currentScript = null;

const owner = context.window.fetch;
if (owner !== context.window.FPNetwork171.fetch) {
  fail('window.fetch is not the FPNetwork171 coordinator');
}

const snapshot = context.window.FPNetwork171.snapshot();
const legacyLayers = snapshot.layers
  .filter((layer) => layer.mode === 'legacy-adapter')
  .map((layer) => [layer.id, layer.priority, expectedLegacyOrder.find((item) => item[0] === layer.id)?.[2]]);

if (JSON.stringify(legacyLayers) !== JSON.stringify(expectedLegacyOrder)) {
  fail(`legacy priority order mismatch: ${JSON.stringify(legacyLayers)}`);
}

const input = '/api/rooms/recovery-room/recovery';
const body = JSON.stringify({
  deviceId: 'device-177',
  recoverySalt: 'salt',
  recoveryVerifier: 'verifier',
  recoverySecretIv: 'iv',
  recoverySecretCiphertext: 'ciphertext'
});
const init = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body
};

(async () => {
  const successStartNative = nativeCalls;
  const successStartOrder = order.length;
  const response = await owner(input, init);

  const successOrder = order.slice(successStartOrder);
  const expectedOrder = expectedLegacyOrder.map((item) => item[2]);
  if (JSON.stringify(successOrder) !== JSON.stringify(expectedOrder)) {
    fail(`handler order mismatch: ${JSON.stringify(successOrder)}`);
  }
  if (nativeCalls - successStartNative !== 1) {
    fail(`success chain performed ${nativeCalls - successStartNative} native fetch calls`);
  }

  const successObservation = nativeObservations.at(-1);
  if (successObservation.input !== input) fail('recovery request input changed before native fetch');
  if (successObservation.init !== init) fail('recovery request init object changed before native fetch');
  if (successObservation.init.body !== body) fail('recovery request body changed before native fetch');
  if (successObservation.init.method !== 'POST') fail('recovery request method changed');
  if (response !== responseSentinel) fail('response identity changed through FPNetwork171 pipeline');

  nativeMode = 'error';
  const errorStartNative = nativeCalls;
  const errorStartOrder = order.length;
  let caught = null;
  try {
    await owner(input, init);
  } catch (error) {
    caught = error;
  }

  const errorOrder = order.slice(errorStartOrder);
  if (JSON.stringify(errorOrder) !== JSON.stringify(expectedOrder)) {
    fail(`error handler order mismatch: ${JSON.stringify(errorOrder)}`);
  }
  if (nativeCalls - errorStartNative !== 1) {
    fail(`error chain performed ${nativeCalls - errorStartNative} native fetch calls`);
  }
  if (caught !== errorSentinel) fail('native fetch error identity/semantics changed');

  const finalSnapshot = context.window.FPNetwork171.snapshot();
  if (finalSnapshot.requests !== 2) fail(`expected 2 coordinator requests, got ${finalSnapshot.requests}`);
  if (finalSnapshot.nativeCalls !== 2) fail(`expected 2 native calls, got ${finalSnapshot.nativeCalls}`);
  if (finalSnapshot.failures !== 1) fail(`expected 1 coordinator failure, got ${finalSnapshot.failures}`);

  for (const [id] of expectedLegacyOrder) {
    const layer = finalSnapshot.layers.find((item) => item.id === id);
    if (!layer || layer.calls !== 2) fail(`layer ${id} did not see both logical requests`);
  }

  console.log('PASS 177.1 recovery fetch keeps FPNetwork171 priority order');
  console.log('PASS Request input/init/body and Response identity are preserved');
  console.log('PASS native error is propagated unchanged');
  console.log('PASS one logical fetch reaches native fetch exactly once');
  console.log(JSON.stringify({
    target: 'POST /api/rooms/:publicId/recovery',
    legacyOrder: expectedLegacyOrder.map(([id, priority]) => ({ id, priority })),
    logicalRequests: finalSnapshot.requests,
    nativeCalls: finalSnapshot.nativeCalls,
    failures: finalSnapshot.failures
  }));
})().catch((error) => {
  console.error('FAIL 177.1 network fetch regression');
  console.error(error?.stack || error);
  process.exitCode = 1;
});
