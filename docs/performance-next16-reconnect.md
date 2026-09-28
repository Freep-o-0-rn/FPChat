# Follow-up plan item 16 — reconnect stand correction

Date: 2026-09-28

Status: **complete — reconnect measurement now distinguishes preserved live socket from a real break + automatic recovery**.

## Scope

Only follow-up item **16** from `docs/performance-next-steps-prompts.md` was performed.

Application runtime was **not changed**.

The work changes only the reconnect benchmark/verification stand.

Item 17 was not started.

## Problem in the old Step 4 reconnect measurement

The original `scripts/benchmark-step4.cjs` reconnect helper did:

1. wait for an open socket;
2. set the browser context offline;
3. wait 10 seconds;
4. restore network;
5. call `waitWs()`;
6. `waitWs()` itself called `FPConnection170.ensureConnected()`.

Therefore the historical Step 4 values:

- normal: 104, 103, 91, 111, 113 ms;
- throttled: 117, 145, 113, 123, 122 ms;

did **not** prove automatic reconnect.

The observer itself could create/recover the connection.

The old stand also re-applied the requested throttled profile only **after** `waitWs()` finished, so the requested network profile was not guaranteed to cover the measured recovery interval.

Those historical numbers remain recorded as historical measurements, but they are not treated as verified reconnect latency.

## New passive reconnect contract

The new stand never calls:

- `FPConnection170.ensureConnected()`;
- `ensureStableWsConnected()`;
- `ensureWsConnected()`;

during the measured observation.

It observes only:

- `FPConnection170.subscribe()`;
- the original WebSocket object's `close` event;
- `FPConnection170.current()`;
- `FPConnection170.snapshot()`;
- `FPLifecycle170` state/events.

A reconnect is accepted only if all are true:

1. the old WebSocket is confirmed closed;
2. the current socket is a **different object**;
3. the new socket is `WebSocket.OPEN`;
4. `FPConnection170.snapshot().open === true`.

If the old socket never closes, `reconnectMs` is left **null**.

That outcome is recorded separately as:

`live_connection_preserved`.

## Two separate scenarios

### A. Natural network outage

The stand switches Chromium offline for 2.5 s, then restores it.

No socket close is requested.

Result in this Chromium CI:

- normal: **5/5 old sockets stayed alive**;
- throttled: **5/5 old sockets stayed alive**;
- actual old-socket breaks: **0/10**;
- reconnect samples: **0/10**;
- reconnect median: **null**;
- outcome: `live_connection_preserved`.

This confirms that the previous stand's offline emulation did not by itself prove a WebSocket reconnect.

The fact that the socket object remains `OPEN` does not prove packet delivery during the outage; it only proves that Chromium did not emit a close/replacement for that WebSocket in this scenario.

### B. Confirmed break while offline

A second scenario exists only to verify recovery behavior after a **real confirmed socket break**.

While the page is offline, the stand closes the already-observed raw WebSocket directly.

This does **not** call the application connection owner and does not call `ensureConnected()`.

CDP `Network.closeConnections` was attempted first, but Chromium 140 in this runner does not expose that protocol command:

`Protocol error (Network.closeConnections): 'Network.closeConnections' wasn't found`.

Therefore the isolated stand used:

`raw-WebSocket.close`

as the explicit break mechanism.

Before restoring the network the stand verifies:

- old socket emitted `close`;
- old socket `readyState === CLOSED`;
- `FPConnection170.current()` no longer points to it.

Only then is the network restored.

Recovery is left entirely to the existing lifecycle/sync/connection path.

## Automatic recovery result

### Normal network

Confirmed break:

- **5/5** old sockets confirmed closed before restore;
- **5/5** automatically recovered;
- new current socket was different from the old socket;
- new socket was owned/open according to `FPConnection170`.

Reconnect after network restore:

- median: **15 ms**;
- min: **13 ms**;
- max: **15 ms**.

### Throttled network

Confirmed break:

- **5/5** old sockets confirmed closed before restore;
- **5/5** automatically recovered.

Reconnect after network restore:

- median: **465 ms**;
- min: **464 ms**;
- max: **465 ms**.

Five samples only, so p95 is not reported.

## Which owner performed recovery

The observer did not call connection APIs.

The sequence observed on a confirmed break was:

1. old socket: `close`;
2. `FPConnection170`: current socket becomes null;
3. lifecycle: `online`;
4. existing application lifecycle/sync path runs;
5. `FPConnection170`: a new socket becomes current in CONNECTING state;
6. the new socket emits `open`.

