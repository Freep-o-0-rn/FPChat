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
    console.log('Network owner, deterministic adapter order and cache-format invariants are present.');
    console.log('This does not replace the manual multi-device regression suite.');
  }
}

const networkSource = parseJs('public/network171.js');
const indexSource = read('public/index.html');
const version = JSON.parse(read('public/version.json'));
const packageJson = JSON.parse(read('package.json'));

assert(Number(version.build) === 171, 'public/version.json must report build 171');
assert(indexSource.includes('/network171.js'), 'index.html must load network171.js');
assert(indexSource.includes('network.onload = loadApp'), 'app.js must be gated by successful network171 load');
assert(indexSource.includes('network.onerror = () =>'), 'index.html must retain a safe legacy boot fallback');
assert(networkSource.includes("Object.defineProperty(window, 'fetch'"), 'network171 must own window.fetch through a stable property');
assert(networkSource.includes('configurable: false'), 'network171 fetch ownership must not be replaceable after install');
assert(networkSource.includes('nativeFetch'), 'network171 must keep the browser native fetch terminal');
assert(packageJson.scripts?.['check:171'] === 'node ./scripts/check-build171.js', 'package.json must expose npm run check:171');

const allowedLegacyFiles = new Set([
  'typing.js',
  'room-lifecycle.js',
  'chat-request-owner147.js',
  'chat-request-cooldown160.js',
  'build165-ui.js',
  'storage167.js',
  'storage167-clear-guard.js',
  'storage167-cache-fix.js'
]);

for (const name of allowedLegacyFiles) {
  assert(networkSource.includes(`'${name}'`), `network171 must declare legacy adapter ${name}`);
}

for (const entry of fs.readdirSync(path.join(root, 'public'), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
  const source = read(path.join('public', entry.name));
  if (!/window\.fetch\s*=/.test(source)) continue;
  assert(allowedLegacyFiles.has(entry.name), `unowned window.fetch assignment found in public/${entry.name}`);
}

assert(read('public/storage167.js').includes("fpchat-media-v167"), 'managed media cache format must remain fpchat-media-v167');
assert(read('public/storage167-cache-fix.js').includes("fpchat-media-v167"), 'cache-fix must remain on fpchat-media-v167');

// Deterministic pipeline simulation. Legacy files are intentionally installed in
// a scrambled order; network171 must still execute them by declared priority.
try {
  let currentScript = { src: 'https://fpchat.test/network171.js?v=171' };
  const calls = [];
  const context = {
    console,
    URL,
    location: { href: 'https://fpchat.test/' },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    document: {},
    window: {
      dispatchEvent() {},
      fetch: async () => { calls.push('native'); return { ok: true }; }
    }
  };
  Object.defineProperty(context.document, 'currentScript', { get: () => currentScript });
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.location = context.location;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(networkSource, context, { filename: 'network171.js' });

  const install = (file, label) => {
    currentScript = { src: `https://fpchat.test/${file}?v=171` };
    const base = context.window.fetch.bind(context.window);
    context.window.fetch = async function legacyAdapter(input, init) {
      calls.push(label);
      return base(input, init);
    };
  };

  install('typing.js', 'typing');
  install('storage167.js', 'storage');
  install('room-lifecycle.js', 'lifecycle');
  install('storage167-cache-fix.js', 'cache-fix');
  install('chat-request-owner147.js', 'request-owner');
  install('build165-ui.js', 'voice-block');
  install('storage167-clear-guard.js', 'clear-guard');
  install('chat-request-cooldown160.js', 'cooldown');
  currentScript = null;

  const stableOwner = context.window.fetch;
  stableOwner('/api/test').then(() => {
    const expected = ['cache-fix', 'clear-guard', 'storage', 'voice-block', 'cooldown', 'request-owner', 'lifecycle', 'typing', 'native'];
    assert(JSON.stringify(calls) === JSON.stringify(expected), `network171 pipeline order mismatch: ${JSON.stringify(calls)}`);
    assert(context.window.fetch === stableOwner, 'window.fetch owner changed after legacy layer registration');
    finish();
  }).catch((error) => {
    failures.push(`network171 pipeline simulation failed: ${error.message}`);
    finish();
  });
} catch (error) {
  failures.push(`network171 setup simulation failed: ${error.message}`);
  finish();
}
