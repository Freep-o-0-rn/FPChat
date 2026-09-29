# Follow-up item 19 — existing loading report for manual real-device measurements

Date: 2026-09-29

Status: **complete in isolated Chromium/Linux verification; physical iPhone/Android measurements are intentionally left to the user**.

Base branch:

`fix/190.2-scroll-restore-races@d23ae1ef0a3bdfdce99780ebafe8d9416ea340c0`

Work branch:

`optimization/performance-item19-device-report`

No production deployment and no next item were performed.

## Scope

Item 19 extends the existing **Settings → About → “Скачать отчёт загрузки”** JSON.

It does not add:

- a second diagnostics system;
- a sessions UI;
- persistent diagnostic storage;
- FPS monitoring;
- automatic report upload;
- additional benchmark traffic;
- reconnect/sync/retry/resource-loading behavior.

`FPRuntime169.loading` remains a passive bounded observer.

## What already existed and is preserved

Before item 19, the existing `FPRuntime169.loading` already exported:

- boot/startup explicit gate timings;
- room entry:
  - key;
  - join;
  - history;
  - render;
  - first mounted message;
  - text ready;
  - draft;
  - composer;
  - scroll ready;
  - messages revealed / visible frame;
- media:
  - resource admission;
  - managed cache;
  - network response;
  - body/buffer;
  - decrypt;
  - element readiness;
  - requestAnimationFrame opportunity;
- cache repair/maintenance information;
- browser resource/long-task summary;
- bounded record count;
- dropped-record counter;
- safe error categories.

The existing buffer remains:

**240 records**

and still evicts the oldest record when full while incrementing `dropped`.

The existing download and reset buttons remain the only UI.

## New report metadata

The same JSON now additionally includes:

- `diagnosticsRevision: 19`;
- `build`;
- `buildRevision` when the existing startup version result contains a valid app revision;
- `attemptSummary` grouped by record kind and status;
- explicit `missing` reasons for unavailable measurements.

The build revision is the existing `version.json.appRevision` used by the app loader. No extra version request is made for diagnostics.

Missing times remain **null**, never 0.

Overlapping phases remain independent timestamps/durations and must not be summed as if they were serial CPU stages.

## Chat / history

Existing room timing points are preserved.

Additional facts:

- `openKind: ordinary | repeat`;
- `sameRoom`;
- `reusedRam`;
- `messageSource: ram-reuse | decrypt-render`;
- `ram-ready` when an actual MessageStore same-session reuse occurs.

The room trace continues to contain the existing:

- `text-ready`;
- `composer-ready`;
- `scroll-ready`.

Therefore item 19 does not create duplicate text/composer/scroll timers.

### Manual old-history loads

`FPHistory174` now reports a separate bounded `history` attempt only when actual history work starts.

It records:

- direction;
- source:
  - `ram-pending`;
  - `network`;
- load start/ready;
- result;
- cancellation/error.

No extra history request is made for diagnostics.

## Photo viewer

Existing encrypted-media cache/network/body/decrypt stages remain unchanged.

For active image viewer attempts, the existing viewer record now additionally distinguishes:

- `preview-ready`;
- `original-ready`.

Preview readiness is recorded only from the actual preview image readiness.

Original readiness is recorded only from the actual original image readiness.

If a preview does not exist:

- preview time remains `null`;
- `missing.preview = "no-preview-available"`.

If original loading fails:

- original time remains `null`;
- the missing reason is recorded.

The existing `paint-opportunity` / new action `frame-opportunity` terminology means only a browser `requestAnimationFrame` callback opportunity. It is **not** a physical display/pixel presentation timestamp.

## Text send

The active submit owner is still:

`FPSendManager177 -> FPTextSend170 -> existing pendingTextSends/app.js`.

No new queue or retry path was added.

Each actual text-send attempt can record:

1. `manager-ready`
   - canonical optimistic message state was written;
2. `dom-ready`
   - optimistic outgoing message DOM was actually mounted;
3. `frame-opportunity`
   - first rAF opportunity after that DOM state;
4. `ack-ready`
   - real server `message:ack`;
5. `final-ready`
   - the ACK result was applied to the matching mounted message DOM.

If the user switched rooms before final DOM application, server ACK remains distinct and final DOM is null with an explicit reason.

The diagnostic trace is carried only inside the already-existing pending-send object. It does not change retry count, timing, transport or clientMessageId semantics.

## Reactions

The existing owners remain:

- `FPReactionManager188` — canonical/optimistic reaction state;
- `FPReactionRenderer188` — reaction DOM;
- `FPReactionArbiter188` — mutation serialization.

Each real mutation can record:

1. `manager-ready` — optimistic manager projection;
2. `dom-ready` — target reaction DOM was patched;
3. `frame-opportunity` — first rAF opportunity after optimistic DOM;
4. `ack-ready` — authoritative mutation confirmation;
5. `final-ready` — authoritative reaction state was actually patched into mounted DOM.

Server confirmation is not silently redefined as final DOM.

If the message/chat is no longer mounted, final DOM remains null with a reason.

