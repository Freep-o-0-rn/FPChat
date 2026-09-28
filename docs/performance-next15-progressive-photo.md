# Follow-up plan item 15 — progressive photo viewer

Date: 2026-09-28

Status: **complete**.

## Scope

Only follow-up item 15 from `docs/performance-next-steps-prompts.md` was implemented.

The existing photo viewer now:

1. immediately reuses the already-ready chat thumbnail for the selected photo;
2. keeps the existing original-media load path running;
3. waits until the original blob has been decoded;
4. swaps the same viewer `<img>` from preview to original;
5. preserves the photo geometry and existing pinch/pan state.

No new media manager, layer owner, gesture arbiter, transport owner, cache, queue or persistent store was added.

Item 16 was not started.

## Implementation

### Existing thumbnail reuse

`appendMessage()` already owns a ready decrypted thumbnail URL in the selected `.media-thumb`.

On an image click, `public/app.js` now passes a narrow `previewHint` to the existing viewer only when that thumbnail is already complete:

- media public id;
- existing `blob:` URL;
- known media width/height.

The viewer does **not** fetch the thumbnail again.

Video behavior is unchanged.

### Viewer state

`openMediaViewer134()` stores the selected-photo hint in the existing viewer state as `fpPreviewById`.

This is page-memory presentation state only.

It does not become a cache or a second media source owner.

### Preview -> original

For the active selected image, `mountSlot()` immediately mounts the existing thumbnail URL into the viewer.

The image receives the known original width/height attributes before display.

The existing photo interaction executor is bound to this same node.

The original still comes through the pre-existing chain:

`mountSlot -> loadAsset -> readEncryptedMedia174 -> FPNetwork171`

There is no second original request.

When the original blob URL is available, a temporary `Image` performs `decode()`.

Only after successful decode does the viewer change the **same** visible image node from:

`data-fp-viewer-source="preview"`

to:

`data-fp-viewer-source="original"`

and replace its `src`.

Keeping one geometry/gesture node preserves the current pinch/pan transform and avoids a layout-size change when the source changes.

### Original error

If the original fails while a valid preview is displayed:

- the preview remains visible;
- it is not replaced by a blank error box;
- an error/retry overlay is added outside the photo geometry;
- retry uses the existing `dropAsset() -> mountSlot()` path.

No retry queue was added.

## Ownership / cancellation / cleanup

The existing architecture remains authoritative.

### FPMediaManager177

Still owns viewer identity/open/close/cleanup delegation.

No competing viewer manager was created.

### FPLayer173

The existing `viewer` layer remains active.

No layer priority or layer name was changed.

### FPGesture135

Still arbitrates viewer gestures.

The existing Build-185 photo executor continues to own pinch/pan/swipe behavior.

No duplicate pointer/touch listeners or gesture owner were added.

### FPNetwork171 / FPStorage167

The original remains on the existing media request/cache path.

The progressive preview adds no `fetch`, XHR, CacheStorage access or resource-slot acquire.

The existing current/neighbor media loading policy is unchanged.

### Existing gallery cleanup

`loadAsset()`, `dropAsset()`, `pruneAssetCache()` and `navigateGallery()` were not changed.

Their frozen fingerprints after the item remain:

- `loadAsset`: `5d4db0f6e8f07849`;
- `dropAsset`: `73c987110d973502`;
- `pruneAssetCache`: `d22f05b91e20c181`;
- `navigateGallery`: `4c04706e7e9c706f`.

Only `mountSlot` changed and its regression fingerprint is now:

`fd3f520719ce2b7a`.

The existing per-asset AbortController, viewer generation checks, container/public-id checks and MediaManager close lifecycle remain the cancellation/late-result barriers.

### RoomContext

RoomContext/generation/AbortSignal ownership was not changed.

The thumbnail hint is accepted only from the already-mounted current room row.

The original media request continues to use the existing room/device/key path.

## Behavioral regression

New regression:

`scripts/regression-next15-progressive-photo.cjs`

Verified:

