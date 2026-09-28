# Follow-up plan item 10 — join/history split

Date: 2026-09-28

## Result

Item 10 is complete.

No FPChat runtime optimization was made.

One fixed synthetic room was measured in three initial positions:

1. end of history;
2. saved anchor outside the latest page;
3. first unread outside the latest page.

The selected confirmed over-fetch is:

**the unconditional latest-100 history read embedded inside POST /join when the initial target is outside that page.**

The POST /join request itself is required and is not considered redundant.

## Measurement isolation

Final measurement runtime:

`1917f36ba2257611098a8dfc5bd26c54636143d9`

Build: **190.2**.

Fixture:

- one room;
- 1500 synthetic incoming text messages;
- target at ordinal 351;
- normal history page size 100;
- one fixed device identity;
- same database state restored before every open;
- five repetitions per scenario.

Network during room open:

- 200 ms latency;
- ~1 Mbit/s down;
- ~0.5 Mbit/s up.

A fresh ephemeral browser profile was used for each measured open, but the same explicit device identity was injected each time.

The room itself was made known to the page only **after app boot** and immediately before `openChat()`.

This prevents startup session-sync from beginning before the measured room open.

No real user/browser data was cleared; this is an isolated synthetic harness.

## Historical first run

The first item-10 run is retained as historical evidence:

- workflow `36421597571`;
- artifact `10969462869`.

That run already produced valid join and around-window timings, but the room was present in localStorage before app boot. Startup session sync therefore contaminated the count of post-open history requests.

It is superseded for final request-count conclusions by the clean run below.

## Final run

Workflow:

`36422527825` — SUCCESS.

Artifact:

- id `10969644009`;
- digest `sha256:2b170cb5c1908d41c1106f7ba689edb2dea0341a32ad8c0bb4379615c685d63d`.

Existing regressions also passed:

- saved-anchor history regression;
- unread restore/bottom regression.

## Server timing semantics

Production server code was not instrumented.

The benchmark uses a test-only Node preload hook for only room join/messages requests.

`serverMs` means:

> wall time from Node receiving the HTTP request to `res.end()`.

It includes:

- route/access work;
- SQLite work;
- object construction;
- JSON serialization.

It is **not SQL-only time**.

Therefore this report does not claim that the full join duration, or even all `serverMs`, is database time.

`ttfbMs` is browser request start to response headers under the emulated network.

`nonServerTtfbMs = ttfbMs - serverMs` includes network propagation and browser/request scheduling. It is not a pure wire metric.

## 1. End of history

Five open times:

`961.8, 964.6, 964.8, 965.5, 966.2 ms`

Median:

**964.8 ms**

Range:

**961.8–966.2 ms**

Initial mounted messages:

**100**

Tail mounted:

**yes**

### Join

| Metric | Median / value |
| --- | ---: |
| server request wall | **25.78 ms** |
| TTFB | **227.05 ms** |
| non-server part of TTFB | **202.79 ms** |
| request → body complete | **587.58 ms** |
| Content-Length | 45,397 B |
| encoded network bytes | 45,702 B |
| messages | 100 |
| messages JSON | 44,699 B |

No `before/after` request is required to establish the initial end position.

## 2. Saved anchor outside latest page

Anchor:

ordinal **351 / 1500**, well outside the latest 100.

Five open times:

`2096.2, 2113.3, 2131.4, 2199.0, 2483.8 ms`

Median:

**2131.4 ms**

Range:

**2096.2–2483.8 ms**

Validation in all five runs:

- target mounted: yes;
- latest tail mounted: **no**;
- `hasNewer`: yes;
- not at bottom.

### Join

| Metric | Median / value |
| --- | ---: |
| server request wall | **26.15 ms** |
| TTFB | **229.45 ms** |
| non-server part of TTFB | **203.43 ms** |
| request → body complete | **589.20 ms** |
| Content-Length | 45,398 B |
| encoded network bytes | 45,703 B |
| messages | **100 latest messages** |
| messages JSON | **44,699 B** |

### Required around-anchor history

`before`:

| Metric | Value |
| --- | ---: |
| requests/run | 1 |
| server wall median | **2.45 ms** |
| TTFB median | **213.20 ms** |
| body complete median | **981.14 ms** |
| encoded bytes | 45,062 B |
| messages | 100 |

`after`:

| Metric | Value |
| --- | ---: |
| requests/run | 1 |
| server wall median | **3.74 ms** |
| TTFB median | **224.41 ms** |
| body complete median | **1076.23 ms** |
| encoded bytes | 50,562 B |
| messages | 100 |

