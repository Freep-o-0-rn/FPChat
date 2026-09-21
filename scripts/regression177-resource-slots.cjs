'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const networkSource = fs.readFileSync(path.join(root, 'public/network171.js'), 'utf8');

assert(networkSource.includes("limit: 4"), 'media slot budget must remain 4');
assert(networkSource.includes("const weight=original?stats.mediaBudget.limit:1;"), 'original/thumb weights changed');
assert(networkSource.includes("const mediaWaiters = [];"), 'existing media admission queue missing');
assert(networkSource.includes("mediaWaiters.push(waiter);drainMediaSlots();"), 'existing FIFO admission path missing');
assert(networkSource.includes("if(init?.fpMediaLease174)init.fpMediaLease174.release=release;"), 'lease-based release handoff missing');
assert(networkSource.includes("if(chunk.done){controller.close();stats.mediaBudget.completed++;if(!init?.fpMediaLease174)release();return;}"), 'direct fetch body-completion release changed');
assert(networkSource.includes("lease.release?.();"), 'consumeMedia final release missing');

console.log('PASS ResourceArbiter contract is backed by existing FPNetwork171 media slot state');
console.log('PASS slot budget remains 4; original weight=4; thumbnail weight=1');

run(async ({ newClient, errors }) => {
  const page = await newClient(async (page) => {
    await page.addInitScript(() => {
      const realFetch = window.fetch.bind(window);
      const controllers = new Map();
      const nativeCalls = [];
      window.__resource1776 = {
        nativeCalls,
        release(id) {
          const controller = controllers.get(id);
          if (!controller) return false;
          controller.enqueue(new Uint8Array([1,2,3,4]));
          controller.close();
          controllers.delete(id);
          return true;
        }
      };
      window.fetch = async function fpResource1776Native(input, init) {
        let url;
        try { url = new URL(typeof input === 'string' ? input : input.url, location.href); }
        catch { return realFetch(input, init); }
        if (url.origin !== location.origin || !/^\/api\/media\/slot1776-[^/]+\/(?:blob|thumb)$/.test(url.pathname)) {
          return realFetch(input, init);
        }
        const id = url.pathname.split('/')[3];
        nativeCalls.push({ id, path:url.pathname, at:performance.now() });
        const body = new ReadableStream({
          start(controller) { controllers.set(id, controller); }
        });
        return new Response(body, {
          status:200,
          headers:{'Content-Type':'application/octet-stream','Content-Length':'4'}
        });
      };
    });
  });

  await page.waitForFunction(() => window.FPNetwork171?.consumeMedia);

  const result = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, label) => {
      for (let i=0;i<100;i+=1) {
        if (predicate()) return;
        await sleep(10);
      }
      throw new Error('timeout: ' + label);
    };
    const snap = () => FPNetwork171.snapshot().mediaBudget;
    const api = window.__resource1776;

    // 4 thumbnails consume the full 4-slot budget; the 5th stays queued.
    const thumbFetches = [];
    const thumbReads = [];
    for (let i=1;i<=5;i+=1) {
      const promise = fetch('/api/media/slot1776-t' + i + '/thumb');
      thumbFetches.push(promise);
      thumbReads.push(promise.then((response) => response.arrayBuffer()));
    }
    await waitFor(() => api.nativeCalls.filter((x) => x.id.startsWith('slot1776-t')).length === 4, 'four thumbnails admitted');
    await sleep(40);
    const thumbBeforeRelease = {
      native: api.nativeCalls.filter((x) => x.id.startsWith('slot1776-t')).length,
      budget: snap()
    };
    if (thumbBeforeRelease.native !== 4 || thumbBeforeRelease.budget.reservedSlots !== 4 || thumbBeforeRelease.budget.queued !== 1) {
      throw new Error('thumbnail admission mismatch ' + JSON.stringify(thumbBeforeRelease));
    }

    api.release('slot1776-t1');
    await thumbReads[0];
    await waitFor(() => api.nativeCalls.some((x) => x.id === 'slot1776-t5'), 'fifth thumbnail admitted');
    const thumbAfterRelease = {
      native: api.nativeCalls.filter((x) => x.id.startsWith('slot1776-t')).length,
      budget: snap()
    };

    for (let i=2;i<=5;i+=1) api.release('slot1776-t' + i);
    await Promise.all(thumbReads.slice(1));
    await waitFor(() => snap().reservedSlots === 0 && snap().active === 0, 'thumbnail slots released');

    // Original consumes all four weighted slots. A queued abort must consume no slot.
    let releaseConsumer;
    const consumerGate = new Promise((resolve) => { releaseConsumer = resolve; });
    window.__resource1776BodyConsumed = false;
    const original = FPNetwork171.consumeMedia(
      '/api/media/slot1776-original/blob',
      {},
      async (response) => {
        await response.arrayBuffer();
        window.__resource1776BodyConsumed = true;
        await consumerGate;
        return 'original-done';
      }
    );
    await waitFor(() => api.nativeCalls.some((x) => x.id === 'slot1776-original'), 'original admitted');

    const queuedAbort = new AbortController();
    const abortedThumb = fetch('/api/media/slot1776-abort/thumb', { signal:queuedAbort.signal });
    await waitFor(() => snap().queued === 1, 'abort thumb queued');
    queuedAbort.abort();
    let abortName = null;
    try { await abortedThumb; } catch (error) { abortName = error?.name || null; }
    await waitFor(() => snap().queued === 0, 'aborted waiter removed');

    // A normal thumb queued behind the original must still wait after encrypted body
    // has been consumed because consumeMedia retains the lease through its consumer.
    const afterOriginalFetch = fetch('/api/media/slot1776-after/thumb');
    const afterOriginalRead = afterOriginalFetch.then((response) => response.arrayBuffer());
    await waitFor(() => snap().queued === 1, 'thumb queued behind original');
    api.release('slot1776-original');
    await waitFor(() => window.__resource1776BodyConsumed === true, 'original body consumed');
    await sleep(50);

    const duringConsumer = {
      originalResultPending: true,
      afterNativeStarted: api.nativeCalls.some((x) => x.id === 'slot1776-after'),
      budget: snap(),
      abortName
    };
    if (duringConsumer.afterNativeStarted) throw new Error('slot released before consumeMedia consumer completed');
    if (duringConsumer.budget.reservedSlots !== 4 || duringConsumer.budget.queued !== 1) {
      throw new Error('original lease budget mismatch ' + JSON.stringify(duringConsumer));
    }
    if (abortName !== 'AbortError') throw new Error('queued cancel did not preserve AbortError');

    releaseConsumer();
    const originalResult = await original;
    await waitFor(() => api.nativeCalls.some((x) => x.id === 'slot1776-after'), 'thumb admitted after consumer release');
    api.release('slot1776-after');
    await afterOriginalRead;
    await waitFor(() => snap().reservedSlots === 0 && snap().active === 0 && snap().queued === 0, 'all slots released');

    return {
      initialContract: {
        limit: thumbBeforeRelease.budget.limit,
        originalLimit: thumbBeforeRelease.budget.originalLimit,
        thumbnailLimit: thumbBeforeRelease.budget.thumbnailLimit
      },
      thumbnailBeforeRelease: thumbBeforeRelease,
      thumbnailAfterRelease: thumbAfterRelease,
      duringConsumer,
      originalResult,
      finalBudget: snap(),
      nativeCalls: api.nativeCalls.map((x) => x.id)
    };
  });

  assert.equal(result.initialContract.limit, 4);
  assert.equal(result.initialContract.originalLimit, 1);
  assert.equal(result.initialContract.thumbnailLimit, 4);
  assert.equal(result.thumbnailBeforeRelease.native, 4);
  assert.equal(result.thumbnailBeforeRelease.budget.queued, 1);
  assert.equal(result.duringConsumer.afterNativeStarted, false);
  assert.equal(result.duringConsumer.abortName, 'AbortError');
  assert.equal(result.originalResult, 'original-done');
  assert.equal(result.finalBudget.reservedSlots, 0);
  assert.equal(result.finalBudget.active, 0);
  assert.equal(result.finalBudget.queued, 0);
  assert.deepEqual(errors, []);

  console.log('PASS four thumbnails occupy four slots and the fifth waits');
  console.log('PASS one original occupies the full weighted budget');
  console.log('PASS consumeMedia releases only after body consumer/decrypt phase completes');
  console.log('PASS queued cancel consumes no slot and is removed with AbortError');
  console.log('PASS every admitted slot is released; final active/queued/reserved = 0');
  console.log(JSON.stringify(result));
}).catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
