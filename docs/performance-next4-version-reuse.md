# Follow-up plan item 4 — reuse loader version result

Measured: 2026-09-28

## Scope

This implements only item 4 of `docs/performance-next-steps-prompts.md`.

The change removes the second sequential startup `version.json` request by reusing the already validated loader result. Fresh checks outside startup remain network-backed.

Baseline for comparison is the corrected item 3.1 measurement, which applied the same network profile to both the page and Service Worker targets.

## Runtime change

### Loader

`public/index.html` now retains a startup version handoff only when:

- `/version.json` returned successfully;
- `build` has the accepted numeric dotted form;
- `Number(build)` is finite;
- the same build is used to produce the startup resource suffix `?v=<build>`.

The handoff is exposed through the existing `FPStartup174` coordinator as:

`versionResult: { build, resourceBuild }`

No second coordinator, owner or cache was added.

### app.js

The initial call now passes the loader result explicitly:

`checkAppVersionOnEntry({ startupVersionResult: FPStartup174.versionResult })`

Reuse is accepted only when all of the following remain true:

1. the supplied object has a valid build;
2. `resourceBuild === build`;
3. the actually loaded `app.js` URL has `?v=` equal to that resource build.

If any condition fails, startup falls back to the existing fresh:

`fetch('/version.json', { cache: 'no-store' })`

This prevents a handed-off version from being used with a differently versioned startup resource graph.

The lifecycle resume path still calls:

`checkAppVersionOnEntry()`

without a startup result. Therefore focus/foreground resume performs a new version request.

## Behavior verification

Added `scripts/regression-next4-version-reuse.cjs` and npm script `test:next:4`.

The regression confirms:

- normal startup uses exactly one logical `version.json` request;
- the handoff is frozen and matches the loaded `app.js?v=` build;
- a foreign/mismatched handoff is rejected;
- lifecycle blur→focus produces a fresh version request;
- direct `/chat/:roomId` enters the room with one startup version request;
- the real update path performs two navigations and exactly one version request per navigation;
- a broken loader JSON leaves `FPStartup174.versionResult === null` and causes one fresh app-side fallback request;
- loader failure does not pretend unversioned `app.js` belongs to the handed-off build.

Existing startup regression initially stopped on a Build 180 exact-source guard for the old `FPStartup174` literal. The runtime behavior tests before that point were green. The guard was updated only to permit the intentional `versionResult:loaderVersionResult174` field while preserving the existing dependencies/preloaded/ready/fail/execution contract.

Final verification run: `36411301150` — success.

Passed:

- `npm run test:next:4`;
- `npm run test:186:startup`;
- `npm run test:189:system-push`;
- corrected startup waterfall after the change.

The existing startup suite covers required-owner ordering, direct chat, direct invite, real update, optional-resource failure/timeout behavior and the existing boot readiness/safety behavior. The system-push browser regression remains green.

## Request count

### Saved-data startup

Before item 4:

- logical page `version.json`: **2**;
- Service Worker upstream version requests: **2**.

After item 4:

- logical page `version.json`: **1**;
- Service Worker upstream version requests: **1**.

### Real update path

The real update path contains two navigations.

Before:

- **4** version requests total: loader + app-side request on both navigations.

After:

- **2** version requests total: one loader request per navigation.

The app-side duplicate is gone; the loader request remains authoritative for the resource graph.

## Before / after — corrected item 3.1 stand

### Saved-data normal

| Boundary | Before | After | Delta |
| --- | ---: | ---: | ---: |
| wall | 346 ms | 314 ms | -32 ms |
| loader → boot-ready | 215.5 ms | 184.7 ms | -30.8 ms |
| first version | 6.4 ms | 7.1 ms | +0.7 ms |
| owners | 66.5 ms | 51.8 ms | -14.7 ms |
| second version gate | 10.7 ms | **0.1 ms** | **-10.6 ms** |
| layers | 44.7 ms | 44.0 ms | -0.7 ms |

