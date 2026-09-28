# FPChat 190.2 — Telegram-like scroll position restore fix

Date: 2026-09-29

Branch: `fix/190.2-scroll-restore-races`

Base: `optimization/performance-series@1e06e79d95f1ed87a7b605b659929c39bfc36127`

Build: **190.2**

Status: **implemented and green on isolated Chromium/Linux acceptance; physical iPhone/Android acceptance is not executed**.

No production deployment and no merge to `main` were performed.

## Problem reproduced before the fix

A deterministic pre-fix run was executed against commit `3bd06fd942`, whose parent is the optimization base before the runtime fix.

Workflow:

- run: `36465313536`;
- conclusion: **SUCCESS**.

It reproduced all three reported races:

1. **Late old PUT overwrites newer position**
   - old non-bottom anchor PUT was held;
   - a newer true-bottom PUT reached the server first;
   - when the old request was released, the pre-fix server accepted it and the row returned to the old anchor.

2. **Immediate reopen races the leave save**
   - final true-bottom PUT was held;
   - `leaveActiveChat` returned immediately;
   - immediate reopen joined while the server still contained the older anchor;
   - the old anchor was restored instead of the true tail.

3. **Direct A -> B loses A**
   - native A scroll scheduled the old 900 ms trailing save;
   - direct `openChat(B)` occurred before the timer;
   - there was no A view-state write;
   - the delayed timer later resolved `state.roomId` as B and wrote B.

Log markers:

- `REPRODUCED A delayed old PUT overwrites newer bottom on pre-fix server`;
- `REPRODUCED B immediate reopen restores stale server anchor before held leave PUT`;
- `REPRODUCED C direct A->B loses A and old timer writes B`;
- `BASELINE_SCROLL1902_REPRO PASS`.

The baseline harness uses the existing `FPNetwork171.use()` test middleware entry instead of replacing `window.fetch`; Build 171 correctly rejects unowned fetch replacement.

## Confirmed causes and fixes

### A. Out-of-order server writes

**Cause**

The old view-state API had no ordering token. SQLite upsert used arrival order, so a request captured earlier could arrive later and overwrite a newer bottom/anchor.

**Fix**

An additive `chat_view_state.client_seq INTEGER NOT NULL DEFAULT 0` column was added.

Current ordered writes:

- client allocates a persistent per-device `clientSeq`;
- server accepts only a strictly newer ordered state;
- stale/equal ordered PUT returns HTTP 409 `VIEW_STATE_STALE` and the current authoritative state;
- legacy unversioned clients remain accepted only while the row is still legacy (`client_seq=0`);
- once an ordered client owns the row, a late legacy write cannot overwrite it.

Result: late completion is harmless even if the request itself cannot be cancelled.

### B. Leave/reopen race

**Cause**

The old path depended on the final network PUT. `leaveActiveChat` fired the save without waiting, while immediate reopen could finish join before the PUT.

**Fix**

`FPScroll173` now persists a compact durable local snapshot before relying on the network:

- stable message anchor;
- viewport-relative offset;
- true-tail flag;
- room/device;
- capture/context/tab metadata;
- ordered `clientSeq`.

The normal guarded join still performs the access check. It carries the latest durable `viewStateCandidate` in the existing `POST /join` request. The server applies that candidate through the same ordered view-state guard **after access validation**, then selects the initial history window from the resulting authoritative state.

Opening therefore does not wait for the standalone PUT and does not render history before access is confirmed.

### C. Direct A -> B race

**Cause**

The old global 900 ms timer did not own a concrete room snapshot. When it fired, `saveViewStateNow` read the then-current `state.roomId`, which could already be B.

**Fix**

Before `room-open170` begins the new transition, it asks the existing `FPScroll173` to freeze A:

`FPScroll173.captureBeforeLeave('direct-room-switch')`.

The awaited part is only local durable snapshot sequencing. The network PUT remains fire-and-forget, so a slow server save does not gate opening B.