This is consistent with the existing architecture:

`FPLifecycle170 online -> app resume/sync -> FPSyncCoordinator176 -> existing app.js reconnect path -> FPConnection170 current socket`.

No second WebSocket owner was added.

## Network profile correction

The first item-16 CI run `36446798035` failed because the stand attempted to verify the CDP throttled profile on localhost and did not observe sufficient latency.

The stand correctly rejected that result instead of claiming the profile was active.

For the final stand, throttling is applied to the Linux loopback interface at packet level with `tc/netem`.

Target profile:

- round-trip latency target: approximately **200 ms**;
- server -> browser: **1 Mbit/s**;
- browser -> server: **0.5 Mbit/s**.

Implementation:

- 100 ms one-way netem delay on each direction;
- source server-port traffic -> 1 Mbit/s;
- destination server-port traffic -> 500 Kbit/s.

The qdisc remains active for the **entire profile block**, including:

- before offline;
- during offline;
- network restoration;
- WebSocket handshake/recovery;
- post-recovery verification.

CDP is then used only to toggle offline/online state with no additional latency/rate shaping.

## Profile verification

The stand verifies both configuration and effect.

### Configuration evidence

After the throttled run, `tc -s qdisc` showed traffic through both shaped queues:

- download queue: **46,551 B / 155 packets**;
- upload queue: **68,935 B / 234 packets**;
- dropped packets: **0**.

### Measured HTTP probe

A cache-busted `version.json` request is made after every recovery while the profile is still active.

Normal profile:

- n = 10;
- median: **3.6 ms**;
- range: **2.8–3.9 ms**.

Throttled profile:

- n = 10;
- median: **218.6 ms**;
- range: **216.6–231.2 ms**.

Added median latency:

**+215.0 ms**

The stand therefore marks the requested throttled profile:

**effective = true**.

Because the shaping occurs on loopback at OS packet level, both HTTP and WebSocket traffic use the same network path.

## Ownership and passive-observer rules

Preserved:

- `FPConnection170` — single current WebSocket/reconnect owner;
- `FPLifecycle170` — lifecycle signal normalizer;
- `FPSyncCoordinator176` — thin sync adapter;
- existing `app.js` stable WebSocket worker.

Not changed:

- RoomContext/generation/AbortSignal;
- connection runtime;
- reconnect timers;
- sync algorithms;
- server WebSocket implementation;
- cache/storage;
- UI.

`FPRuntime169` was not converted into a reconnect controller.

No production/runtime instrumentation was added.

## Verification

Final GitHub Actions run:

`36447641140` — **SUCCESS**

Measured runtime:

`2bf734e918dfb7e31d14d574d52a7d3256076000`

Measurement head:

`8aef362c3cd93afcb88d0796a70a10848c326669`

Build:

**190.2**

Passed:

- benchmark syntax;
- `check:170`;
- `test:180:single-owner-audit`;
- corrected reconnect benchmark.

Artifact:

- id: `10980919248`;
- digest: `sha256:9b71b2982decfc0ecabdc279dbb9931977bc266bc748e06a3eab7606a1365532`.

## Failed exploratory run

`36446798035` — failed intentionally on acceptance:

`throttled profile effect was not verified`.

That was a stand defect/limitation, not an FPChat runtime regression.

The final stand moved network shaping to Linux loopback packet level and verified its effect before accepting reconnect numbers.

## Files

Measurement:

- `scripts/benchmark-next16-reconnect.cjs`;
- `package.json`.

Documentation:

- this report;
- `docs/performance-next16-reconnect-summary.json`;
- `docs/performance-progress.md`.

The temporary item-16 workflow is removed after preserving the result.

No `public/*`, `server.js`, database/schema, Service Worker or updater file is changed by item 16.

## Limits

- Chromium/Linux CI only;
- no physical iPhone/Android/PWA reconnect acceptance;
- natural offline emulation preserved the WebSocket object in all 10 samples, so natural reconnect latency is correctly **null** rather than inferred;
- confirmed-break recovery uses an explicit raw WebSocket close because this Chromium CDP lacks `Network.closeConnections`;
- five recovery samples per profile; no p95;
- the measured 15 ms / 465 ms values describe recovery after an already-confirmed break, not every real-world mobile outage.

## Rollback

Remove the item-16 benchmark, npm script and item-16 documentation.

There is no runtime rollback, DB migration, cache cleanup or identity reset.

## Continuation

Item 16 is complete.

**Do not start item 17 automatically.**