### Saved-data slow

| Boundary | Before | After | Delta |
| --- | ---: | ---: | ---: |
| wall | 4199 ms | 4164 ms | -35 ms |
| loader → boot-ready | 3865.5 ms | 3828.0 ms | -37.5 ms |
| first version | 212.3 ms | 210.1 ms | -2.2 ms |
| owners | 1278.9 ms | 1282.9 ms | +4.0 ms |
| second version gate | **218.9 ms** | **0.3 ms** | **-218.6 ms** |
| layers | 224.1 ms | 222.7 ms | -1.4 ms |
| assets settle | 27.1 ms | 24.3 ms | -2.8 ms |
| encoded page transfer | 22.4 KiB | 22.4 KiB | unchanged |

The removed ~219 ms request was real, but the saved-startup wall improved by only 35 ms in this run. The reason is that other startup resources continue loading in parallel; removing one sequential gate moves `core-ready` earlier but does not remove the later resource/UI critical chain.

No claim of a 219 ms wall improvement is made.

### Update normal

| Boundary | Before | After |
| --- | ---: | ---: |
| total two-navigation wall | 521 ms | 447 ms |
| final loader → boot-ready | 218.8 ms | 188.4 ms |
| final second version gate | 11.9 ms | **0.5 ms** |
| total version requests | 4 | **2** |
| encoded page transfer | 44.6 KiB | 43.2 KiB |

### Update slow

| Boundary | Before | After |
| --- | ---: | ---: |
| total two-navigation wall | 6441 ms | 6657 ms |
| final loader → boot-ready | 4096.6 ms | 4515.4 ms |
| final first version | 209.2 ms | 210.4 ms |
| final owners | 1283.4 ms | 1283.5 ms |
| final second version gate | **214.8 ms** | **0.1 ms** |
| final layers | 224.0 ms | 222.9 ms |
| total version requests | 4 | **2** |
| encoded page transfer | **67.9 KiB** | **152.4 KiB** |

The slow update wall result is not attributed to the version change. The single after-run transferred more than twice as many encoded bytes as the corrected before-run. With one sample on each side, this is insufficient to label the +216 ms wall difference a regression caused by item 4.

The causal result that is stable in the trace is the disappearance of the second version gate and the reduction in request count.

## Fresh checks after resume

The startup handoff is not stored as the default source for future checks.

`handleAppResume()` still calls `checkAppVersionOnEntry()` with no startup argument.

The item-4 browser regression sends the existing lifecycle owner through blur→focus and observes one additional `version.json` request. Therefore startup reuse does not suppress a later freshness check.

## Error behavior

When the loader receives malformed version JSON:

- no startup version handoff is created;
- resources are not falsely marked with a successful version result;
- app-side startup performs the fresh `no-store` fallback;
- the application still reaches boot-ready on the isolated stand.

When a supplied handoff does not match the actual `app.js?v=` URL, reuse returns null and the fresh fallback path is selected.

## Files changed

Runtime:

- `public/index.html`;
- `public/app.js`.

Regression:

- `scripts/regression-next4-version-reuse.cjs`;
- `scripts/regression180-init-coordination.cjs` — stale exact-source guard updated for the one intentional coordinator field;
- `package.json`.

Measurement/docs:

- `docs/performance-next4-version-reuse-summary.json`;
- this report;
- `docs/performance-progress.md`.

No `sw.js`, server, database schema, RoomContext, Connection170, message/send queue owner, cache owner, gesture/layer owner or updater behavior changed.

## Limits

- Before/after performance comparison is one diagnostic run per condition, not a distribution.
- Chromium/Linux only; physical iPhone/Android remains unverified.
- Slow networking is CDP emulation applied to both page and Service Worker targets.
- The removed request has a clear phase-level effect; overall startup wall remains dominated by the owner/resource chain.
- No production deployment was performed.

## Continuation

Item 4 is complete.

Do not automatically start item 5.
