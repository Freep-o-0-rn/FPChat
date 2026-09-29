# Follow-up item 19 — existing loading report for real-device manual measurements

Date: 2026-09-29

Branch: `optimization/performance-item19-real-device-report-v2`

Base: `fix/190.2-scroll-restore-races@d23ae1ef0a3bdfdce99780ebafe8d9416ea340c0`

Runtime acceptance head: `a3af27b4224cc0db6aec2af2619400a6a9e8587d`

Build: **190.2**

Loaded `app.js` revision exported by the report:

`d37b91a992bec3a2efb3ee7051232113644bbd4e`

Status: **complete for instrumentation/CI; physical iPhone/Android measurements are intentionally left for manual acceptance**.

No production deployment and no next follow-up item were started.

## Scope

Item 19 extends the existing Build 186/169 loading diagnostics and the existing button:

**Settings → About → Download loading report**

No new diagnostics manager, session UI, telemetry server, persistent diagnostics storage or automatic upload was added.

`FPRuntime169.loading` remains a passive bounded observer. Existing owners emit facts; diagnostics does not start reconnects, sends, sync, history loads or media loads.

## Existing diagnostics retained

The previous report already covered:

- boot/startup marks and bounded asset observations;
- room open key/join/render/draft/scroll stages;
- media queue/cache/network/body/buffer/decrypt/element stages;
- cache state and HTTP status when available;
- bounded records, drop count and reset/download UI;
- browser resource and long-task observations.

Those fields remain. Item 19 adds only missing owner facts and report semantics needed for manual device measurements.

## Report format

`FPRuntime169.loading.report()` and the existing download button now export:

- `schema: 2`;
- `build: "190.2"`;
- `appRevision`: the full 40-character Git blob SHA from the actually loaded revisioned `app.js` URL;
- `limit: 240`;
- `dropped`: number of evicted diagnostic records;
- `activeElementWatches`: currently live bounded element observers;
- `coverage` and `limitations`;
- one record per local attempt.

Each record uses only a local numeric trace `id` and optional local numeric `parent`. No room/message/device/media IDs are used for correlation.

Each attempt may contain:

- `kind`;
- `startMs`: relative to current document navigation;
- `durationMs`;
- `status`;
- `points`: relative event offsets;
- `stagesMs`: independent durations;
- `result` / `reason`;
- `missing`: explicit reasons for expected marks that were not observed;
- safe aggregate counts/cache/http status where already supported.

Missing timing is `null` or an absent point with an explicit `missing` reason. It is never converted to zero.

Overlapping stages are independent and must not be summed as one total.

## Room/open/history

Existing room trace remains the parent attempt.

Additional facts:

- ordinary vs direct-partial entry remains explicit;
- repeated room open is tagged `repeated:true`;
- render source is tagged `ram-reuse` or `network-window`;
- existing `text-ready`, `composer-ready` and `scroll-ready` are exported;
- scroll restore outcome is tagged as one of:
  - `saved-anchor`;
  - `first-unread`;
  - `tail`;
  - `explicit-focus`;
  - `explicit-bottom`;
  - `user-interrupted`;
  - `cancelled`;
  - `unknown`.

Expected room readiness marks are included in `missing`, so an interrupted A→B opening shows missing text/composer/scroll as `cancelled` instead of looking like zero-time work.

Lazy history is a separate bounded `history` attempt:

- `source: ram-reuse` or `network-history`;
- `history-start`;
- `text-ready`;
- `outcome-ready`;
- result `ok`, `no-op`, `cancelled` or `error`.

No additional history request is issued for diagnostics.

## Photo/viewer

Existing media child records keep:

- resource admission/queue;
- managed cache state;
- response;
- body read;
- buffer conversion;
- AES-GCM decrypt;
- object URL/element readiness;
- byte count and HTTP status where available.

The current selected image viewer adds a parent `viewer` attempt with:

- `preview-ready` when the existing chat preview is actually ready;
- `original-ready` when the original image source actually reaches ready state;
- `stagesMs.previewToOriginal`.

If no preview is available, the report explicitly records:

`missing["preview-ready"] = "preview-unavailable"`.

Video/non-image viewer records are not falsely required to have photo preview/original points.

No additional image decode, fetch or cache read is started for diagnostics.

## Send

The existing owners report one `send` attempt per action:

1. `optimistic-ready` — existing optimistic message state/row has been created;
2. `dom-ready` — the intended outgoing DOM row exists;
3. `frame-opportunity` — the next `requestAnimationFrame` opportunity after the DOM fact;
4. `ack-ready` — actual server ACK;
5. `outcome-ready` — final owner outcome.

ACK and DOM are intentionally separate.

`frame-opportunity` is a browser frame callback opportunity only. It is **not** a hardware pixel presentation timestamp.

If ACK arrives after switching rooms, the accepted send attempt remains in the report; the reason can indicate that the original DOM is no longer the current-room target rather than silently dropping the attempt.

Repeated sends receive distinct local trace IDs.

## Reactions

The existing reaction state owner starts one `reaction` attempt.

Facts are emitted through the existing manager/renderer path:

1. `optimistic-ready`;
2. `dom-ready` after the target reaction renderer patch;
3. `frame-opportunity`;
4. `ack-ready` when the mutation owner receives its confirmation;
5. `outcome-ready`.

No reaction ID is exported.

Stale/cancelled/error/no-op attempts remain separate records rather than disappearing.

Repeated add/remove actions use distinct local trace IDs.

## Connection/reconnect

`FPConnection170` remains the one WebSocket current/reconnect owner.

When its actual current socket closes unexpectedly:

- a `connection` attempt starts;
- `break-confirmed` is recorded;
- if a different current socket later opens, `reconnect-open` is recorded;
- `FPSyncCoordinator176` records `sync-ready` after the already-existing reconnect sync finishes;
- final result becomes `reconnected` or an error/cancelled outcome.

Diagnostics never calls `ensureConnected()`.

If an actual offline→online transition occurs but the old socket remains OPEN, the report creates a separate factual outcome:

- `result: "preserved-live-socket"`;
- `stagesMs.breakToReconnect: null`;
- `missing["break-confirmed"] = "no-break-old-socket-preserved"`;
- `missing["reconnect-open"] = "no-break-old-socket-preserved"`.

No reconnect time is invented.

## Return from background

The existing lifecycle subscriber emits a `resume` attempt for real foreground/pageshow owner events.

Available facts:

- `visible-start`;
- `ui-ready` when the existing app root is present;
- `sync-start`;
- `sync-ready` after the already-existing resume sync finishes;
- final outcome.

If no session rooms require sync, `syncRequired:false` is exported and a missing sync mark is explained as `sync-not-required` when applicable.

Diagnostics does not initiate a second sync path.

Desktop CI validates wiring only. It does not claim to reproduce physical iOS/Android suspension.

## Privacy

The export does not include:

- message/caption text;
- room ID;
- device ID;
- message ID;
- media ID;
- reaction ID;
- room secret/recovery code;
- cryptographic keys;
- request/response bodies;
- full URLs;
- raw private error strings.

Regression tests serialize the downloaded report and verify that private fixture values are absent.

## Bounded collection and lifecycle

The existing bounded buffer remains at **240** records.

On overflow:

- oldest diagnostic records are removed;
- their temporary element watcher is cleaned up;
- `dropped` increments.

Download does **not** clear records.

The existing **Clear measurements** button:

- clears diagnostic records/drop count/temporary element watches;
- does not clear room state, application data, identity or media/application caches;
- keeps the separate fixed boot timing evidence.

All item-19 records live only in the current page/document memory.

Therefore unsaved diagnostic records are lost on:

- reload;
- full tab/PWA close;
- browser process termination;
- OS process kill.

This is separate from FPChat application persistence such as the Build 190.2 scroll snapshot.

## Verification

Final workflow:

`36537386491` — **SUCCESS**

Acceptance head:

`a3af27b4224cc0db6aec2af2619400a6a9e8587d`

Passed:

- syntax;
- app revision contract;
- existing Build 186 loading diagnostics;
- item-19 report through the existing Settings/About download button;
- repeated send and same-session reuse;
- progressive photo viewer;
- viewer lifecycle;
- media cache;
- reaction interaction;
- connection owner checks;
- single-owner audit;
- Build 190.2 scroll resilience;
- Build 190.2 offline scroll recovery.

The item-19 regression additionally verifies:

- interrupted A→B room attempt;
- successful open;
- old-history load;
- repeated same-room/RAM reopen;
- two distinct send attempts;
- two distinct reaction attempts;
- send/reaction frame-opportunity;
- preserved-live-socket outcome;
- confirmed socket break → new socket → existing sync completion;
- resume trace;
- no active element-watch leaks;
- download twice without clearing records;
- privacy-safe serialization;
- Clear measurements does not touch room application data.

Related media regression verifies actual image `preview-ready` and `original-ready`, and the Build 186 viewer regression verifies explicit `preview-unavailable` when no preview exists.

## Physical-device status

Physical iPhone: **NOT EXECUTED by CI**.

Physical Android: **NOT EXECUTED by CI**.

The purpose of item 19 is to make the existing JSON useful when those tests are run manually.

## Manual measurement plan

For each physical device use a short stable sequence:

1. Fresh launch. Wait for FPChat to become usable.
2. Open chat A normally three times, returning to chat list between opens.
3. In a long chat load older history three times; also leave/reopen once from a non-bottom saved position.
4. Open the same normal phone photo three times. Wait for the sharp original each time; visually note any jump separately because JSON cannot prove visual smoothness.
5. Send three short unique text messages and wait for ACK/status progression.
6. Add/remove the same reaction three times.
7. With the chat open, disable network for about 10 seconds, re-enable it and wait for stable operation. If the socket stays alive the report must show preserved-live-socket, not a fake reconnect.
8. Send FPChat to the real background/Home screen for about 30 seconds, return and wait for synchronization.
9. Open **Settings → About → Download loading report** and rename the file with device/scenario.

Recommended filenames:

- `FPChat-190.2-iPhone-main.json`;
- `FPChat-190.2-Android-main.json`.

For reload/process-kill/cold-start testing, save a separate file **before** the destructive action and another after relaunch, for example:

- `FPChat-190.2-iPhone-before-reload.json`;
- `FPChat-190.2-iPhone-after-reload.json`;
- `FPChat-190.2-iPhone-before-kill.json`;
- `FPChat-190.2-iPhone-after-kill.json`.

The same naming applies to Android.

If `dropped > 0`, earlier attempts were evicted from the bounded buffer; split the manual run into smaller files.

## What cannot be recovered after process termination

A report that was not downloaded before a reload/close/process kill cannot be reconstructed afterward because item-19 diagnostics are intentionally memory-only.

After relaunch, the new file contains only the new document's startup/actions.

Application state can persist independently; diagnostic records do not.

## Rollback

Runtime rollback target for item 19:

`fix/190.2-scroll-restore-races@d23ae1ef0a3bdfdce99780ebafe8d9416ea340c0`.

No DB migration, cache migration, identity reset or user-data cleanup is required for item 19.

Removing item-19 hooks returns the report to its previous schema/coverage; the scroll fix itself is outside this rollback.

## Final status

Item 19 instrumentation is complete.

Production is unchanged.

No next item was started.
