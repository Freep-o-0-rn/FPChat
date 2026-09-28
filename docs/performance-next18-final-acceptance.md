# Follow-up plan item 18 — final comparison and device acceptance

Date: 2026-09-28

Status: **complete for the isolated Chromium/Linux stand; physical iPhone/Android acceptance is not executed**.

## Scope

This is follow-up item **18** from `docs/performance-next-steps-prompts.md`.

The affected performance scenarios were repeated on the current branch/runtime and the related existing regressions were run again.

No application runtime behavior was changed by item 18.

One measurement-only defect discovered during final acceptance was corrected:

- `scripts/benchmark-next16-reconnect.cjs` natural outage was still 2.5 s;
- the historical Step 4 outage was 10 s;
- item 18 changed only that benchmark wait to 10 s and records actual `offlineMs`.

No production deployment was performed.

## Current runtime under acceptance

- build: **190.2**;
- runtime commit: `2bf734e918dfb7e31d14d574d52a7d3256076000`;
- application behavior under test is the same item-15 runtime used by items 15–17.

## Regression acceptance

Primary final acceptance workflow:

`36451711515` — **SUCCESS**

Artifact:

- id: `10983859611`;
- digest: `sha256:385bbe3fc66c715386d7cea3fa35e5db8e753849c57d00f827893dd07fa9a01b`.

Related existing regressions rerun successfully:

- startup/version/cache:
  - `test:next:4`;
  - `test:next:7`;
  - `test:next:8`;
  - `test:next:9`;
- input/send:
  - `test:next:2`;
  - `test:177:send-manager`;
  - `test:178:message-render-owner`;
- history/reopen:
  - `test:next:11`;
  - `test:next:12`;
  - `test:next:13`;
  - `test:178:history-saved-anchor`;
  - `test:178:unread-restore-bottom`;
  - `test:178:history-page-owner`;
- media/gestures:
  - `test:next:15`;
  - `test:177:media-viewer-lifecycle`;
  - `test:178:gesture-layer-lifecycle`;
  - `test:185:browser`;
  - `test:186:media-cache`;
  - `test:190:browser`;
- connection ownership:
  - `check:170`;
  - `test:180:single-owner-audit`;
- reactions:
  - `regression1884-reaction-interaction.cjs`.

No new runtime defect was confirmed by this regression pass.

## Startup — before / current repeat

A separate startup acceptance was repeated on the current runtime.

Workflow:

`36453900608` — **SUCCESS**

Artifact:

- id: `10984886207`;
- digest: `sha256:eb10de9a94d09d39f7f829d0043ab41923d19b523ecc14681f352424e57ced1e`.

### Structural result

The key item-4 optimization remains present:

| Scenario | Historical pre-item-4 version requests | Current item-18 version requests | Historical pre-item-4 second-version gate | Current gate |
| --- | ---: | ---: | ---: | ---: |
| Saved / normal | 2 | **1** | 10.7 ms | **0.2 ms** |
| Saved / slow | 2 | **1** | 218.9 ms | **0.2 ms** |
| Update / normal, two navigations | 4 | **2** | 11.9 ms | **0.1 ms** |
| Update / slow, two navigations | 4 | **2** | 214.8 ms | **0.2 ms** |

Current wall-time samples:

| Scenario | Historical pre-item-4 wall | Current item-18 wall |
| --- | ---: | ---: |
| Saved / normal | 346 ms | 366 ms |
| Saved / slow | 4199 ms | 4199 ms |
| Update / normal | 521 ms | 503 ms |
| Update / slow | 6441 ms | 6549 ms |

These wall values are single diagnostic runs and are **not** evidence of a general wall-time speedup. The confirmed result is removal of the duplicate logical version request/gate; wall time is dominated by other startup work and transfer variability.

Current saved-slow owner wait remains about **1278.6 ms**, so startup still has substantial owner/resource latency outside the removed duplicate version request.

## Room open / history — before / current repeat

The current room-open benchmark repeated the same 1500-message fixture and slow network profile used by item 10/12.

Five samples per scenario.

| Scenario | Item-10 baseline median | Item-18 current median | Difference |
| --- | ---: | ---: | ---: |
| Tail/end | 964.8 ms | **965.2 ms** | +0.4 ms |
| Saved anchor | 2131.4 ms | **1430.3 ms** | **-701.1 ms (-32.89%)** |
| First unread | 2044.5 ms | **1397.7 ms** | **-646.8 ms (-31.64%)** |

Acceptance:

- saved anchor target mounted: **5/5**;
- saved anchor `hasNewer`: **5/5**;
- first unread target mounted: **5/5**;
- first unread ID matched: **5/5**;
- no page errors.

The tail path remains intentionally essentially unchanged.

### Remaining history issue

The benchmark still observes **three no-cursor `GET /messages?limit=100` requests per room open** from existing post-open sync/reconnect behavior.

This was already identified after item 12 and remains unresolved.

It is not counted as the initial target-window hydration that item 12 optimized.

## Same-session reopen

Five first-open/reopen pairs were repeated.

Current:

