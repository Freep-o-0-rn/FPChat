'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const failures = [];
let finished = false;

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

function finish() {
  if (finished) return;
  finished = true;
  if (failures.length) {
    console.error('[Build171 check] FAILED');
    for (const failure of failures) console.error(` - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('[Build171 check] OK');
    console.log('Fetch/XHR ownership, bounded media pipeline and cache-format invariants are present.');
    console.log('This does not replace the manual multi-device regression suite.');
  }
}

const networkSource = parseJs('public/network171.js');
const voiceSource = parseJs('public/voice.js');
const indexSource = read('public/index.html');
const version = JSON.parse(read('public/version.json'));
const packageJson = JSON.parse(read('package.json'));

assert(Number.isInteger(Number(version.build)) && Number(version.build) >= 171, 'public/version.json must report build 171 or a later integrating build');
assert(indexSource.includes('/network171.js'), 'index.html must load network171.js');
assert(indexSource.includes('network.onload = loadMessageStoreThenApp') && indexSource.includes('store.onload = load173OwnersThenApp') && indexSource.includes('layer.onload = loadApp'), 'app.js must be gated by successful network171 load');
assert(indexSource.includes('network.onerror = () =>'), 'index.html must retain a safe legacy boot fallback');
assert(networkSource.includes("Object.defineProperty(window, 'fetch'"), 'network171 must own window.fetch through a stable property');
assert(networkSource.includes("Object.defineProperty(xhrProto, 'open'"), 'network171 must own XMLHttpRequest.prototype.open');
assert(networkSource.includes("Object.defineProperty(xhrProto, 'send'"), 'network171 must own XMLHttpRequest.prototype.send');
assert(networkSource.includes('function upload({'), 'network171 must expose the common XHR upload path');
assert(networkSource.includes("MEDIA_CACHE_NAME = 'fpchat-media-v167'"), 'network171 must keep the existing managed cache format');
assert(networkSource.includes('fpMediaCache171Put'), 'network171 must gate physical managed-cache writes');
assert(/id:\s*\x27media-download-budget171\x27/.test(networkSource), 'network171 must bound media download concurrency');
assert(packageJson.scripts?.['check:171'] === 'node ./scripts/check-build171.js', 'package.json must expose npm run check:171');

const allowedLegacyFetchFiles = new Set([
  'typing.js',
  'room-lifecycle.js',
  'chat-request-owner147.js',
  'chat-request-cooldown160.js',
  'build165-ui.js',
  'storage167.js',
  'storage167-clear-guard.js',
  'storage167-cache-fix.js'
]);

for (const name of allowedLegacyFetchFiles) {
  assert(networkSource.includes(`'${name}'`), `network171 must declare legacy fetch adapter ${name}`);
}

for (const entry of fs.readdirSync(path.join(root, 'public'), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
  const source = read(path.join('public', entry.name));
  if (/window\.fetch\s*=/.test(source)) {
    assert(allowedLegacyFetchFiles.has(entry.name), `unowned window.fetch assignment found in public/${entry.name}`);
  }
  if (/xhrProto\.(?:open|send)\s*=/.test(source)) {
    assert(entry.name === 'typing.js', `unowned XMLHttpRequest prototype assignment found in public/${entry.name}`);
  }
}

assert(read('public/storage167.js').includes("fpchat-media-v167"), 'managed media cache format must remain fpchat-media-v167');
assert(read('public/storage167-cache-fix.js').includes("fpchat-media-v167"), 'cache-fix must remain on fpchat-media-v167');
assert(!networkSource.includes('fpchat-media-v171'), 'Build 171 must not rename the managed cache merely because the app build changed');
assert(voiceSource.includes('VOICE_BLOB_CACHE_LIMIT = 6'), 'voice playback blob cache must be bounded');
assert(voiceSource.includes('function evictVoiceBlobCache'), 'voice cache must have explicit eviction');
assert(voiceSource.includes('URL.revokeObjectURL'), 'voice cache eviction must revoke object URLs');
assert(voiceSource.includes('clearVoiceBlobCache();\n    voiceMessages.clear();'), 'voice cache must be cleared on room transition');
assert(voiceSource.includes('clearBlobCache: () => clearVoiceBlobCache()'), 'voice cache cleanup must be exposed for diagnostics/manual recovery');

try {
  let currentScript = { src: 'https://fpchat.test/network171.js?v=171' };
  const calls = [];

  function FakeXHR() {
    this.upload = { addEventListener() {} };
  }
  FakeXHR.prototype.open = function nativeOpen() { calls.push('xhr-native-open'); };
  FakeXHR.prototype.send = function nativeSend() { calls.push('xhr-native-send'); };
  FakeXHR.prototype.addEventListener = function addEventListener() {};
  FakeXHR.prototype.setRequestHeader = function setRequestHeader() {};
  FakeXHR.prototype.abort = function abort() {};

  const context = {
    console,
    URL,
    DOMException,
    location: { href: 'https://fpchat.test/', origin: 'https://fpchat.test' },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    document: {},
    XMLHttpRequest: FakeXHR,
    window: {
      dispatchEvent() {},
      addEventListener() {},
      fetch: async () => { calls.push('native'); return { ok: true }; },
      XMLHttpRequest: FakeXHR
    }
  };
  Object.defineProperty(context.document, 'currentScript', { get: () => currentScript });
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.location = context.location;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(networkSource, context, { filename: 'network171.js' });

  const installFetch = (file, label) => {
    currentScript = { src: `https://fpchat.test/${file}?v=171` };
    const base = context.window.fetch.bind(context.window);
    context.window.fetch = async function legacyAdapter(input, init) {
      calls.push(label);
      return base(input, init);
    };
  };

  installFetch('typing.js', 'typing');
  installFetch('storage167.js', 'storage');
  installFetch('room-lifecycle.js', 'lifecycle');
  installFetch('storage167-cache-fix.js', 'cache-fix');
  installFetch('chat-request-owner147.js', 'request-owner');
  installFetch('build165-ui.js', 'voice-block');
  installFetch('storage167-clear-guard.js', 'clear-guard');
  installFetch('chat-request-cooldown160.js', 'cooldown');

  currentScript = { src: 'https://fpchat.test/typing.js?v=171' };
  const baseOpen = FakeXHR.prototype.open;
  const baseSend = FakeXHR.prototype.send;
  FakeXHR.prototype.open = function typingOpen(...args) {
    calls.push('xhr-typing-open');
    return baseOpen.apply(this, args);
  };
  FakeXHR.prototype.send = function typingSend(...args) {
    calls.push('xhr-typing-send');
    return baseSend.apply(this, args);
  };
  currentScript = null;

  const stableFetchOwner = context.window.fetch;
  const stableXhrOpen = FakeXHR.prototype.open;
  const stableXhrSend = FakeXHR.prototype.send;
  const xhr = new FakeXHR();
  xhr.open('POST', '/api/rooms/test/media/upload');
  xhr.send(null);

  stableFetchOwner('/api/test').then(() => {
    const fetchCalls = calls.filter((item) => !item.startsWith('xhr-'));
    const expectedFetch = ['cache-fix', 'clear-guard', 'storage', 'voice-block', 'cooldown', 'request-owner', 'lifecycle', 'typing', 'native'];
    assert(JSON.stringify(fetchCalls) === JSON.stringify(expectedFetch), `network171 fetch pipeline order mismatch: ${JSON.stringify(fetchCalls)}`);
    assert(calls.includes('xhr-typing-open') && calls.includes('xhr-native-open'), 'typing XHR open adapter did not reach native open');
    assert(calls.includes('xhr-typing-send') && calls.includes('xhr-native-send'), 'typing XHR send adapter did not reach native send');
    assert(context.window.fetch === stableFetchOwner, 'window.fetch owner changed after legacy layer registration');
    assert(FakeXHR.prototype.open === stableXhrOpen, 'XMLHttpRequest.prototype.open owner changed after legacy registration');
    assert(FakeXHR.prototype.send === stableXhrSend, 'XMLHttpRequest.prototype.send owner changed after legacy registration');
    finish();
  }).catch((error) => {
    failures.push(`network171 pipeline simulation failed: ${error.message}`);
    finish();
  });
} catch (error) {
  failures.push(`network171 setup simulation failed: ${error.message}`);
  finish();
}
