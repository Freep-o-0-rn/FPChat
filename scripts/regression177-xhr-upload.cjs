'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const networkSource = fs.readFileSync(path.join(root, 'public/network171.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, options = {}) {
    const list = this.listeners.get(type) || [];
    list.push({ fn, once: Boolean(options?.once) });
    this.listeners.set(type, list);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((entry) => entry.fn !== fn));
  }
  emit(type, event = {}) {
    const list = [...(this.listeners.get(type) || [])];
    for (const entry of list) {
      entry.fn.call(this, { type, ...event });
      if (entry.once) this.removeEventListener(type, entry.fn);
    }
  }
}

const instances = [];
class FakeXHR extends FakeTarget {
  constructor() {
    super();
    this.upload = new FakeTarget();
    this.openCalls = [];
    this.sendCalls = [];
    this.abortCalls = 0;
    this.headers = [];
    this.status = 200;
    this.responseText = '{"ok":true}';
    instances.push(this);
  }
  open(...args) {
    this.openCalls.push(args);
    this.method = args[0];
    this.url = args[1];
    this.async = args[2];
  }
  send(body) {
    this.sendCalls.push(body);
    this.body = body;
  }
  abort() {
    this.abortCalls += 1;
    this.emit('abort');
  }
  setRequestHeader(name, value) {
    this.headers.push([name, value]);
  }
}

let currentScript = { src: 'https://fpchat.test/network171.js?v=177' };
const windowTarget = new FakeTarget();
windowTarget.fetch = async () => ({ ok: true });
windowTarget.window = windowTarget;
const document = {};
Object.defineProperty(document, 'currentScript', { get: () => currentScript });
windowTarget.document = document;

const context = {
  console,
  URL,
  DOMException,
  AbortController,
  ReadableStream,
  Response,
  XMLHttpRequest: FakeXHR,
  location: { href: 'https://fpchat.test/', origin: 'https://fpchat.test' },
  CustomEvent: class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  },
  document,
  window: windowTarget
};
windowTarget.location = context.location;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(networkSource, context, { filename: 'network171.js' });

const network = windowTarget.FPNetwork171;
assert(network, 'FPNetwork171 must load');
assert.equal(network.snapshot().xhr.ownershipInstalled, true, 'FPNetwork171 must own XMLHttpRequest open/send');

// Register the one existing legacy XHR layer exactly as typing.js does.
currentScript = { src: 'https://fpchat.test/typing.js?v=177' };
vm.runInContext(`
  window.__xhr177OpenNext = XMLHttpRequest.prototype.open;
  window.__xhr177SendNext = XMLHttpRequest.prototype.send;
  window.__xhr177OpenCalls = 0;
  window.__xhr177SendCalls = 0;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    window.__xhr177OpenCalls += 1;
    return window.__xhr177OpenNext.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    window.__xhr177SendCalls += 1;
    return window.__xhr177SendNext.call(this, body);
  };
`, context);
currentScript = null;

const body = { marker: 'same-upload-body' };