Delayed work is now bound to the captured room/snapshot rather than re-resolving the room through later global state.

## Existing owner model

No new manager/coordinator/store/scheduler was introduced.

### FPScroll173

Still the sole active owner of programmatic `#messages.scrollTop`.

It now also owns the closely related position contract:

- user/programmatic intent discrimination;
- stable anchor + offset capture;
- true-tail decision;
- initial restore arbitration;
- interruption by real user scroll;
- bounded local persistence;
- bounded server flush scheduling;
- old-room capture before transition;
- acceptance of authoritative ordered server state.

### RoomContext170 / room-open170

Still owns room transition generation/cancellation/access-check join.

It does not become a scroll writer. It only requests a concrete old-room snapshot from FPScroll173 and passes the new room's durable candidate through the guarded join.

### FPHistory174

Still owns bounded history windows/paging. It does not become position persistence owner.

### FPLifecycle170

Still owns lifecycle normalization. Available lifecycle events request a final FPScroll173 capture, but lifecycle is not the only durability mechanism and does not re-run restore over a live correct viewport after bfcache/return.

### FPGesture135 / viewport owners

Gesture arbitration and viewport/keyboard responsibilities remain unchanged. Explicit reply/pin/unread/bottom actions continue to route through established FPScroll173 entry points.

### STORAGE

Only persistence medium for compact position metadata; not a controller.

### FPRuntime169

Remains passive diagnostics only.

The ownership map is updated in `docs/Build178_26_Geometry_Writer_Map.md`.

## Restore contract implemented

The opening arbitration now follows this practical order:

1. an explicit focus/bottom action already requested during opening;
2. real user scrolling that interrupts the unfinished restore;
3. valid saved **non-bottom** anchor + saved viewport offset;
4. first unread when no usable saved reading position exists;
5. true tail.

Consequences:

- leaving while reading old history restores the same message/offset even if new messages arrived;
- a saved true-tail state does **not** suppress new unread: first unread is shown;
- deleted/unavailable saved anchor falls through predictably to unread, then tail;
- reply/pin/explicit navigation is not overwritten by a delayed background restore;
- once the user starts scrolling during opening, the late restore yields;
- `hasNewer` / locally newer history means the loaded-window bottom is **not** treated as true chat end;
- restoring geometry does not itself mark messages read; existing visibility admission remains responsible.

## Durable local snapshot and process-kill boundary

Local capture interval while position is changing:

**300 ms**

Network maximum scheduled lag while the page remains runnable:

**900 ms**

This is intentionally not a write/layout pass on every scroll pixel.

The controlled benchmark measured:

- 48 scroll events over 1.2 s;
- 8 local snapshot writes;
- 2 network PUTs;
- total measured capture cost: 1.1 ms;
- average capture cost: **0.14 ms**.

A hard browser/PWA process kill can restore only the **last snapshot actually persisted locally**. The implementation does not promise the unsaved final pixel if the OS destroys the process before another local capture executes. Under an actively running page the declared capture interval is 300 ms; OS suspension/browser scheduling can still prevent a pending capture from running.

## Multi-tab ordering

The client keeps a durable per-device sequence floor and uses the Web Locks API when available to serialize sequence allocation across tabs.

The server independently rejects stale/equal sequence writes, so a stale background tab cannot overwrite a newer accepted position.

The regression suite verifies the important active-vs-stale-background case.

Residual portability limit: on a browser without Web Locks, the persistent local floor plus wall component is best-effort for simultaneous allocation. The server still prevents stale/equal overwrite; a theoretical equal-sequence collision can discard one concurrent write rather than corrupting the accepted state with an older write.

## Initial window integration

The optimization from follow-up items 11–13 remains intact.

For `initialWindow:true`:

1. participant/access is validated;
2. an ordered durable candidate, if present, is reconciled;
3. authoritative current view-state is read;
4. valid saved non-bottom window is attempted;
5. if unavailable/deleted, first unread is attempted;
6. otherwise tail is returned.

This prevents the client from receiving a window around an old server anchor and merely replacing metadata afterward.

## Verification

Final expanded verification:

- workflow: `36464252383`;
- head: `7d1dabef62ae6b568f02f4e80901935ae2b0e6c7`;
- conclusion: **SUCCESS**.

The runtime did not change after the controlled benchmark; later changes before this verification were test/workflow alignment only.

Passed:

- syntax;
- app revision contract;
- corrected three-race assertions;
- scroll resilience browser scenarios;
- offline leave/network recovery;
- initial-window regression;
- scroll owner contract;
- saved-anchor regression;
- delayed-history user-scroll regression;
- reply/pin jump regression;
- unread/tail Telegram behavior;
- same-session MessageStore reuse;
- RoomContext regression;
- history-page owner;
- gesture/scroll ownership;
- chat-back scroll behavior;
- scroll-writer ownership;
- keyboard/orientation;
- header/keyboard;
- bounded DOM;
- read visibility contract;
- late thumbnail/layout behavior;
- single-owner audit.

### Key scenario outcomes

Corrected race suite:

- stale ordered PUT rejected / current state preserved: **PASS**;
- reopen with failed standalone leave PUT uses durable candidate: **PASS**;
- direct A -> B persists A, does not rebind old timer to B, A -> B -> A restores offset: **PASS**.

Resilience suite:

- user scroll interrupts delayed restore: **PASS**;
- explicit focus during opening wins: **PASS**;
- cold start from previously persisted browser profile restores the durable snapshot without final lifecycle network save: **PASS**;
- stale background tab cannot overwrite active position: **PASS**;
- bfcache-style pageshow does not re-restore live viewport: **PASS**;
- deleted anchor falls back to first unread: **PASS**.

Offline suite:

- offline leave retains durable local position: **PASS**;
- normal guarded join after network recovery reconciles the snapshot and restores pixel offset: **PASS**.

Related contracts:

- old-history + newly unread keeps saved reading position: **PASS**;
- true-tail + newly unread opens first unread: **PASS**;
- restore/read separation: **PASS**;
- bounded DOM: **PASS**;
- late thumbnail/layout: **PASS**;
- keyboard/orientation paths: **PASS**;
- single scroll owner: **PASS**.

## Controlled before/after measurement

Workflow:

- `36462365373` — **SUCCESS**;
- benchmark runtime head: `e8e4438b1299e40c3cfa86e16edcaf4b4e6492ef`;
- artifact id: `10987728579`;
- digest: `sha256:2bac072ba7ace880801db379c98543c46773f5871a7f150e224bff7e7ff90139`.

Same runner and fixture for before/current:

- isolated Linux headless Chromium;
- local SQLite;
- 390×844 viewport;
- 48 scroll events / 1200 ms;
- 1100 ms post-scroll wait.

| Measurement | Before | Current |
| --- | ---: | ---: |
| Scroll handler median | 0.3 ms | **0.3 ms** |
| Scroll handler range | 0.2–0.6 ms | 0.2–1.2 ms |
| Durable local snapshots observed | 0 | **8** |
| Network view-state PUTs | 1 | **2** |
| Durable local snapshot exists | no | **yes** |
| Capture average | unavailable | **0.14 ms** |
| Leave wall time | 6 ms | **6 ms** |
| Reopen wall time | 161 ms | **163 ms** |
| Reopen join POSTs | 1 | **1** |
| Post-open message GETs | 4 | **4** |
| Restored anchor offset error | 0 px | **0 px** |

The single reopen sample 161 -> 163 ms is not treated as a regression or speedup claim. The measured median scroll-handler cost stayed 0.3 ms.

The known extra post-open message requests are unchanged by this scroll fix.

## Files changed from optimization base

Runtime/data contract:

- `public/app.js`;
- `public/room-open170.js`;
- `public/version.json` (app revision/build metadata);
- `server.js`;
- `src/db.js` (additive `client_seq` migration).

New/updated tests and measurement:

- `scripts/audit1902-scroll-save.cjs`;
- `scripts/regression1902-scroll-resilience.cjs`;
- `scripts/regression1902-scroll-offline.cjs`;
- `scripts/reproduce1902-scroll-baseline.cjs`;
- `scripts/benchmark1902-scroll-persistence.cjs`;
- related existing scroll/history/unread/back/writer regressions aligned to the new contract;
- `package.json`.

Documentation:

- `docs/Build178_26_Geometry_Writer_Map.md`;
- this report;
- `docs/scroll1902-restore-fix-summary.json`;
- `docs/performance-progress.md`.

Temporary GitHub Actions workflows used for isolated verification/benchmark/reproduction are removed after results are preserved.

## Physical-device status

Physical iPhone: **NOT EXECUTED**.

Physical Android: **NOT EXECUTED**.

Desktop/headless Chromium and mobile viewport simulation are not counted as physical-device validation.

### Short manual acceptance for each device

1. **Old history**
   - open a long chat and stop on an older message;
   - note roughly where the message sits in the viewport;
   - go to chat list and reopen;
   - expect the same message at the same offset.

2. **New messages while away**
   - repeat while stopped in old history, have the peer send messages, reopen;
   - expect the old reading position to remain;
   - then leave from the real tail, have the peer send messages, reopen;
   - expect first unread, not an arbitrary old position.

3. **Interrupt restore**
   - reopen a long chat and immediately start scrolling while history/layout is still settling;
   - expect no delayed snap-back.

4. **Explicit jumps**
   - use reply target, pinned-message jump and unread/down button;
   - each explicit target must win and remain stable.

5. **Media/keyboard/resize**
   - test a history area containing photos;
   - open/close keyboard and rotate/change viewport if supported;
   - expect no unexplained position jump.

6. **Real background**
   - with a non-bottom position, go Home / another app for ~30 s, then return;
   - expect the live viewport to remain or restore correctly without a second late jump.

7. **System app switcher/process kill**
   - scroll to a known old position;
   - continue normal scrolling for at least about 1 second so periodic local capture has opportunities to run;
   - kill FPChat/browser/PWA from the operating-system app switcher/task manager **without relying on a final lifecycle event**;
   - cold launch and reopen the chat;
   - expect the last successfully persisted snapshot, not necessarily the final unsaved pixel.

8. **Offline**
   - choose an old-history position, disable network, leave chat;
   - restore network and reopen;
   - expect the durable local position to reconcile through normal join.

## Remaining limits

- no physical iPhone/Android acceptance yet;
- OS process destruction can lose movement after the last successful local snapshot;
- Web Locks absence weakens strict cross-tab sequence allocation to best-effort client allocation, while server stale/equal rejection remains authoritative;
- isolated CI does not validate production Cloudflare/network latency;
- controlled reopen wall timing is only a single navigation sample;
- the broader known post-open extra message-fetch behavior is unchanged and outside this scroll fix.

## Rollback

Safe code rollback target is the optimization base:

`1e06e79d95f1ed87a7b605b659929c39bfc36127`.

No destructive DB downgrade is required. The additive `chat_view_state.client_seq` column may remain; older code ignores the extra column.

If runtime/server code is rolled back, stale-write ordering protection is naturally lost again, so rollback should be treated as rollback of the scroll fix, not as equivalent behavior.

Local position keys introduced by the fix are non-secret metadata and may remain; removing them is not required for compatibility.

## Final status

All three reproduced scroll races are prevented by the current branch under deterministic tests, and the wider existing scroll/history/unread/gesture/keyboard/read/bounded-DOM contracts are green.

The branch has **not** been merged to `main` and has **not** been published to the FPChat server.
