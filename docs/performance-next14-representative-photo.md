# Follow-up plan item 14 — representative photo/cache baseline

Date: 2026-09-28

Status: **complete — measurement-only item; runtime unchanged**.

## Scope

This item only improves the media performance stand.

It replaces the non-representative assumption from the original Step 4 media measurement, which used the repository's 512×512 application icon, with one deterministic synthetic JPEG whose dimensions and payload are in the range of a phone photo.

No application runtime, media owner, cache owner, viewer, server route, database schema, Service Worker, updater or build number was changed.

The next behavioral item (15) was not started.

## Fixed non-personal photo fixture

The fixture is generated deterministically inside the browser benchmark and uploaded through the existing media-send path.

It contains only programmatically generated landscape-like pixels; it is not a photograph of a person and is not downloaded from an external source.

Parameters:

- file: `next14-phone-photo.jpg`;
- dimensions: **4032×3024 px**;
- resolution: **12.2 MP**;
- format: **JPEG / image/jpeg**;
- encoder quality: **0.92**;
- plaintext file size: **2,186,611 B = 2.1 MiB**;
- encrypted server size: **2,186,639 B**;
- SHA-256 of the generated JPEG: `d462b12f3e5618e6a59d1a6deff8ef147aa3d381c80f0038a323650ccaec3f54`.

The server-recorded width, height, MIME type and plaintext size matched the generated fixture.

This is representative in resolution and payload scale only. It is not intended to model the compression characteristics of every phone/camera.

## Measurement environment

- Chromium 140.0.7339.16;
- Linux x64;
- Node.js 22.23.2;
- 4 vCPU, AMD EPYC 7763;
- isolated local FPChat server and SQLite;
- 5 samples per scenario;
- physical iPhone/Android: **not measured**.

Network profiles:

- normal: no added latency/bandwidth shaping;
- throttled: CDP `Network.emulateNetworkConditions`, 200 ms latency, 125000 B/s download (~1 Mbit/s), 62500 B/s upload (~0.5 Mbit/s), `cellular3g`.

No p95 is reported for five samples.

## Cache states are separated

All three states use the same room, media and device identity.

### 1. Managed warm

Preparation:

1. preview and original are loaded once through the real FPChat media path;
2. `FPStorage167` managed image CacheStorage remains populated;
3. root navigation removes gallery JS/RAM asset state;
4. browser HTTP cache is left untouched.

Expected/verified evidence:

- `FPRuntime169.loading` reports managed `hit` for preview and original;
- no media HTTP request is emitted during the measured preview/original reads.

### 2. Managed miss, HTTP cache retained

Preparation:

1. the same media is primed;
2. root navigation removes gallery JS/RAM state;
3. only managed image cache is cleared through `FPStorage167.clearCache(['image'])`;
4. browser HTTP cache is not cleared.

Expected/verified evidence:

- managed cache reports `miss`;
- media request reaches HTTP;
- the server/browser exchange is conditional revalidation with **304**;
- only a few hundred encoded wire bytes are transferred per request.

This state specifically proves that "managed cache missing" is not equivalent to "HTTP cache cold".

### 3. Managed miss, HTTP cache cold

Preparation:

1. root navigation removes gallery JS/RAM state;
2. managed media cache is cleared through its existing owner;
3. CDP `Network.clearBrowserCache` clears the browser HTTP cache;
4. local identity is checked again before measurement.

Expected/verified evidence:

- managed cache reports `miss`;
- preview/original requests return **200**;
- CDP reports neither `requestServedFromCache` nor `fromDiskCache`;
- full encrypted media bytes cross the HTTP boundary.

No localStorage/site identity clear is performed.

## Identity preservation

The benchmark compares the same existing values after cache preparation:

- device identity;
- room device identity;
- room secret.

Result:

**32/32 identity checks passed.**

The output records only the boolean/check count, not those identifiers or secret values.

## Measurement endpoints

Preview and original are measured separately.

### Preview

Start:

**immediately before `openChat(roomId)`.**

End event:

the target chat thumbnail element `img.media-thumb` is:

- present;
- `complete === true`;
- `naturalWidth > 0`.

Metric:

`previewReadyMs`.

This measurement therefore includes the normal chat-open/join/render path before the thumbnail becomes decoded/ready.

### Original

Start:

**immediately before clicking the target media tile.**

End event:

the viewer's `.media-viewer-content img` is:

- present;
- `complete === true`;
- `naturalWidth > 0`.

Metric:

`originalReadyMs`.

These are DOM image readiness/decode observations. They are **not** hardware display/presentation timestamps.

The current viewer does not yet mount the already-available chat thumbnail as an immediate viewer preview. That behavior belongs to item 15 and was intentionally not implemented here.

## Results

### Normal network