The two around-target reads are the data that actually becomes the initial mounted history.

The latest 100 delivered inside join is not mounted after hydration.

## 3. First unread outside latest page

First unread:

ordinal **351 / 1500**.

Unread state before every open:

**1150 messages**.

Five open times:

`2029.0, 2029.5, 2044.5, 2061.8, 2062.4 ms`

Median:

**2044.5 ms**

Range:

**2029.0–2062.4 ms**

Validation in all five runs:

- first unread target mounted: yes;
- target matches server firstUnreadMessageId: yes;
- latest tail mounted: **no**;
- `hasNewer`: yes.

### Join

| Metric | Median / value |
| --- | ---: |
| server request wall | **24.46 ms** |
| TTFB | **228.09 ms** |
| non-server part of TTFB | **203.64 ms** |
| request → body complete | **563.39 ms** |
| Content-Length | 41,800 B |
| encoded network bytes | 42,105 B |
| messages | **100 latest messages** |
| messages JSON | **41,099 B** |

### Required around-unread history

`before`:

| Metric | Value |
| --- | ---: |
| requests/run | 1 |
| server wall median | **2.19 ms** |
| TTFB median | **213.11 ms** |
| body complete median | **956.95 ms** |
| encoded bytes | 45,028 B |
| messages | 100 |

`after`:

| Metric | Value |
| --- | ---: |
| requests/run | 1 |
| server wall median | **1.57 ms** |
| TTFB median | **224.71 ms** |
| body complete median | **1004.04 ms** |
| encoded bytes | 46,964 B |
| messages | 100 |

Again, the latest page embedded in join is replaced by the around-unread window and the tail is not mounted.

## Join is not equivalent to database time

The three join server-wall medians are:

- end: 25.78 ms;
- saved anchor: 26.15 ms;
- first unread: 24.46 ms.

Full join transfer completes around:

- 587.58 ms;
- 589.20 ms;
- 563.39 ms.

The dominant gap between ~25 ms server processing and ~560–590 ms body completion is outside SQL-only work.

Likewise the around-history server processing is only ~2–4 ms, while ~45–51 KB responses take roughly ~0.96–1.08 s to finish under the constrained network.

The measurements therefore do **not** support describing the room-open delay as a database problem.

## Selected one confirmed extra query

Selected:

`getMessageHistoryPage(room.id, null, HISTORY_PAGE_SIZE, participant.id)`

inside:

`POST /api/rooms/:publicId/join`

for the two non-tail scenarios.

Why it is confirmed over-fetch:

1. join always loads/returns the latest 100;
2. the saved anchor / first unread is far outside those latest 100;
3. FPHistory174 then immediately gets the real initial window with one `before` and one `after` request;
4. after hydration, none of the latest-tail messages from the join page is mounted;
5. only latest-message metadata is retained separately by the current client.

Measured payload of this unneeded join history page:

- saved anchor: **44,699 B** message JSON;
- first unread: **41,099 B** message JSON.

Qualification:

- the **POST /join HTTP request is still required** for access, participant, unread and view-state state;
- this item selects only its unconditional embedded latest-history query/payload as over-fetch;
- SQL-only cost of that one sub-query was not instrumented separately.

This is exactly the condition required by follow-up item 11: non-tail opening currently receives a latest page before fetching the actually needed initial window.

No item-11 implementation was started.

## Other observed requests — not selected

Even in the clean harness, after room open the client consistently issues additional no-cursor `GET /messages?limit=100` requests through the existing sync/reconnect machinery.

Observed during the 1200 ms post-open window:

- end: 3 latest-100 GETs;
- saved anchor: 3 latest-100 GETs, plus one zero-message `after` sync;
- first unread: 3 latest-100 GETs, plus one zero-message `after` sync.

Source inspection confirms `syncRoomAfterReconnect()` itself starts with a latest-page snapshot, and reconnect/session synchronization owns this path.

These requests are recorded because they are real.

They are **not selected or changed in item 10**, because the task requires one confirmed cause and removing/deduplicating sync-owned requests would be a separate ownership/regression task.

## Files added for measurement

- `scripts/next10-server-timing-hook.cjs`;
- `scripts/benchmark-next10-join-history.cjs`;
- package script `bench:next:10`;
- `docs/performance-next10-join-history-summary.json`;
- this report;
- journal update.

No `public/*`, `server.js`, database schema, manager, owner, arbiter, Service Worker or updater behavior changed.

## Rollback

Remove the item-10 benchmark/hook, package script and documentation.

No runtime/data rollback is required.

## Continuation

Item 10 is complete.

Do not automatically start item 11.