- first open median: **182.5 ms**, 100 decrypts;
- repeat same-session open median: **137.4 ms**, 0 decrypts;
- delta: **-45.1 ms / -24.71%**.

All five repeat opens used 0 message decrypt calls and retained 100 mounted tail messages.

Earlier item-13 run:

- first open: 184.0 ms;
- repeat open: 136.5 ms;
- delta: -47.5 ms / -25.82%.

The repeat therefore remains consistent with the item-13 result.

This reuse remains RAM-only and disappears on page reload.

## Media — controlled before / after on the same runner

Item 14 baseline and item 15 progressive viewer were rerun sequentially on the same GitHub runner.

Common fixture:

- 4032×3024;
- 2,186,611 B;
- SHA-256 `d462b12f3e5618e6a59d1a6deff8ef147aa3d381c80f0038a323650ccaec3f54`;
- 5 samples per state.

Environment:

- Chromium 140.0.7339.16;
- Linux x64;
- Node 22.23.2;
- Intel Xeon Platinum 8573C;
- 4 vCPU.

### Normal

| Cache state | Before: original-only viewer | Current: viewer preview | Current original |
| --- | ---: | ---: | ---: |
| Managed warm | 41.2 ms | **9.7 ms** | 91.1 ms |
| HTTP retained | 58.8 ms | **18.0 ms** | 93.0 ms |
| HTTP cold | 57.9 ms | **8.4 ms** | 109.2 ms |

### Throttled

| Cache state | Before: original-only viewer | Current: viewer preview | Current original |
| --- | ---: | ---: | ---: |
| Managed warm | 33.3 ms | **5.7 ms** | 79.6 ms |
| HTTP retained | 294.6 ms | **5.7 ms** | 361.3 ms |
| HTTP cold | 44,276.2 ms | **5.7 ms** | 18,394.8 ms |

The confirmed product result is that the already-ready photo preview is available almost immediately instead of waiting for the original.

Do **not** interpret the HTTP-cold original 44.3 s -> 18.4 s difference as a new transfer speedup. The phone-size cold-original benchmark has repeatedly shown two timing clusters around ~18 s and ~44 s; their cause remains unestablished.

The original is still decoded before preview->original swap, which adds tens of milliseconds in warm/retained cases in exchange for stable geometry and a ready source.

Media regressions continue to confirm:

- no extra thumbnail I/O;
- same image node/geometry across swap;
- pinch before original;
- pan after original;
- close/navigation while original is pending;
- original-error preview fallback/retry;
- Build-190 video/photo behavior.

## Reconnect — corrected 10-second acceptance

During item 18, the benchmark itself was found to still use a 2.5 s natural outage. This was corrected to the historical **10 s** duration.

Corrected workflow:

`36453355336` — **SUCCESS**

Artifact:

- id: `10984156959`;
- digest: `sha256:3a199cee586f5bffd49f3b95d8321f6c7f82378b1adef1da096065027986b126`.

Actual natural-offline durations:

- normal: 10005–10007 ms;
- throttled: 10004–10007 ms.

### Natural outage

| Profile | Attempts | Old socket actually broke | Live socket preserved | Reconnect result |
| --- | ---: | ---: | ---: | ---: |
| Normal | 5 | 0 | **5/5** | **null** |
| Throttled | 5 | 0 | **5/5** | **null** |

A live socket is not renamed to reconnect.

### Confirmed break while offline

| Profile | Confirmed breaks | Automatic recoveries | Reconnect median |
| --- | ---: | ---: | ---: |
| Normal | **5/5** | **5/5** | **16 ms** |
| Throttled | **5/5** | **5/5** | **465 ms** |

The explicit break mechanism is still raw `WebSocket.close` because this Chromium build does not expose CDP `Network.closeConnections`.

The observer never calls `ensureConnected()`.

Network-profile probe:

- normal median: 3.9 ms;
- throttled median: 229.0 ms;
- added median: +225.1 ms;
- requested profile verified effective.

Historical Step-4 reconnect values are **not** used as a latency before/after because that old observer called `ensureConnected()` itself.

## Send and reaction — repeated current metrics

Five attempts per action/profile were repeated.

### Send

| Profile | Success | Manager state | DOM | rAF opportunity | ACK |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal | **5/5** | 0.7 ms | 2.4 ms | 12.6 ms | 4.6 ms |
| Throttled | **5/5** | 0.6 ms | 2.2 ms | 12.3 ms | 33.0 ms |

Historical Step 4 throttled send was 3/5 with two `optimistic-timeout` failures.

Those timeouts did not reproduce here, but this does not prove they can never recur.

### Reaction

| Profile | Success | Manager state | Target pill DOM | rAF opportunity | ACK |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal | **5/5** | 0.6 ms | 0.6 ms | 10.5 ms | 3.7 ms |
| Throttled | **5/5** | 0.9 ms | 0.9 ms | 1.8 ms | 223.1 ms |

Historical/new ACK fields have different boundaries and must not be converted into claimed speedup percentages.

`requestAnimationFrame` is only a browser frame callback opportunity. It is not hardware presentation.

## Physical-device acceptance

No physical iPhone or Android device is attached to this environment.

