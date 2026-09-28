# Follow-up plan item 3 — startup mandatory-wait waterfall

Measured: 2026-09-28

## Scope

This measurement implements only item 3 of `docs/performance-next-steps-prompts.md`.

Runtime source was not changed for the measurement. The measured runtime HEAD before the temporary benchmark/CI harness was:

`1eb7a97184a307562c51525aa358450f8346ea36`

Build: **190.2**.

Successful GitHub Actions run: `36408339641`.

Artifact: `10963820289` (`next3-startup-waterfall`), digest:

`sha256:e837166c1c02b2da9cd180682149212e99ebfc9fd89f4f9517fb5015f2b0e07b`

The artifact contains the complete request waterfall JSON.

## Test model

For each network profile one Chromium context was kept alive so site identity, localStorage, service-worker registration and ordinary caches survived between runs.

Synthetic data: one locally created room with saved room access.

The sequence for each profile was:

1. prime the app and service worker;
2. saved-data reload with local build already at 190.2;
3. set local build to 190.1;
4. run the real update path: loader → owners → service worker → `checkAppVersionOnEntry` → `applyAppUpdate` → automatic reload → final startup.

No site/identity clear was used.

Network profiles:

- normal: no added latency or bandwidth limit;
- slow: CDP `Network.emulateNetworkConditions`, 200 ms latency, 125000 B/s download (~1 Mbit/s), 62500 B/s upload (~0.5 Mbit/s), `cellular3g`.

Boot boundaries come from the existing `FPBoot152.timings186()`. Request timing, transfer bytes and cache flags come from Chromium CDP Network events. The test-side snapshotter only copies existing boot evidence across the update-triggered reload.

## Timeline

### Saved-data startup

| Phase | Normal | Slow |
| --- | ---: | ---: |
| wall to completed measurement | 341 ms | 3997 ms |
| loader → boot-ready | 210.2 ms | 3655.9 ms |
| first `version.json` duration | 4.2 ms | 6.9 ms |
| version-ready → owners-ready | 66.1 ms | **1291.2 ms** |
| service-worker register wait | 8.0 ms | 0.9 ms |
| second version/update gate | 9.6 ms | 12.7 ms |
| core-ready → boot-ready owner start | 57.5 ms | **2096.5 ms** |
| layers-start → layers-end | 41.2 ms | 223.4 ms |
| assets-start → assets-end | 22.0 ms | 22.8 ms |

`core-ready → boot-ready owner start` is a derived interval between existing marks `core-ready` and `core-wait-start`. It is not a new runtime metric and is not added to other nested durations.

### Update startup

The update scenario has two navigations.

#### Normal

First navigation, which detects the newer build:

- first version: 4.5 ms;
- version-ready → owners-ready: 58.1 ms;
- service worker: 3.5 ms;
- update-start → update-ready: 27.1 ms;
- then the real update path reloads.

Second/final navigation:

- first version: 3.7 ms;
- version-ready → owners-ready: 57.2 ms;
- service worker: 2.5 ms;
- second version/update gate: 7.1 ms;
- core-ready → boot-ready owner start: 70.3 ms;
- layers: 40.7 ms;
- final asset settle: 28.4 ms;
- final loader → boot-ready: 211.9 ms.

Total wall for the two-navigation update path: **503 ms**.

#### Slow

First navigation, which detects the newer build:

- first version: 4.1 ms;
- version-ready → owners-ready: **1284.3 ms**;
- service worker: 2.0 ms;
- update-start → update-ready: 24.3 ms;
- then reload.

Second/final navigation:

- first version: 3.9 ms;
- version-ready → owners-ready: **1286.2 ms**;
- service worker: 1.7 ms;
- second version/update gate: 11.7 ms;
- core-ready → boot-ready owner start: **2768.0 ms**;
- layers: 225.2 ms;
- final asset settle: 20.3 ms;
- final loader → boot-ready: 4318.5 ms.

Total wall for the two-navigation update path: **6280 ms**.

## Second version.json request

There are exactly two startup `version.json` requests per navigation:

1. loader request in `index.html`;
2. `checkAppVersionOnEntry()` request in `app.js`, after owners and service-worker registration.

Measured start-to-start delay:

| Scenario/navigation | Delay before second request | Second request duration |
| --- | ---: | ---: |
| saved normal | **78.3 ms** | 6.9 ms |
| saved slow | **1298.9 ms** | 10.8 ms |
| update detection nav, normal | **66.1 ms** | 10.1 ms |
| update final nav, normal | **63.6 ms** | 4.6 ms |
| update detection nav, slow | **1290.4 ms** | 9.1 ms |
| update final nav, slow | **1291.8 ms** | 9.5 ms |

All observed `version.json` responses were marked by CDP as `fromServiceWorker=true`, `fromDiskCache=false`, with zero encoded network body bytes.

Therefore the large slow-network number associated with the “second version request” is **not its own transfer duration**. The request itself is ~9–11 ms in this stand. Its start is delayed by the required owner chain; it is invoked only after `FPStartup174.ready` and service-worker registration.

Eliminating the duplicate request alone would remove only the small second-request/gate duration in this laboratory run, not the ~1.29 s owner wait.

## Request and transfer summary

| Scenario | Requests | Encoded transfer | Explicit SW responses | Explicit disk-cache responses |
| --- | ---: | ---: | ---: | ---: |
| saved normal | 95 | 30.2 KiB | 2 | 0 |
| saved slow | 92 | 22.4 KiB | 2 | 0 |
| update normal, both navigations | 152 | 44.1 KiB | 4 | 0 |
| update slow, both navigations | 138 | **140.9 KiB** | 4 | 0 |

For the update runs:

- normal first navigation: 13.6 KiB; second navigation: 30.5 KiB;
- slow first navigation: 10.9 KiB; second navigation: **130.0 KiB**.

The slow update final navigation transferred large script bodies including:

- `voice.js`: ~63.4 KiB encoded;
- `message-context.js`: ~32.6 KiB encoded;
- `swipe-fix.js`: ~14.6 KiB encoded.

No response in these four traces was explicitly marked `fromDiskCache=true`. Many warm static requests transferred only a few hundred encoded bytes despite much larger source files. That is cache/revalidation-like evidence, but this capture does not distinguish browser memory cache from all revalidation paths. It must not be described as proven disk-cache use.

The localhost Chromium cache behavior is laboratory evidence only; it does not establish production Cloudflare/browser cache policy.

## Resource evidence around the mandatory waits

On saved slow startup, before `owners-ready`, long asset observations included:

- `network171.js`: ~675 ms;
- `text-send170.js`: ~120 ms;
- the required late send-owner chain reaches `media-send170.js` just as `owners-ready` is emitted.

After `core-ready`, before `boot-ready152` begins its readiness checks, a second resource chain dominates:

- `boot-ready152.js`: ~813 ms;
- `media-gallery134.js`: ~802 ms;
- `viewport-layout136.js`: ~754 ms;
- `gesture-manager135.js`: ~664 ms;
- `system-chat144.js`: ~634 ms;
- `global-search156.js`: ~622 ms;
- `build165-ui.js`: ~610 ms.

These durations overlap and are not summed.

On the slow update final navigation the post-update cold-ish resource path is even clearer: `voice.js`, `message-context.js` and `swipe-fix.js` carry substantial encoded bytes, while the derived `core-ready → core-wait-start` interval reaches 2768 ms.

## Conclusion for the next decision

The duplicate second `version.json` is real, but in this measurement it is **not a major startup bottleneck**:

- its actual request duration is only ~5–11 ms;
- service-worker registration is ~1–8 ms;
- slow startup is dominated by owner/resource chains measured in hundreds to thousands of milliseconds.

This evidence therefore points toward follow-up **item 5** (remove one proven nonessential startup wait) as the higher-impact next investigation, not item 4. This document does **not** execute item 5 or select a specific dependency to remove; that requires its own prompt and proof.

## Limits

- One run per requested scenario, as item 3 specifies; these values are diagnostic timelines, not distribution statistics.
- Chromium/Linux only; no physical iPhone/Android acceptance.
- Request byte accounting uses CDP `encodedDataLength`.
- Service-worker/cache flags are Chromium observations from this isolated localhost stand.
- Nested startup phases overlap; they are attribution boundaries and are not added together.