| Cache state | Preview median | Preview range | Original median | Original range |
| --- | ---: | ---: | ---: | ---: |
| Managed warm | **134.8 ms** | 134.2–136.2 | **41.0 ms** | 40.7–64.4 |
| Managed miss, HTTP retained | **131.2 ms** | 126.8–173.5 | **61.9 ms** | 59.6–74.6 |
| Managed miss, HTTP cold | **131.7 ms** | 130.7–143.3 | **74.0 ms** | 62.6–107.6 |

### Throttled network

| Cache state | Preview median | Preview range | Original median | Original range |
| --- | ---: | ---: | ---: | ---: |
| Managed warm | **665.1 ms** | 649.4–698.4 | **48.8 ms** | 45.5–62.3 |
| Managed miss, HTTP retained | **697.2 ms** | 695.9–697.3 | **296.6 ms** | 295.0–297.5 |
| Managed miss, HTTP cold | **794.8 ms** | 778.8–795.5 | **44,293.9 ms** | 18,329.3–44,345.6 |

The high throttled preview number even for managed hits is expected from the metric boundary: preview timing starts before `openChat`, so it includes join/open work affected by the throttled network. The actual preview media request is absent in the managed-warm runs.

## Cache/network evidence

### Managed warm

Across five samples per network profile:

- preview managed cache: hit 5/5;
- original managed cache: hit 5/5;
- preview HTTP requests: 0;
- original HTTP requests: 0;
- media encoded bytes: 0.

### Managed miss, HTTP retained

Across five samples per profile:

- preview managed cache: miss 5/5;
- original managed cache: miss 5/5;
- preview HTTP status: 304;
- original HTTP status: 304.

Five-sample total encoded wire bytes:

- preview: **1,325 B**;
- original: **1,340 B**.

This is conditional HTTP-cache validation, not a managed cache hit.

### Managed miss, HTTP cold

Across five samples per profile:

- preview managed cache: miss 5/5;
- original managed cache: miss 5/5;
- preview HTTP status: 200;
- original HTTP status: 200;
- direct browser cache flags: none.

Five-sample full-transfer totals:

- preview: **15,645 B**, 3,129 B per sample;
- original: **10,934,810 B**, 2,186,962 B per sample.

## Throttled HTTP-cold variability

The raw original-ready values are:

`18,329.3, 44,293.9, 44,345.6, 18,329.6, 44,326.5 ms`.

The same full encrypted byte count was observed in all five samples, but the wall timings form two clusters around 18.3 s and 44.3 s.

This variation is **confirmed**.

Its cause is **not established by item 14**. No claim is made that AES, media-slot admission, SQL, the application cache writer, Chromium CDP throttling, or another specific subsystem caused the two clusters.

The median **44.3 s** is therefore a measured result of this laboratory profile, not a prediction for a physical mobile device or production network.

## Comparison with the original Step 4 media baseline

Original Step 4 used `public/icons/icon-512x512.png` and its "cold" mode cleared only the FPStorage167 managed media cache.

Therefore its throttled cold-photo median of **856 ms** did **not** represent a fully HTTP-cold phone-size original.

Item 14 does not invalidate the old value; it narrows what that value meant.

The new stand explicitly distinguishes:

- managed hit;
- managed miss with HTTP cache retained/revalidated;
- managed miss with HTTP cache also cold.

## Runtime / ownership

No runtime source was changed.

Existing ownership is preserved:

- `FPNetwork171`: media network/cache mutation owner;
- `FPStorage167`: managed media cache API;
- `FPMediaManager177`: viewer/media lifecycle owner;
- `media-gallery134`: existing gallery executor;
- `FPRuntime169`: passive bounded observer only.

The benchmark uses `FPRuntime169.loading` only to read existing managed-cache evidence. It adds no global runtime interception.

CDP network observation exists only in the external benchmark process.

## Verification

GitHub Actions run:

`36438896836` — **SUCCESS**

Measured head:

`c0ed25f8162abc6d7cbdb6d4bb58780d9420bea8`

Runtime under measurement:

`43d05dbffe20f2bff779f9683aaf194b3f4e0cd2`

Build:

**190.2**

Passed before the benchmark:

- benchmark syntax;
- `test:186:media-cache`;
- `test:177:media-viewer-lifecycle`;
- `test:185:browser`;
- `test:190:browser`.

Artifact:

- id: `10977112464`;
- digest: `sha256:f4d2ac974c7f89852bdf7c88434107e14016828c108b39ed00ffd4442bd9fc0a`.

No browser page errors were reported by the benchmark.

## Files

Measurement:

- `scripts/benchmark-next14-photo-cache.cjs`;
- `package.json`.

Documentation:

- this report;
- `docs/performance-next14-representative-photo-summary.json`;
- `docs/performance-progress.md`.

The temporary GitHub Actions workflow used to execute the isolated stand is removed after recording the result.

No `public/*`, server/runtime, database/schema, Service Worker or updater file is part of the final item-14 change.

## Rollback

Remove the item-14 benchmark, its npm script and item-14 documentation.

There is no runtime rollback, cache migration or user-data cleanup because item 14 changes no application behavior.

## Continuation

Item 14 is complete.

**Do not start item 15 automatically.**
