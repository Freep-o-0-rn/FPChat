'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const guardSource = fs.readFileSync(path.join(root, 'public/storage167-clear-guard.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(root, 'public/storage167.js'), 'utf8');
const networkSource = fs.readFileSync(path.join(root, 'public/network171.js'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');

const updateStart = appSource.indexOf('async function applyAppUpdate(){');
const updateEnd = appSource.indexOf('\nasync function checkAppVersionOnEntry()', updateStart);
assert(updateStart >= 0 && updateEnd > updateStart, 'applyAppUpdate must exist');
const updateBlock = appSource.slice(updateStart, updateEnd);

assert(updateBlock.includes("key!==managedMediaCache&&!String(key).startsWith('fpchat-media-v')"), 'app update must preserve managed media cache');
assert(!updateBlock.includes('keys.map((key)=>caches.delete(key))'), 'app update must not clear every cache');
assert(swSource.includes("!key.startsWith(MEDIA_CACHE_PREFIX)"), 'service worker must preserve media cache family');

assert(storageSource.includes('guard?.runExclusive'), 'storage clear caller must use ClearGuard');
assert(guardSource.includes('async function runExclusive(startClear, button = null)'), 'ClearGuard runExclusive missing');
assert(guardSource.includes('await window.FPNetwork171?.waitForMediaCacheIdle?.();'), 'ClearGuard must wait for physical owner writes');
assert(networkSource.includes('async function waitForMediaCacheIdle()'), 'FPNetwork171 idle waiter missing');
assert(networkSource.includes('const mediaCacheWrites = new Map();'), 'authoritative mediaCacheWrites state missing');
assert((networkSource.match(/const mediaCacheWrites = new Map\(\);/g)||[]).length===1, 'media cache write state must remain singular');
assert(!guardSource.includes("document.addEventListener('click', (event) => {\n    const button = event.target instanceof Element ? event.target.closest('#fpStorage167StartClear')"), 'legacy capture clear path must be removed');

console.log('PASS app update no longer owns media-cache clear');
console.log('PASS one direct clear caller uses ClearGuard and FPNetwork171 authoritative write state');

run(async ({ newClient, errors }) => {
  const page = await newClient(async (page) => {
    await page.addInitScript(() => {
      if (typeof Cache === 'undefined' || !Cache.prototype?.put) return;
      const nativePut = Cache.prototype.put;
      Cache.prototype.put = function fpTest1775GatedPut(request, response) {
        let url = '';
        try { url = typeof request === 'string' ? request : String(request?.url || ''); } catch {}
        if (!url.includes('/api/media/race1775/blob')) return nativePut.call(this, request, response);
        const cache = this;
        window.__cachePut1775Entered = true;
        window.__cachePut1775Released = false;
        return new Promise((resolve, reject) => {
          window.__releaseCachePut1775 = () => {
            if (window.__cachePut1775Released) return;
            window.__cachePut1775Released = true;
            Promise.resolve(nativePut.call(cache, request, response)).then(resolve, reject);
          };
        });
      };
    });
  });
  await page.waitForFunction(() => window.FPNetwork171?.waitForMediaCacheIdle && window.FPStorage167 && window.FPStorage167ClearGuard?.runExclusive);

  const result = await page.evaluate(async () => {
    const cache = await caches.open(FPStorage167.cacheName);
    const requestUrl = new URL('/api/media/race1775/blob?deviceId=race-device', location.href).href;
    const request = new Request(requestUrl, { method:'GET', credentials:'same-origin' });
    await cache.delete(request).catch(() => false);

    let putSettled = false;
    const putPromise = cache.put(
      request,
      new Response(new Uint8Array([1,2,3,4]), {status:200,headers:{'Content-Type':'application/octet-stream','Content-Length':'4'}})
    ).finally(() => { putSettled = true; });

    for (let i = 0; i < 100 && !window.__cachePut1775Entered; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!window.__cachePut1775Entered) throw new Error('write did not enter physical Cache.put');
    if (FPNetwork171.snapshot().mediaCache.inFlight < 1) throw new Error('physical write is not tracked by FPNetwork171');
    if (putSettled) throw new Error('gated physical write did not stay pending');

    const progressRoot = document.createElement('div');
    progressRoot.className = 'fp-settings131';
    progressRoot.innerHTML = '<span id="fpStorage167Percent"></span><span id="fpStorage167ProgressText"></span>';
    document.body.appendChild(progressRoot);

    let clearStarted = false;
    let clearDone = null;
    const guardRun = FPStorage167ClearGuard.runExclusive(() => {
      clearStarted = true;
      clearDone = FPStorage167.clearCache(['file']).then((value) => {
        document.getElementById('fpStorage167ProgressText').textContent = 'Кэш очищен';
        return value;
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    const during = {
      clearing: FPStorage167ClearGuard.isClearing(),
      clearStarted,
      putSettled,
      networkInFlight: FPNetwork171.snapshot().mediaCache.inFlight,
      localTrackedWrites: FPStorage167ClearGuard.activeCacheWrites()
    };

    if (!during.clearing) throw new Error('guard did not activate');
    if (during.clearStarted) throw new Error('clear started before FPNetwork171 write settled: ' + JSON.stringify(during));
    if (during.putSettled) throw new Error('gated write settled before release');
    if (during.networkInFlight < 1) throw new Error('physical owner lost in-flight write');

    window.__releaseCachePut1775();
    await putPromise;
    if ((await guardRun) !== true) throw new Error('ClearGuard runExclusive did not complete successfully');

    for (let i = 0; i < 100 && !clearDone; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    if (!clearDone) throw new Error('clear did not start after write settled');
    const clearResult = await clearDone;

    for (let i = 0; i < 100 && FPStorage167ClearGuard.isClearing(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));

    const cachedAfter = Boolean(await cache.match(request));
    const finalMedia = FPNetwork171.snapshot().mediaCache;
    progressRoot.remove();

    return {
      cacheName: FPStorage167.cacheName,
      during,
      clearResult,
      cachedAfter,
      inFlightAfter: finalMedia.inFlight,
      clearGuardActiveAfter: FPStorage167ClearGuard.isClearing()
    };
  });

  assert.equal(result.cacheName, 'fpchat-media-v167');
  assert.equal(result.during.clearing, true);
  assert.equal(result.during.clearStarted, false);
  assert.equal(result.during.putSettled, false);
  assert(result.during.networkInFlight >= 1, JSON.stringify(result));
  assert.equal(result.clearResult.deleted, 1, JSON.stringify(result));
  assert.equal(result.cachedAfter, false, 'old task must not repopulate cache after clear');
  assert.equal(result.inFlightAfter, 0);
  assert.equal(result.clearGuardActiveAfter, false);
  assert.deepEqual(errors, []);

  console.log('PASS clear waits for FPNetwork171 authoritative in-flight write');
  console.log('PASS old task cannot repopulate cache after completed clear');
  console.log(JSON.stringify(result));
}).catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
