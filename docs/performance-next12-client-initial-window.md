# Follow-up plan item 12 — client initial history window

Date: 2026-09-28

Status: **complete**.

This item connects the server capability from item 11 only to the existing room-open path.

No new room-open owner, history owner, scroll owner, queue, store, or transport path was created.

## Implementation

The existing `openChat170()` request now sends:

```json
{
  "displayName": "...",
  "deviceId": "...",
  "initialWindow": true
}
```

The request still uses the existing RoomContext transition `AbortSignal`.

No separate fetch path was added.

## Initial-position priority

The server response from item 11 remains authoritative when
`initialWindow.version === 1`.

The client therefore preserves:

1. first unread;
2. saved position when not at bottom;
3. tail.

For a current server:

- `initialWindow.mode="around"` exposes its validated target;
- `initialWindow.mode="tail"` explicitly tells the client not to retry a stale
  saved target.

For a legacy server that ignores the request field, `initialWindow` is absent.
The existing client logic then continues to derive first unread / saved anchor and
uses the existing FPHistory174 `around()` requests.

This is the old-server fallback. No separate compatibility endpoint exists.

## FPHistory174 integration

The server-provided window already contains the selected target, so
`FPHistory174.hydrate()` does not issue its old target-specific
`before + after` pair.

The one latest-message record returned by item 11 is copied to
`data.latestMessage174`.

This preserves the real tail identity used by:

- chat-list last activity;
- `lastKnownMessageIdByRoom`;
- subsequent sync logic.

The bounded mounted window remains the server-provided around range.

Existing `hasMore/nextCursor` and `hasNewer/newerCursor` state is preserved,
and later scrolling still delegates to `FPHistory174.load()`.

FPScroll173 remains the only scroll writer. No direct scroll path was added.

## RoomContext / cancellation

The item changes only the body of the existing guarded join fetch.

The existing flow remains:

- `beginTransition(roomId)`;
- derive key;
- join using `context.signal`;
- validate latest transition after awaits;
- commit transition;
- render through the current room context.

The A→B→A regression deliberately delays the first A join and verifies that the
final DOM and current context belong only to the latest A generation.

## Old-server compatibility

Regression simulates an old server by removing `initialWindow` from the outgoing
request before it reaches the current server.

That forces the exact legacy join response.

Verified:

- the client still opens the saved position;
- the old FPHistory174 `before + after` fallback runs;
- newer history remains available.

Therefore a client with item 12 can still work against a server that ignores the
new field.

## Unavailable/deleted anchor fallback

A saved view-state target is made `deleted_for_all` in the regression.

Item 11 returns:

`initialWindow.mode="tail"`

The client honors that server decision.

Verified:

- it does not retry the deleted anchor with `before`;
- it does not retry it with `after`;
- the actual current tail is mounted;
- `hasNewer=false`.

## History continuation

After opening around a saved target, regression calls the existing:

- `FPHistory174.load('older')`;
- `FPHistory174.load('newer')`.

Verified that the requests use the cursors supplied by the server-provided initial
window.

No new pagination path exists.

## Request count comparison

Baseline source:

`docs/performance-next10-join-history-summary.json`

Same synthetic conditions:

- one fixed 1500-message room;
- target ordinal 351;
- page size 100;
- five runs per scenario;
- same database state restored before every run;
- 200 ms latency;
- ~1 Mbit/s down;
- ~0.5 Mbit/s up.

### Before — item 10

For saved-anchor / first-unread:

1. `POST /join` returned latest 100;
2. client `GET before`;
3. client `GET after`.

Critical initial history requests:

**3**

### After — item 12

For saved-anchor / first-unread:

1. `POST /join` returns the already bounded around window.

Critical initial history requests:

**1**

Reduction:

**3 → 1, two requests removed per non-tail open.**

The server still executes one tiny latest-message lookup for tail identity. It
does not return the old latest-100 page.

## Important separate traffic

Three no-cursor:

`GET /messages?limit=100`

requests remain visible after room open through the existing sync/reconnect path.