(async () => {
  // Abort before start: no XHR object, open or send.
  const preAbort = new AbortController();
  preAbort.abort();
  const beforePreAbort = instances.length;
  await assert.rejects(
    () => network.upload({ url: '/api/rooms/r/media/upload', body, signal: preAbort.signal }),
    (error) => error?.name === 'AbortError'
  );
  assert.equal(instances.length, beforePreAbort, 'pre-abort must not construct XMLHttpRequest');

  // Success + progress: one open/send, same body, exact xhr result.
  const progress = [];
  const successPromise = network.upload({
    url: '/api/rooms/r/media/upload',
    body,
    onProgress: (loaded, total, computable, event) => progress.push({ loaded, total, computable, event })
  });
  const successXhr = instances.at(-1);
  assert.equal(successXhr.openCalls.length, 1);
  assert.deepEqual(successXhr.openCalls[0], ['POST', '/api/rooms/r/media/upload', true]);
  assert.equal(successXhr.sendCalls.length, 1);
  assert.equal(successXhr.sendCalls[0], body, 'XHR body identity must be preserved');
  const progressEvent = { loaded: 7, total: 10, lengthComputable: true, marker: 'progress-event' };
  successXhr.upload.emit('progress', progressEvent);
  assert.equal(progress.length, 1);
  assert.deepEqual(
    { loaded: progress[0].loaded, total: progress[0].total, computable: progress[0].computable, marker: progress[0].event.marker },
    { loaded: 7, total: 10, computable: true, marker: 'progress-event' }
  );
  successXhr.emit('load');
  assert.equal(await successPromise, successXhr, 'upload must resolve with the same XMLHttpRequest');

  // Abort during request: request has started exactly once, abort is forwarded exactly once.
  const duringAbort = new AbortController();
  const abortPromise = network.upload({ url: '/api/rooms/r/media/upload', body, signal: duringAbort.signal });
  const abortXhr = instances.at(-1);
  assert.equal(abortXhr.sendCalls.length, 1);
  duringAbort.abort();
  await assert.rejects(() => abortPromise, (error) => error?.name === 'AbortError');
  assert.equal(abortXhr.abortCalls, 1, 'active XHR must be aborted exactly once');
  assert.equal(abortXhr.sendCalls.length, 1, 'abort must not resend the upload');

  // Network error: same existing error contract.
  const errorPromise = network.upload({ url: '/api/rooms/r/media/upload', body });
  const errorXhr = instances.at(-1);
  errorXhr.emit('error');
  await assert.rejects(() => errorPromise, (error) => error?.message === 'network error');

  const snapshot = network.snapshot();
  assert.equal(snapshot.xhr.openLayers.length, 1);
  assert.equal(snapshot.xhr.sendLayers.length, 1);
  assert.equal(snapshot.xhr.openLayers[0].id, 'typing-activity121');
  assert.equal(snapshot.xhr.sendLayers[0].id, 'typing-activity121');
  assert.equal(windowTarget.__xhr177OpenCalls, 3, 'only started uploads reach XHR open layer');
  assert.equal(windowTarget.__xhr177SendCalls, 3, 'only started uploads reach XHR send layer');

  console.log('PASS FPNetwork171 owns XHR open/send and the existing typing layer stays in-chain');
  console.log('PASS upload progress keeps loaded/total/computable/event');
  console.log('PASS abort before start creates no XHR');
  console.log('PASS abort during upload aborts once and does not resend');
  console.log('PASS network error keeps the existing error contract');
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

const routeStart = serverSource.indexOf("app.post('/api/rooms/:publicId/media/upload'");
const routeEnd = serverSource.indexOf("\napp.get('/api/media/:publicId/blob'", routeStart);
assert(routeStart >= 0 && routeEnd > routeStart, 'media upload route must exist');
const route = serverSource.slice(routeStart, routeEnd);
assert(route.includes('const previousUpload = q.findMediaByPublicId.get(publicId);'), 'uploadId recovery lookup missing');
assert(route.includes("if (previousUpload)"), 'existing committed upload must be recoverable');
assert(!route.includes("res.once('close'"), 'post-commit response close must not delete an idempotent pending upload');
assert(serverSource.includes('function cleanupStalePendingMedia()'), 'stale pending-media cleanup must remain');
assert(serverSource.includes("app.delete('/api/rooms/:publicId/media/pending'"), 'explicit pending-media cancel/delete must remain');

run(async ({ newClient, errors }) => {
  const page = await newClient();
  const fixture = await page.evaluate(async () => {
    const deviceId = getOrCreateDeviceId();
    const secret = 'test-177-xhr-upload';
    const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ displayName: state.nick, deviceId, roomSecret: secret, ...recovery })
    });
    if (!response.ok) throw new Error('room fixture failed');
    const data = await response.json();
    return { roomId: data.publicId, deviceId };
  });

  const result = await page.evaluate(async ({ roomId, deviceId }) => {
    const uploadId = '17730000000000000000000000000001';
    const makeBody = () => {
      const fd = new FormData();
      fd.append('deviceId', deviceId);
      fd.append('uploadId', uploadId);
      fd.append('originalNameCiphertext', 'name-cipher');
      fd.append('originalNameIv', 'name-iv');
      fd.append('mimeType', 'image/jpeg');
      fd.append('mediaKind', 'image');
      fd.append('sizeBytes', '3');
      fd.append('encryptedSizeBytes', '3');
      fd.append('thumbSizeBytes', '0');
      fd.append('thumbEncryptedSizeBytes', '0');
      fd.append('width', '1');
      fd.append('height', '1');
      fd.append('durationSeconds', '0');
      fd.append('fileOrder', '0');
      fd.append('encryptedFile', new Blob([new Uint8Array([1,2,3])], {type:'application/octet-stream'}), 'file.bin');
      return fd;
    };

    // First response is intentionally not consumed by the caller.
    const first = await fetch('/api/rooms/' + roomId + '/media/upload', { method:'POST', body:makeBody() });
    const firstStatus = first.status;

    // Retry the same stable uploadId: server must recover the already committed pending row.
    const second = await fetch('/api/rooms/' + roomId + '/media/upload', { method:'POST', body:makeBody() });
    const secondData = await second.json();

    const cleanup = await fetch('/api/rooms/' + roomId + '/media/pending', {
      method:'DELETE',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({deviceId, uploadIds:[uploadId]})
    });
    const cleanupData = await cleanup.json();

    return {
      firstStatus,
      secondStatus: second.status,
      recovered: secondData?.ok === true && secondData?.media?.public_id === uploadId,
      recoveredId: secondData?.media?.id || null,
      cleanupStatus: cleanup.status,
      cleanupDeleted: cleanupData?.deleted
    };
  }, fixture);

  assert.equal(result.firstStatus, 200);
  assert.equal(result.secondStatus, 200);
  assert.equal(result.recovered, true, JSON.stringify(result));
  assert(Number(result.recoveredId) > 0, JSON.stringify(result));
  assert.equal(result.cleanupStatus, 200);
  assert.equal(result.cleanupDeleted, 1, 'same uploadId must represent one pending server commit');
  assert.deepEqual(errors, []);

  console.log('PASS stable uploadId recovers one server commit when the first response is unobserved');
  console.log('PASS explicit pending cleanup still removes the recovered orphan');
}).catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