## Connection / offline-reconnect

The existing `FPConnection170` owner reports facts only.

Diagnostics do not call `ensureConnected()` or schedule reconnect.

An offline cycle can create a `connection` attempt.

A reconnect is considered observed only when there is a confirmed old-socket close and a later open event.

The report separates:

- confirmed break;
- new socket open;
- required post-connection sync;
- sync completion.

If the browser preserves the same old WebSocket:

- `stagesMs.reconnect = null`;
- `oldSocketPreserved = true`;
- `missing.reconnect = "old-socket-preserved"`.

This follows item 16 semantics.

## Return from background

The existing `FPLifecycle170` subscription in app.js is extended; no second lifecycle subscriber/controller is added.

On a real `foreground` event (or persisted pageshow), a bounded `resume` attempt may record:

- `visible`;
- `interface-ready`;
- whether sync is required;
- `sync-start`;
- `sync-ready`;
- final result.

It observes the existing `FPSyncCoordinator176.syncAfterResume()` work only.

It does not initiate any work beyond the existing resume path.

If the app leaves the foreground again before completion, the attempt is cancelled with explicit missing values.

## Privacy

The export remains limited to local trace numbers and allowlisted diagnostic metadata.

The item-19 regression verifies that the downloaded JSON does not contain fixture:

- room IDs;
- device IDs;
- room secrets;
- message text;
- API URLs;
- blob URLs.

No message IDs are used to correlate exported actions. Correlation uses bounded local record IDs only.

## Reset and persistence semantics

Downloading the report **does not clear** records or the dropped counter.

“Очистить замеры” clears only diagnostic records/watchers/dropped count. It does not clear:

- room access state;
- chats;
- messages;
- scroll position persistence;
- application identity.

Boot/startup timing remains available after diagnostic reset, matching the existing behavior.

Diagnostics themselves remain intentionally RAM-only.

Therefore a page reload, browser/PWA termination or OS process kill loses the current run's not-yet-downloaded action records.

That limitation is deliberate: item 19 does not add persistent diagnostics.

## Automated verification

Final workflow:

`36534721791` — **SUCCESS**

Acceptance head:

`f38894407d14d9022002edf57718110ea949e5aa`

Passed:

- syntax;
- existing Build 186 loading diagnostics;
- progressive photo regression;
- repeated-send/draft-release regression;
- send-manager ownership;
- message-render ownership;
- reaction interaction;
- scroll-fix resilience;
- scroll-fix offline recovery;
- Build 170 connection contract;
- single-owner audit;
- item-19 real export regression.

The item-19 regression uses the existing download button and verifies:

- interrupted A -> B;
- successful room open;
- repeat room open;
- manual older-history attempt;
- text send;
- reaction mutation;
- image preview -> original;
- browser offline -> online;
- foreground/resume path;
- JSON download;
- download does not reset measurements;
- reset leaves application data intact;
- bounded/privacy rules;
- no leftover element watches.

Final marker:

`PASS next19 existing loading JSON contains bounded real-device action diagnostics`

## Known coverage limits

These are intentionally not expanded into larger architectural changes:

1. **Physical pixel presentation**
   - rAF is not a hardware/display presentation timestamp.

2. **Hard process kill**
   - the killed process cannot export a post-kill diagnostic event;
   - current diagnostics are RAM-only and must be downloaded before the process is destroyed.

3. **Repeat-open classification**
   - `openKind=repeat` is page-runtime-local and resets after page reload.

4. **No physical-device acceptance in CI**
   - iPhone and Android behavior still needs the user's manual run.

5. **No production/network-path acceptance**
   - the regression runs against isolated local server/Chromium.

6. **Visual bugs**
   - JSON records event readiness/outcomes but does not prove that every rendered frame looked visually correct.

7. **Metrics that would require a new large subsystem**
   - true compositor/native screen-present timestamp;
   - persistent cross-process diagnostic sessions;
   - continuous FPS/jank trace.
   
   These remain deliberately **uncovered** because they would violate item 19 scope.

## Files changed

Runtime/owner hooks:

- `public/runtime169.js`;
- `public/index.html`;
- `public/app.js`;
- `public/text-send170.js`;
- `public/room-open170.js`;
- `public/history174.js`;
- `public/media-gallery134.js`;
- `public/reaction-manager188.js`;
- `public/reaction-renderer188.js`;
- `public/connection170.js`;
- `public/version.json`.

Tests:

- `scripts/regression-next19-device-report.cjs`;
- aligned `scripts/regression-next2-send-draft-release.cjs`;
- `package.json`.

Documentation:

- this file;
- `docs/performance-next19-device-report-summary.json`;
- `docs/performance-progress.md`.

The temporary GitHub Actions workflow is removed after preserving the successful run.

## Rollback

Item 19 introduces no database migration and no persistent diagnostic data.

Rollback is code-only: return to

`fix/190.2-scroll-restore-races@d23ae1ef0a3bdfdce99780ebafe8d9416ea340c0`.

No app-data, identity, cache or database reset is required.

## Production

Not deployed.

No next item started.