1. clicking a photo immediately mounts exactly the existing decrypted chat-thumbnail URL;
2. opening the viewer does not request another thumbnail;
3. selected original uses the existing single `loadAsset` request;
4. preview and original use the same gesture-owned `<img>` node;
5. untransformed `offsetWidth/offsetHeight` do not change during the swap;
6. a 2× pinch made while preview is visible survives the original swap;
7. pan still works after the original arrives;
8. closing while original is pending prevents a late result from reopening/mutating the viewer;
9. mobile horizontal swipe while loads are pending moves to the next photo and a late prior result cannot replace it;
10. original failure leaves preview visible;
11. retry re-enters the existing owner/load path and can complete to original;
12. no additional thumbnail I/O is introduced;
13. observed original-load concurrency remains within the existing current/neighbor slot behavior;
14. existing `viewer` layer and gesture owner remain active;
15. close leaves no stuck pointer lease.

## Historical item-15 CI failures

Three early runs failed due to incorrect assertions in the new test, not confirmed runtime defects:

- `36442158213`: compared transformed 2× `getBoundingClientRect()` against pre-pinch geometry; corrected to untransformed `offsetWidth/offsetHeight`;
- `36442373156`: attempted to click the desktop navigation arrow on the mobile viewport where it is intentionally hidden; corrected to the real horizontal swipe path;
- `36442675905`: expected layer name `media-viewer`; the existing `FPLayer173` contract names it `viewer`.

The third run had already passed all five new behavioral groups before that final layer-name assertion.

## Existing regressions

Final CI also passed:

- app revision contract;
- item-15 progressive-photo regression;
- media viewer lifecycle owner;
- layer contract;
- gesture/layer lifecycle;
- Build-185 photo zoom;
- media cache regression;
- Build-190 media browser regression.

## Controlled performance comparison with item 14

A second final workflow ran the **item-14 baseline commit and item-15 runtime sequentially on the same GitHub Actions runner**.

Baseline commit:

`205e07055781a31e9bc957f33d52afe8b805589c`

Item-15 runtime:

`2bf734e918dfb7e31d14d574d52a7d3256076000`

Both measurements used:

- Chromium 140.0.7339.16;
- Linux x64;
- Node 22.23.2;
- 4 vCPU AMD EPYC 7763;
- the same Playwright installation;
- the same deterministic 4032×3024 / 2,186,611 B JPEG;
- the same cache preparation;
- five samples per scenario.

Fixture equality was asserted by width, height, byte count and SHA-256:

`d462b12f3e5618e6a59d1a6deff8ef147aa3d381c80f0038a323650ccaec3f54`.

### Measurement boundary

Item 14 had no viewer-preview metric because it showed the loading state until original readiness.

For the controlled comparison:

- old item-14 original: media-tile click -> viewer original image ready;
- new item-15 preview: the **same click** -> selected viewer image is ready with `data-fp-viewer-source=preview`;
- new item-15 original: the **same click** -> same image is ready with `data-fp-viewer-source=original`.

These are DOM image readiness/decode observations, not hardware-presentation timestamps.

### Normal network

| Cache state | Item 14 original | Item 15 preview | Item 15 original | Preview earlier than old original |
| --- | ---: | ---: | ---: | ---: |
| Managed warm | 41.4 ms | **8.9 ms** | 91.9 ms | **32.5 ms** |
| Managed miss / HTTP retained | 74.6 ms | **22.9 ms** | 108.3 ms | **51.7 ms** |
| Managed miss / HTTP cold | 75.3 ms | **9.7 ms** | 109.5 ms | **65.6 ms** |

### Throttled network

Profile: 200 ms latency, ~1 Mbit/s down, ~0.5 Mbit/s up.

| Cache state | Item 14 original | Item 15 preview | Item 15 original | Preview earlier than old original |
| --- | ---: | ---: | ---: | ---: |
| Managed warm | 46.1 ms | **5.9 ms** | 96.4 ms | **40.2 ms** |
| Managed miss / HTTP retained | 295.0 ms | **6.4 ms** | 329.3 ms | **288.6 ms** |
| Managed miss / HTTP cold | 18,363.4 ms | **5.6 ms** | 18,427.0 ms | **18,357.8 ms** |

