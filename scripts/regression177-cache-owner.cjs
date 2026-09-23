'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const files = fs.readdirSync(publicDir).filter((name) => name.endsWith('.js')).sort();
const sources = Object.fromEntries(files.map((name) => [name, fs.readFileSync(path.join(publicDir, name), 'utf8')]));

const mediaCacheNames = new Set();
for (const source of Object.values(sources)) {
  for (const match of source.matchAll(/fpchat-media-v\d+/g)) mediaCacheNames.add(match[0]);
}
assert.deepEqual([...mediaCacheNames].sort(), ['fpchat-media-v167'], 'there must be one persistent encrypted-media CacheStorage namespace');

const network = sources['network171.js'];
const storage = sources['storage167.js'];
const cacheFix = sources['storage167-cache-fix.js'];
const storage168 = sources['storage168.js'];
const clearGuard = sources['storage167-clear-guard.js'];

assert(network.includes("const MEDIA_CACHE_NAME = 'fpchat-media-v167';"), 'FPNetwork171 media cache name mismatch');
assert(network.includes('const mediaCacheWrites = new Map();'), 'FPNetwork171 in-flight write gate missing');
assert(network.includes('cacheProto.put = function fpMediaCache171Put'), 'FPNetwork171 physical put gate missing');
assert(network.includes('cacheProto.delete = async function fpMediaCache171Delete'), 'FPNetwork171 physical delete gate missing');
assert(network.includes('await nativeCachePut.call(cache, request, response);'), 'FPNetwork171 must own the physical managed-cache put');
assert(network.includes('await nativeCacheDelete.call(this, request, options);'), 'FPNetwork171 must own the physical managed-cache delete');

for (const [name, source] of [
  ['storage167.js', storage],
  ['storage167-cache-fix.js', cacheFix],
  ['storage168.js', storage168]
]) {
  assert(source.includes("'fpchat-media-v167'"), name + ' must keep the existing cache namespace');
}
assert(storage.includes('async function clearCache(kinds, onProgress)'), 'FPStorage167 clear policy entry missing');
assert(storage.includes('clearCache,'), 'FPStorage167 must expose clearCache');
assert(clearGuard.includes('window.FPStorage167ClearGuard = Object.freeze'), 'clear lifecycle guard missing');
assert(clearGuard.includes('isClearing: () => clearingActive'), 'clear lifecycle state owner missing');

console.log('PASS one persistent encrypted-media CacheStorage namespace: fpchat-media-v167');
console.log('PASS FPNetwork171 is the physical Cache.put/delete mutation gate');
console.log('PASS FPStorage167 owns clear selection/meta policy; FPStorage167ClearGuard owns clear exclusivity');

run(async ({ newClient, origin, errors }) => {
  const legacyUrl = origin + '/api/media/legacy1774/blob?deviceId=legacy-device';
  const legacyBody = 'legacy-cache-body-1774';

  // Seed the managed cache before the application and network171 are loaded.
  const page = await newClient(async (page) => {
    await page.goto(origin + '/version.json');
    await page.evaluate(async ({ legacyUrl, legacyBody }) => {
      const cache = await caches.open('fpchat-media-v167');
      await cache.put(
        new Request(legacyUrl, { method:'GET', credentials:'same-origin' }),
        new Response(legacyBody, {
          status:200,
          headers:{'Content-Type':'application/octet-stream','Content-Length':String(legacyBody.length)}
        })
      );
    }, { legacyUrl, legacyBody });
  });

  const result = await page.evaluate(async ({ legacyUrl, legacyBody }) => {
    const ownerBefore = FPNetwork171.snapshot();
    const statsBefore = await FPStorage167.getStats();

    const response = await fetch(legacyUrl);
    const body = await response.text();

    const cache = await caches.open(FPStorage167.cacheName);
    const stillCachedBeforeClear = Boolean(await cache.match(legacyUrl));

    const deletesBefore = FPNetwork171.snapshot().mediaCache.deletes;
    const clearResult = await FPStorage167.clearCache(['file']);
    const afterClear = FPNetwork171.snapshot();
    const cachedAfterClear = Boolean(await cache.match(legacyUrl));

    return {
      cacheName: FPStorage167.cacheName,
      owner: ownerBefore.owner,
      physicalFormat: ownerBefore.mediaCache.format,
      entryCountBefore: statsBefore.entryCount,
      body,
      bodyMatches: body === legacyBody,
      stillCachedBeforeClear,
      clearResult,
      deleteDelta: afterClear.mediaCache.deletes - deletesBefore,
      cachedAfterClear,
      clearGuardPresent: Boolean(FPStorage167ClearGuard),
      clearGuardActiveAfter: FPStorage167ClearGuard.isClearing()
    };
  }, { legacyUrl, legacyBody });

  assert.equal(result.cacheName, 'fpchat-media-v167');
  assert.equal(result.owner, 'FPNetwork171');
  assert.equal(result.physicalFormat, 'fpchat-media-v167');
  assert(result.entryCountBefore >= 1, JSON.stringify(result));
  assert.equal(result.bodyMatches, true, 'pre-Build-177 cache entry must remain readable');
  assert.equal(result.stillCachedBeforeClear, true);
  assert.equal(result.clearResult.deleted, 1, JSON.stringify(result));
  assert.equal(result.deleteDelta, 1, 'FPStorage167 clear must pass through FPNetwork171 physical delete gate');
  assert.equal(result.cachedAfterClear, false);
  assert.equal(result.clearGuardPresent, true);
  assert.equal(result.clearGuardActiveAfter, false);
  assert.deepEqual(errors, []);

  console.log('PASS cache data seeded before app startup is readable by current storage path');
  console.log('PASS FPStorage167 clear deletes the old entry through FPNetwork171 exactly once');
  console.log(JSON.stringify(result));
}).catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
