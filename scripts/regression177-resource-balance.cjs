'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const networkSource = fs.readFileSync(path.join(root, 'public/network171.js'), 'utf8');

assert.equal((networkSource.match(/await acquireMediaSlot\(signal,weight\);/g) || []).length, 1, 'media request must acquire exactly once');
assert(networkSource.includes("const release=()=>{if(released)return;released=true;"), 'release must be idempotent');
assert.equal((networkSource.match(/releaseMediaSlot\(weight\);/g) || []).length, 1, 'physical release primitive must be reached only through one per-request release closure');

const consumeStart = networkSource.indexOf('async function consumeMedia(');
const consumeEnd = networkSource.indexOf('// ---- one physical mutation gate', consumeStart);
const consumeBlock = networkSource.slice(consumeStart, consumeEnd);
assert(!consumeBlock.includes('acquireMediaSlot('), 'consumeMedia must not acquire a second slot');
assert(consumeBlock.includes('coordinatorFetch(input,{...init,fpMediaLease174:lease})'), 'consumeMedia must use the existing admission layer');
assert(consumeBlock.includes('lease.release?.();'), 'consumeMedia must release the existing lease in finally');

const waiterStart = networkSource.indexOf('function acquireMediaSlot(');
const waiterEnd = networkSource.indexOf('function releaseMediaSlot(', waiterStart);
const waiterBlock = networkSource.slice(waiterStart, waiterEnd);
for (const forbidden of ['clientMessageId', 'retry', 'resend', 'payload', 'messageId', 'uploadId']) {
  assert(!waiterBlock.includes(forbidden), 'mediaWaiters became a send/retry queue: ' + forbidden);
}
assert(waiterBlock.includes('const waiter={resolve,reject,signal,weight,onAbort:null};'), 'admission waiter shape changed');

console.log('PASS one media-layer acquire and one idempotent release closure per admitted request');
console.log('PASS consumeMedia reuses the same lease instead of acquiring again');
console.log('PASS mediaWaiters contains admission state only, not send/retry payloads');

