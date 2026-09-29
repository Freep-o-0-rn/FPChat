# Follow-up item 19 — real-device manual measurement report

Date: 2026-09-29

Status: **complete in branch; physical iPhone/Android measurements are intentionally left to manual acceptance**.

Branch:

`optimization/performance-item19-real-device-report-after-scroll`

Base:

`fix/190.2-scroll-restore-races@d23ae1ef0a3bdfdce99780ebafe8d9416ea340c0`

Build:

**190.3**

Loaded app identity:

`5bb585b52b190bf9d80a779a4ffc68842f13214b`

The identity is the Git blob SHA of the exact loaded `public/app.js`. The existing server app-revision contract verifies it before serving the immutable revisioned URL.

No production deployment and no next follow-up item were performed.

## Scope

Item 19 extends the existing Build 186 loading report used by:

**Settings → About → Download loading report**

It does not add:

- a new diagnostics subsystem;
- a session UI;
- a new user-facing screen;
- persistent diagnostic storage;
- background upload;
- additional diagnostic network requests;
- continuous FPS monitoring;
- a second connection/sync/retry/resource owner.

`FPRuntime169.loading` remains a passive bounded journal. Existing owners emit facts at points where those facts are already known.

## Existing evidence preserved

Before item 19 the report already contained:

- boot/startup marks;
- room key/join/history/render/text/composer/scroll readiness;
- media queue/admission;
- managed cache stages;
- response/body/buffer stages;
- decrypt stages;
- element readiness;
- browser rAF/paint-opportunity marks;
- viewer/gallery history;
- bounded resource summaries;
- safe error categories;
- `dropped`;
- `activeElementWatches`;
- JSON export/reset through the existing About UI.

These observations were retained instead of being duplicated.

The journal limit remains **240 records**.

## Report schema

The top-level report keeps `schema: 1` for compatibility and adds:

`schemaRevision: 19`

New/clarified top-level fields:

- `build`;
- `buildIdentity.build`;
- `buildIdentity.appRevision`;
- `buildIdentity.source`;
- `limit`;
- `dropped`;
- `pendingRecords`;
- `activeElementWatches`;
- expanded `coverage`;
- explicit `limitations`.

The build identity is derived from the already loaded app script. Diagnostics do not fetch version/app metadata separately.

Each retained record has a page-local numeric `attempt` equal to its local diagnostic record number. It is not a room, message, media, device or user identifier.

Missing durations remain **null**, never zero, and the corresponding `metrics.missing` field explains why when known.

Overlapping stages are reported independently and must not be summed as if they were sequential costs.

## Room and history

Existing room timing remains the source for:

- text readiness;
- composer readiness;
- position/scroll readiness.

Item 19 adds safe classification:

- `openType: ordinary | repeat`;
- `messageSource: ram | load`.

Repeat classification is page-session-local only.

`messageSource=ram` means the full existing `FPMessageStore172.reuseWindow` path was actually used. A fallback is not falsely labelled RAM.

New derived room metrics:

- `textReadyMs`;
- `composerReadyMs`;
- `positionReadyMs`.

Old-history loads from `FPHistory174` are individual `history` attempts:

- `direction: older | newer`;
- `historySource: network | ram`;
- `responseMs`;
- `renderMs`;
- `positionRestoreMs`.

A RAM history attempt has no network duration. Its missing network value is null with `ram-source`.

A room generation/context change cancels the attempt rather than letting a stale result finish as success.

## Photos

Existing media child records still contain the original:

- queue/admission;
- cache;
- network/response/body;
- buffer;
- decrypt;
- ObjectURL/element stages.

Item 19 does not duplicate these stages.

The viewer now records the selected image as two distinct readiness observations when an existing preview is available:

- `variant: preview`;
- `variant: original`.

Derived values:

- preview record: `previewReadyMs`;
- original record: `originalReadyMs`;
- each can expose `frameOpportunityMs`.

The preview observation uses the already mounted preview and causes no new media request.

A diagnostics-only ordering issue was also corrected: original element observation is installed after the image is switched from preview URL to original URL, so an already-complete preview can no longer prematurely close the original-readiness record.

`frameOpportunityMs` is a requestAnimationFrame callback opportunity. It is **not** a hardware/display/pixel presentation timestamp.

## Text send

The actual owner remains `FPTextSend170`.

The existing pending text queue/retry/ACK path in `app.js` remains the transport owner.

Each text attempt can record:

- `optimisticMs`: canonical optimistic message state exists;
- `domChangeMs`: matching outgoing DOM row exists;
- `frameOpportunityMs`: first rAF opportunity after that DOM state;
- `ackMs`: server `message:ack` observed;
- `finalDomMs`: promoted acknowledged message DOM observed;
- outcome/reason.

Server ACK is deliberately separate from final DOM promotion.

A failed/no-connection attempt stays a failed attempt with missing later values null.

No message text or client/server message identifier is exported. Correlation uses only a local diagnostic attempt number attached transiently to the outgoing DOM row.

## Reactions

The existing owners remain:

- `FPReactionManager188` — reaction state/mutation;
- `FPReactionRenderer188` — reaction DOM;
- existing reaction arbiter — serialization.

Each attempt can record:

- operation: add/remove;
- optimistic manager state;
- target DOM change;
- first rAF opportunity after that DOM change;
- actual HTTP server response when observed;
- final authoritative DOM;
- final outcome/reason.

If the HTTP result is lost but the existing WebSocket reconciliation confirms the authoritative state, the attempt is:

`outcome: reconciled-ws`

and:

`ackMs: null`

with reason:

`ack-not-observed`.

The WebSocket reconciliation is not falsely renamed into an HTTP server ACK.

## Offline and reconnect

Going offline starts one bounded `connection` attempt only when the product lifecycle reports the real offline signal.

Diagnostics do not call `ensureConnected`, schedule reconnect, send traffic, or trigger sync.

The old socket object is remembered only transiently for comparison.

A reconnect duration exists only when:

1. the old socket actually emits close;
2. a different current socket opens.

Then:

- `breakMs` records the observed break;
- `reconnectMs` is close → new socket open;
- `syncReadyMs` is new socket open → existing reconnect sync completion;
- outcome is `reconnected`.

If the old WebSocket stays OPEN through offline/online:

- `reconnectMs = null`;
- missing reason is `socket-preserved`;
- outcome is `socket-preserved`;
- `syncReadyMs` is measured from online → existing resume sync completion.

This keeps “network was unavailable” separate from “WebSocket actually reconnected”.

## Return from background

A `resume` attempt is armed by the existing lifecycle owner's real background/pagehide transition and begins on the subsequent foreground/pageshow.

It records separately:

- `visible`;
- `ui-ready`;
- `sync-ready`;
- `uiReadyMs`;
- `syncReadyMs`.

Focus alone does not create a background-return attempt.

Diagnostics do not initiate the sync: they observe the existing `FPSyncCoordinator176.syncAfterResume()` completion.

CI can validate the hook contract with controlled browser visibility events, but that is **not** evidence of real iOS/Android suspension behavior.

## Privacy

The report continues to exclude:

- conversation text;
- notification/message content;
- room IDs;
- device IDs;
- participant/user IDs;
- message IDs;
- media IDs;
- room secrets;
- encryption keys;
- recovery codes;
- URLs;
- request bodies;
- raw exception/error messages.

Correlation is by local numeric diagnostic attempts only.

The regression suite verifies that private fixture values do not appear in the exported JSON.

## Buffer, download and reset behavior

Unchanged:

- maximum retained operation records: **240**;
- when full, new records are rejected and `dropped` increments;
- download serializes the current report and does not clear it;
- repeated download preserves the same journal;
- reset clears diagnostic operations/watches/counters, not application data, chats, identities, drafts, media cache or scroll persistence;
- element listeners/watches are released on finish, cancel, eviction and reset.

The journal is RAM-only.

A page reload or browser/PWA process termination discards the current diagnostic records. Therefore a report required from the pre-reload/pre-kill session must be downloaded **before** that action.

This diagnostic lifetime is separate from FPChat's durable scroll-position snapshot.

## Automated verification

Final workflow:

`36522042691` — **SUCCESS**

Final verified runtime head before documentation:

`1dcb16a47c2d55699ffe736faf8f6a1c3df2d428`

Passed:

- syntax;
- exact app revision contract;
- immutable app cache contract;
- existing Build 186 report regression;
- JSON download through the existing About button;
- repeated download without clearing;
- bounded buffer/dropped/privacy/reset/watch cleanup;
- ordinary and repeat room open;
- MessageStore RAM reuse classification;
- old-history load;
- progressive photo preview/original;
- send metrics;
- repeated reaction metrics;
- A → B cancelled/successful separation;
- offline connection classification;
- resume hook;
- Build 190.2 scroll-save/resilience/offline regressions;
- saved-anchor/unread behavior;
- item-13 same-session reuse;
- media viewer lifecycle;
- Build 185 photo gesture suite;
- Build 190 media swipe/preview suite;
- repeated-send/draft ordering;
- send manager;
- MessageStore ACK;
- reaction interaction;
- single-owner audit.

The media lifecycle source fingerprint and one send static assertion were updated only to acknowledge passive instrumentation. Their behavioral assertions remain in place.

## What automated verification does not prove

It does not prove:

- physical iPhone background suspension timing;
- physical Android background suspension timing;
- OS process-kill delivery of a final diagnostic record;
- actual pixels presented on a display;
- absence of every visual glitch;
- production/Cloudflare network timing.

Those remain manual real-device observations, which is the intended use of item 19.

## Files

Runtime diagnostics/owner facts:

- `public/runtime169.js`;
- `public/app.js`;
- `public/text-send170.js`;
- `public/history174.js`;
- `public/media-gallery134.js`;
- `public/reaction-manager188.js`;
- `public/reaction-renderer188.js`;
- `public/version.json`.

Existing tests updated:

- `scripts/regression186-loading-browser.cjs`;
- `scripts/regression177-media-viewer-lifecycle.cjs`;
- `scripts/regression-next2-send-draft-release.cjs`.

Documentation:

- this report;
- `docs/performance-next19-real-device-report-summary.json`;
- `docs/Build186_LoadingDiagnostics.md`;
- `docs/performance-progress.md`.

The temporary item-19 workflow is removed after recording the result.

No server runtime, database/schema, Service Worker or updater change is part of item 19.

## Rollback

Rollback item 19 by reverting the branch to:

`fix/190.2-scroll-restore-races@d23ae1ef0a3bdfdce99780ebafe8d9416ea340c0`

No DB migration, cache migration, identity reset or message-data action is required.

The scroll restore fix is the base and is not part of item-19 rollback.

## Final status

The existing downloadable JSON now contains available measurements for the requested manual workflows and explicitly exposes missing/unobservable values instead of inventing them.

Physical device measurement is intentionally the next **manual action by the user**, not a new automated development item.