The main UX effect is therefore not faster network transfer: it is that an already available preview becomes visible almost immediately while the unchanged original request continues.

In the HTTP-cold throttled case the viewer displays preview at **5.6 ms median** instead of leaving the user on the loading state for roughly **18.36 seconds median** in this controlled run.

## Original-readiness cost

The stricter decode-before-swap adds some time before the original is declared ready.

Same-run item-15 original minus item-14 original:

| Cache state | Normal delta | Throttled delta |
| --- | ---: | ---: |
| Managed warm | +50.5 ms | +50.3 ms |
| Managed miss / HTTP retained | +33.7 ms | +34.3 ms |
| Managed miss / HTTP cold | +34.2 ms | +63.6 ms |

For the throttled HTTP-cold case the +63.6 ms delta is about **+0.3%** of the 18.4 s full-original wait.

For warm cases the relative percentage is large because the original baseline itself is only tens of milliseconds; the absolute added delay is about 34–51 ms.

This cost is a confirmed property of the current decode-before-swap implementation. No claim is made that the temporary decode is optimal or that physical mobile decode cost will match Chromium CI.

## Network/concurrency interpretation

Item 15 does not accelerate the original transfer and does not claim to.

The preview is reused from the already-loaded chat thumbnail `blob:` URL.

Therefore it adds:

- **0** new thumbnail HTTP requests;
- **0** new original HTTP requests;
- **0** new FPNetwork media admission requests;
- no increased configured current/neighbor parallelism.

The same item-14 cache states remain valid for original loading.

## Final verification

Primary functional/performance run:

`36442826065` — **SUCCESS**.

Artifact:

- id `10978968849`;
- digest `sha256:7054c5b144e23c934f82fc401a45a200c7eea1b5f071183c6952eeada4d04b92`.

Final controlled same-run comparison:

`36444021552` — **SUCCESS**.

Controlled artifact:

- id `10981050583`;
- digest `sha256:81c7f42ec92abaaeb72ada11acdbfd6ab9538d8eeaaf6cd97748da96ea1819e7`.

Controlled measurement head:

`06273904eaf8fad94ede9dc46d28922180bef21c`.

Runtime measured:

`2bf734e918dfb7e31d14d574d52a7d3256076000`.

Build remains:

**190.2**.

`public/version.json.appRevision`:

`01a8e946b71251d38838303a659e28e150d6d48a`.

## Files

Runtime:

- `public/app.js`;
- `public/media-gallery134.js`;
- `public/styles.css`;
- `public/version.json` — appRevision only.

Regression:

- `scripts/regression-next15-progressive-photo.cjs`;
- `scripts/regression177-media-viewer-lifecycle.cjs` — expected mountSlot fingerprint/comment only.

Measurement:

- `scripts/benchmark-next15-progressive-photo.cjs`;
- `scripts/compare-next15-item14.cjs`;
- `package.json`.

Documentation:

- this report;
- `docs/performance-next15-progressive-photo-summary.json`;
- `docs/performance-progress.md`.

The temporary item-15 Actions workflow is removed after the result is recorded.

## Limits

- Five samples per cache/network scenario; no p95.
- No physical iPhone/Android/PWA acceptance was performed.
- CI DOM readiness is not a physical display timestamp.
- Item 15 only reuses a preview that is already ready in the selected chat tile; it does not introduce a separate thumbnail fetch when one is unavailable.
- The item-14 cold-transfer timing is known to vary between laboratory runs; the authoritative comparison above is the same-run A/B, not the earlier cross-run numbers.
- The decode-before-swap original-readiness overhead is confirmed in Chromium CI and was not optimized further in this item.

## Rollback

Revert the item-15 changes to:

- `public/app.js`;
- `public/media-gallery134.js`;
- `public/styles.css`;
- restore the previous `appRevision`;
- remove item-15 regression/measurement/docs entries.

No database migration, cache migration, identity reset or persistent-data cleanup is required.

## Continuation

Item 15 is complete.

**Do not start item 16 automatically.**