They were already identified separately in item 10.

They are not initial-target hydration and were not changed in item 12.

This report does not claim that all latest-page network traffic has disappeared;
it claims that the **redundant latest-100 page inside the initial join/hydrate
sequence** is gone for non-tail opening.

## Timing comparison

### End / tail

Item 10 median:

**964.8 ms**

Item 12 median:

**962.2 ms**

Delta:

**-2.6 ms (-0.27%)**

This path was intentionally not optimized.

### Saved anchor

Item 10:

**2131.4 ms**

Item 12:

**1445.0 ms**

Delta:

**-686.4 ms (-32.20%)**

Raw item-12 values:

`1414.0, 1414.4, 1445.0, 1447.6, 1483.1 ms`

Critical initial encoded transfer:

- before: 141,327 B;
- after: 96,309 B.

Delta:

**-45,018 B (-31.85%)**

### First unread

Item 10:

**2044.5 ms**

Item 12:

**1399.8 ms**

Delta:

**-644.7 ms (-31.53%)**

Raw item-12 values:

`1399.5, 1399.8, 1399.8, 1400.7, 1413.8 ms`

Critical initial encoded transfer:

- before: 134,097 B;
- after: 92,639 B.

Delta:

**-41,458 B (-30.92%)**

## Join response after item 12

Saved anchor:

- 200 messages;
- join body complete median: **996.58 ms**;
- encoded bytes: **96,309 B**.

First unread:

- 200 messages;
- join body complete median: **960.83 ms**;
- encoded bytes: **92,639 B**.

The join response is larger than the old latest-100 join because it now carries
the useful around window directly.

The gain comes from avoiding a useless latest page followed by two additional
round trips.

## Measurement semantics

Five repetitions were used.

Therefore this report gives raw values, median, and range only. It does not report
p95.

Measurements are:

- isolated Linux headless Chromium;
- local SQLite;
- CDP network emulation.

They are not physical-device measurements or production Cloudflare timings.

## App revision issue found during verification

The first item-12 CI run failed before app boot.

Cause:

- item 12 changed `public/app.js`;
- `version.json.appRevision` still referenced the previous app.js bytes;
- the immutable revision guard from items 7/8 correctly rejected the stale URL.

The content revision was updated to:

`b9190a5c859ee1f6bd5896a149e9eb8e7952deee`

Build remains **190.2**.

`test:next:7` now passes and confirms the revision equals the current app.js Git
blob SHA.

This was required by the existing revision contract; no new cache mechanism was
added.

## Final verification

Workflow:

`36429875489` — **SUCCESS**

Measured runtime state:

`3cf04a31e45998bd2e7318b6c4dc9c980dff5316`

Measurement artifact:

- id `10972454275`;
- digest `sha256:756f56a227ad8ff7b9d9375c4d261d72ba24cc94e1a82e1cf342cd228290ed7d`.

Passed:

- `test:next:7`;
- `test:next:12`;
- `test:next:11`;
- `check:170`;
- `test:178:history-page-owner`;
- `test:178:history-saved-anchor`;
- `test:178:unread-restore-bottom`;
- `test:180:single-owner-audit`;
- `bench:next:12`.

## Files changed

Client/runtime:

- `public/room-open170.js`;
- `public/app.js`;
- `public/history174.js`;
- `public/version.json` only to update the required app.js content revision.

Regression/measurement:

- `scripts/regression-next12-client-initial-window.cjs`;
- `scripts/benchmark-next12-initial-window.cjs`;
- `package.json`.

Documentation:

- `docs/performance-next12-client-initial-window-summary.json`;
- this report;
- `docs/performance-progress.md`.

No server item-11 semantics, DB/schema, updater, Service Worker, new history owner,
new RoomContext owner, new scroll owner, or new queue was added.

## Rollback

Revert:

- item-12 client changes;
- item-12 appRevision;
- item-12 tests/benchmark/docs.

The item-11 server capability can remain present because it is opt-in.

No data migration is required.

## Continuation

Item 12 is complete.

Do not start item 13 automatically.
