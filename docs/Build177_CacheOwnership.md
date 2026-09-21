# Build 177.4 — media cache ownership

This step names the existing owners; it does not introduce another cache implementation.

## Persistent cache

The encrypted media CacheStorage namespace remains:

```text
fpchat-media-v167
```

There is no second persistent `fpchat-media-v*` namespace.

## Physical mutation owner

`FPNetwork171` is the single physical mutation gate for the managed media cache.

It intercepts `Cache.prototype.put` and `Cache.prototype.delete` only for cache instances opened as `fpchat-media-v167`.

Its `mediaCacheWrites` Map is an in-flight deduplication table, not a second media store.

Existing logical callers such as `storage167.js`, `storage167-cache-fix.js` and `storage168.js` continue to call the normal CacheStorage API. Their physical writes/deletes pass through the same `FPNetwork171` gate.

## Clear ownership

The existing clear path has three non-overlapping responsibilities:

```text
FPStorage167.clearCache()
  -> selects entries/categories and maintains cache metadata

FPStorage167ClearGuard
  -> owns the exclusive clearing lifecycle, blocks/aborts media I/O and waits for in-flight work

FPNetwork171 Cache.delete gate
  -> performs/serializes the physical managed-cache delete
```

This is one clear path, not three independent cache owners.

## Compatibility

The persistent cache format/name is unchanged from Build 167/168. Existing entries in `fpchat-media-v167` are read through `FPStorage167` without migration to another CacheStorage namespace.

Build 177.4 adds no production cache, Map-backed persistent store, writer, clear algorithm, retention policy or cache format.