run(async ({ newClient, errors }) => {
  const page = await newClient();
  await page.waitForFunction(() => window.FPNetwork171?.use && window.FPNetwork171?.fetch);

  const result = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, label) => {
      for (let i=0;i<120;i+=1) {
        if (predicate()) return;
        await sleep(10);
      }
      throw new Error('timeout: ' + label);
    };
    const snap = () => FPNetwork171.snapshot().mediaBudget;
    const controllers = new Map();
    const started = [];

    FPNetwork171.use({
      id:'test-resource-balance1778',
      priority:95,
      source:'regression1778',
      handler:async ({input,init,next}) => {
        const raw = typeof input === 'string' ? input : String(input?.url || '');
        const url = new URL(raw, location.href);
        if (!/^\/api\/media\/balance1778-[^/]+\/(?:blob|thumb)$/.test(url.pathname)) return next(input,init);
        const id = url.pathname.split('/')[3];
        started.push(id);
        const body = new ReadableStream({
          start(controller) { controllers.set(id, controller); }
        });
        return new Response(body, {
          status:200,
          headers:{'Content-Type':'application/octet-stream','Content-Length':'4'}
        });
      }
    });

    // Fill all four thumbnail slots, then queue two more.
    const abort1 = new AbortController();
    const requests = [];
    const reads = [];
    for (let i=1;i<=6;i+=1) {
      const options = i===1 ? {signal:abort1.signal,cache:'no-store'} : {cache:'no-store'};
      const request = fetch('/api/media/balance1778-t' + i + '/thumb', options);
      requests.push(request);
      reads.push(request.then((response) => response.arrayBuffer()));
    }

    await waitFor(() => started.filter((id) => id.startsWith('balance1778-t')).length === 4, 'four thumbnails admitted');
    await waitFor(() => snap().queued === 2 && snap().reservedSlots === 4 && snap().active === 4, 'two thumbnails queued');

    // Trigger multiple possible release paths for t1.
    // Abort invokes abort(); the body path can subsequently also observe cancel/error.
    abort1.abort();
    try { await reads[0]; } catch {}
    await waitFor(() => started.includes('balance1778-t5'), 'exactly next waiter admitted');
    await sleep(80);

    const afterMultiRelease = {
      started:[...started],
      budget:snap()
    };
    if (afterMultiRelease.started.includes('balance1778-t6')) {
      throw new Error('double release admitted two waiters from one completed slot: ' + JSON.stringify(afterMultiRelease));
    }
    if (afterMultiRelease.budget.reservedSlots !== 4 || afterMultiRelease.budget.active !== 4 || afterMultiRelease.budget.queued !== 1) {
      throw new Error('budget changed by more than one release: ' + JSON.stringify(afterMultiRelease));
    }

    // Complete t2: now and only now t6 may enter.
    const c2 = controllers.get('balance1778-t2');
    if (!c2) throw new Error('t2 controller missing');
    c2.enqueue(new Uint8Array([1,2,3,4]));
    c2.close();
    await reads[1];
    await waitFor(() => started.includes('balance1778-t6'), 'second queued waiter admitted after second slot release');

    // Release remaining admitted thumbnails exactly once.
    for (const id of ['balance1778-t3','balance1778-t4','balance1778-t5','balance1778-t6']) {
      const controller = controllers.get(id);
      if (!controller) throw new Error(id + ' controller missing');
      controller.enqueue(new Uint8Array([1,2,3,4]));
      controller.close();
    }
    await Promise.allSettled(reads.slice(2));
    await waitFor(() => snap().reservedSlots === 0 && snap().active === 0 && snap().queued === 0, 'thumbnail budget returns to zero');

    // consumeMedia: original gets one acquire at the coordinator, EOF does not release it,
    // consumer finally releases the same lease exactly once.
    let finishConsumer;
    const consumerGate = new Promise((resolve) => { finishConsumer = resolve; });
    let bodyDone = false;
    const original = FPNetwork171.consumeMedia(
      '/api/media/balance1778-original/blob',
      {},
      async (response) => {
        await response.arrayBuffer();
        bodyDone = true;
        await consumerGate;
        return 'done';
      }
    );

    await waitFor(() => started.includes('balance1778-original'), 'original admitted');
    const queuedThumb = fetch('/api/media/balance1778-after/thumb', {cache:'no-store'});
    const queuedRead = queuedThumb.then((response) => response.arrayBuffer());
    await waitFor(() => snap().queued === 1 && snap().reservedSlots === 4, 'thumb waits behind original');

    const originalController = controllers.get('balance1778-original');
    originalController.enqueue(new Uint8Array([1,2,3,4]));
    originalController.close();
    await waitFor(() => bodyDone, 'original body consumed');
    await sleep(50);

    const beforeConsumerFinally = {
      afterStarted:started.includes('balance1778-after'),
      budget:snap()
    };
    if (beforeConsumerFinally.afterStarted) throw new Error('consumeMedia released on EOF before consumer finished');
    if (beforeConsumerFinally.budget.reservedSlots !== 4 || beforeConsumerFinally.budget.queued !== 1) {
      throw new Error('consumeMedia lease lost before finally');
    }

    finishConsumer();
    const originalResult = await original;
    await waitFor(() => started.includes('balance1778-after'), 'queued thumb admitted after consumeMedia finally');

    const afterController = controllers.get('balance1778-after');
    afterController.enqueue(new Uint8Array([1,2,3,4]));
    afterController.close();
    await queuedRead;
    await waitFor(() => snap().reservedSlots === 0 && snap().active === 0 && snap().queued === 0, 'final resource budget zero');

    return {
      afterMultiRelease,
      beforeConsumerFinally,
      originalResult,
      finalBudget:snap(),
      started
    };
  });

  assert.equal(result.afterMultiRelease.started.includes('balance1778-t6'), false);
  assert.equal(result.afterMultiRelease.budget.reservedSlots, 4);
  assert.equal(result.afterMultiRelease.budget.active, 4);
  assert.equal(result.afterMultiRelease.budget.queued, 1);
  assert.equal(result.beforeConsumerFinally.afterStarted, false);
  assert.equal(result.beforeConsumerFinally.budget.reservedSlots, 4);
  assert.equal(result.originalResult, 'done');
  assert.equal(result.finalBudget.reservedSlots, 0);
  assert.equal(result.finalBudget.active, 0);
  assert.equal(result.finalBudget.queued, 0);
  assert.deepEqual(errors, []);

  console.log('PASS abort/cancel/error paths cannot double-release one admitted thumbnail');
  console.log('PASS one released slot admits exactly one queued waiter');
  console.log('PASS consumeMedia does not double-acquire and releases only its existing lease');
  console.log('PASS final admission state returns to active=0 queued=0 reserved=0');
  console.log(JSON.stringify(result));
}).catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