Therefore the following are explicitly **NOT EXECUTED**:

| Device | Input | History | Media | Real background/return |
| --- | --- | --- | --- | --- |
| iPhone | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |
| Android | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED | NOT EXECUTED |

Desktop/headless Chromium and mobile viewport emulation are not substitutes for physical-device acceptance.

### Short manual device scenario

Run the same four blocks once on iPhone and once on Android:

1. **Input**
   - open a normal 1:1 chat;
   - send 5 different text messages quickly;
   - send the next message immediately after the previous ACK;
   - add and remove one reaction;
   - expected: no stuck composer, no duplicate text, all five messages appear once and statuses progress, reaction pill updates.

2. **History**
   - use a long chat;
   - stop at a non-bottom message, leave to chat list, reopen;
   - then create unread messages and reopen again;
   - expected: saved position/offset returns without jumping to bottom; first unread is correct; same-session reopen still performs access check and displays current data.

3. **Media**
   - open a normal phone photo;
   - expected: preview appears immediately and is replaced by sharp original without geometry jump;
   - pinch/zoom and pan;
   - while another original is loading, swipe to the next media and separately test close;
   - expected: no stale image replacement, stuck viewer or dead gestures; video play badge remains video-only.

4. **Real background**
   - with the chat open, actually switch to Home/another app for about 30 seconds, then return;
   - repeat once while media or a send is in flight if practical;
   - expected: same room/reading position remains correct; synchronization/reconnect occurs automatically if the socket really broke; no duplicate message/reaction and no dead touch/gesture state.

A physical pass must not be recorded until these steps are performed on each device.

## Successful-attempt summary

Measured acceptance attempts in the final item-18 runs:

- room-open saved anchor target: **5/5**;
- room-open first unread target/ID: **5/5**;
- same-session reopen: **5/5**;
- progressive media: **5/5 per cache/network scenario**;
- natural reconnect classification: **10/10** correctly retained as live-connection outcomes with reconnect `null`;
- confirmed-break automatic recovery: **10/10**;
- send: **10/10**;
- reaction: **10/10**;
- reaction cleanup: **10/10**;
- physical iPhone acceptance: **0 executed**;
- physical Android acceptance: **0 executed**.

Five-sample benchmark groups do not support p95.

## Remaining defects / unresolved observations

Confirmed remaining items:

1. **Three post-open no-cursor latest-page requests**
   - `GET /messages?limit=100` is still observed three times per room open from existing sync/reconnect behavior.

2. **Cold phone-photo original timing has two clusters**
   - ~18 s and ~44 s under the synthetic throttled profile;
   - cause remains unknown.

3. **Decode-before-swap costs original-ready time**
   - tens of milliseconds in warm/retained media cases;
   - current tradeoff favors immediate preview + stable geometry.

4. **Same-session MessageStore reuse is RAM-only**
   - reload loses it;
   - exact media metadata mismatch causes safe whole-window fallback.

5. **Natural Chromium offline does not prove a physical reconnect**
   - even after ~10 s the old socket stayed logically open in 10/10 natural samples;
   - confirmed-break recovery is therefore a separate harness scenario.

6. **Physical mobile acceptance is still missing**
   - especially real background suspension/resume and the historical first-open photo gesture issue;
   - CI photo-zoom regressions pass, but this is not physical proof.

7. **rAF is not physical display timing**
   - no hardware presentation timestamp was measured.

8. **No production/Cloudflare Tunnel performance acceptance**
   - all final benchmarks are isolated CI/local-server measurements.

## Ownership / architecture check

No ownership changes were made by item 18.

Preserved:

- `FPRoomContext170` generation/AbortSignal;
- `FPConnection170` single WebSocket owner;
- `FPSyncCoordinator176` thin sync adapter;
- `FPNetwork171` / `FPStorage167` cache/network ownership;
- `FPMessageStore172` canonical message state;
- `FPHistory174` history range;
- `FPScroll173` scroll geometry;
- `FPSendManager177` stateless dispatcher + existing text-send queue owner;
- `FPReactionManager188` / renderer / arbiter;
- `FPMediaManager177`, `FPLayer173`, `FPGesture135`;
- `FPRuntime169` remains passive.

## Files changed by item 18

Measurement:

- `scripts/benchmark-next16-reconnect.cjs` — natural outage aligned to 10 seconds and actual offline duration recorded.

Documentation:

- this report;
- `docs/performance-next18-final-acceptance-summary.json`;
- `docs/performance-progress.md`.

Temporary item-18 GitHub Actions workflows are removed after preserving results.

No `public/*`, server runtime, database/schema, Service Worker or updater file was changed.

## Rollback

Item 18 introduced no production behavior.

To roll back its repository changes:

- restore the previous item-16 benchmark natural-outage duration/result fields if desired;
- remove item-18 report/summary/progress entry.

No runtime rollback, database migration, cache migration, identity reset or production action is required.

## Final status

The isolated Chromium/Linux performance series acceptance is green for the repeated scenarios above.

Physical iPhone/Android acceptance remains **not executed** and is a separate manual acceptance dependency.

No production deployment was performed.
