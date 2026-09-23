# Build 180.14 — Release decision report

## Purpose

This document prepares a manual release decision for the accumulated FPChat migration from the Build 168 production baseline through the current Build 180 development line.

Build 180.14 does **not** merge to `main`, deploy to production, run the updater on the production host, or change release/version metadata.

## Reference SHAs

| Role | SHA | Notes |
|---|---|---|
| Build 168 production-code baseline | `9c53a7a0329f267a51c7e976f1c4c825d9b7ae42` | `public/version.json` build 168 |
| Current `main` | `4a7da1877f029b4fb5b1300ff84ae7ea541cb69e` | Build 168 code plus two later CHANGELOG-only commits |
| Fully tested executable candidate | `a40beae6a4f70120102f3e8adfbd521ba43999f9` | Build 180.13 full regression + rollback candidate |
| Pre-report development HEAD | `7705a7136304c3fe0d288a2199e37ea40b70a0fe` | differs from tested candidate only by the verified 180.13 documentation result |
| Development branch | `build/180-development` | release work remains isolated from `main` |

The two `main` commits after Build 168 are documentation-only:

- `785387dcaeb8ee8aa758b8b93f281238d873c221` — CHANGELOG only;
- `4a7da1877f029b4fb5b1300ff84ae7ea541cb69e` — CHANGELOG only.

At the start of 180.14, `build/180-development` is 301 commits ahead of and 2 commits behind `main`. Therefore a future merge is not a fast-forward and must deliberately preserve/reconcile those two main-only documentation commits.

## Current release metadata

Release identity has now been finalized as:

```json
{
  "version": "1.0.0",
  "build": "180.14"
}
```

`update.bat` requires the same build:

```text
EXPECTED_BUILD=180.14
```

The settings fallback label, presentation bridge build label/cache suffix and Windows updater contract test use the same build identity.

## Major accumulated changes since Build 168

### Runtime/ownership foundation

- Build 169 introduced passive runtime diagnostics and ownership/baseline instrumentation without taking over behavior.
- Build 170 introduced RoomContext/generation/cancellation/lifecycle and the guarded room/open/send startup chain.
- Build 171 centralized fetch/XHR/cache/media-resource coordination in FPNetwork.
- Build 172 introduced MessageStore canonical state, merge/status/reply dependencies and retained the accepted runtime-only offline queue behavior.
- Build 173 established layer/gesture/scroll/viewport ownership boundaries.
- Build 174 added targeted/chunked rendering, history ownership/anchors and bounded DOM behavior.

### Composition, send and media

- Build 175–177 consolidated bootstrap/composer/send/resource/cache/media boundaries.
- FPComposer/FPSendManager/TextSend/MediaSend ownership is explicit.
- Media preview/thumbnail/viewer and voice UI lifetime ownership was separated from the existing voice recording worker.
- Cache/resource arbitration preserves existing cancellation and progress behavior.

### Render/read/gesture/geometry

- Build 178 finalized MessageStore incoming/status/reply/history boundaries.
- Chat-list/message rendering, read admission/flush, unread presentation, overlay/layer/gesture arbitration and message-scroll/viewport ownership were moved behind accepted owners.
- Direct compatibility fallbacks remain documented instead of being falsely presented as removed.

### Server composition/data paths

- Build 179 removed the production preload bootstrap and made `node server.js` the explicit production entry.
- Message actions/pins/block stores/presence/installers are explicitly composed.
- Encrypted image upload/cleanup and history DB read ownership were isolated and tested.
- History paging uses one accepted read transaction boundary without adding a second DB pool.

### Build 180 finalization

- 180.1–180.3 finalized canonical block truth, bypass removal and invite/block acceptance.
- 180.4–180.7 documented and tested updater/launcher/rollback behavior in isolated Windows copies.
- 180.8–180.10 documented startup ownership and connected the one missing Lifecycle170 fallback failure transition to the existing `FPStartup174.fail()` API.
- 180.11 audited actual writers/listeners/timers rather than manager names.
- 180.12 executed the accumulated automated regression and created the explicit physical 168 → final matrix.
- 180.13 proved the latest runtime transfer can be reverted and restored as an isolated commit without losing neighboring fixes.

## Latest automated acceptance

GitHub Actions run:

```text
35813041982
```

Tested candidate:

```text
a40beae6a4f70120102f3e8adfbd521ba43999f9
```

All three jobs passed:

| Job | Result |
|---|---|
| `cumulative-regression` | PASS |
| `windows-180-acceptance` | PASS |
| `last-transfer-rollback` | PASS |

### Cumulative leaf results

The cumulative runner currently contains 110 leaf checks:

| Result | Count |
|---|---:|
| PASS | 109 |
| EXPECTED_FAIL | 1 |
| FAIL | 0 |
| TIMEOUT | 0 |
| XPASS | 0 |

The only expected failure is:

```text
regression178-release.cjs
```

Reason: it freezes the old Build 178.28.1 updater/launcher release contract that was deliberately replaced by Build 180.4–180.7. The replacement contract is covered by current static and isolated Windows tests. It is not counted as PASS.

## Rollback evidence

Build 180.13 uses a real disposable Git worktree with full history.

It proved that the latest runtime transfer:

```text
294cf56bd5b4eaee7e8331d9586cdded4b9fd699
Build 180.10: connect lifecycle fallback failure to startup readiness
```

can be reverted independently.

Verified:

- rollback changed only `public/room-context170.js`;
- neighboring fixes remained present;
- the target init-coordination test failed at the exact missing Lifecycle170 failure boundary after rollback;
- revert-of-revert restored a tree identical to the source candidate;
- the same target test passed after restoration.

## Remaining limitations / open release items

### Physical acceptance deferred

Physical testing is intentionally deferred and remains **NOT RUN**, not PASS.

The open matrix is documented in:

```text
docs/Build180_12_Final_Regression_Matrix.md
```

It includes real-device checks for:

- Windows desktop browser;
- second physical participant/device;
- iPhone/Safari PWA;
- weaker Android device;
- real text delivery/read/reconnect;
- drafts/replies/edit/delete/pins/context selection;
- first-unread/saved-scroll/prepend/long-history behavior;
- mobile back gesture/keyboard/orientation;
- real photo/video/voice send/play/cancel/viewer;
- real microphone behavior;
- push notification count/privacy;
- presence/background behavior;
- real invite/block flows;
- actual Windows host launcher/update/rollback;
- WAN/Cloudflare tunnel behavior.

These are not prerequisites for continuing development, but they remain prerequisites if the release policy requires full physical parity confirmation before production.

### Version identity finalized

The release candidate is identified consistently as Build `180.14` across version metadata, user-facing fallback labels/cache suffix and updater build gate.

### Development/main histories diverge

`main` contains two CHANGELOG-only commits not present in development history.

A future merge/cherry-pick/rebase must preserve their content deliberately. Do not force-update `main`.

### Historical expected-failure test

`regression178-release.cjs` remains an explicit historical expected failure and must stay documented until it is removed or replaced by a deliberate release-test cleanup step.

## Release decision state

### Automated state

**ACCEPTED**

The currently tested executable candidate has:

- zero unexpected regression failures;
- zero timeouts;
- zero XPASS results;
- successful isolated Windows updater/launcher/rollback acceptance;
- successful isolated architectural rollback/recovery of the latest runtime transfer.

### Physical state

**DEFERRED / NOT RUN**

No physical-device or live-production claim is made by this report.

### Production state

**UNCHANGED**

Build 180.14 does not:

- merge `build/180-development` into `main`;
- update `main`;
- run `update.bat` against production;
- run `start_chat.bat` on production;
- change production data/config/dependencies;
- deploy through Cloudflare or any other production mechanism.

A release requires a separate explicit decision/action after this report.

## Suggested manual release sequence when chosen later

1. use the finalized Build 180.14 release identity;
2. reconcile the two main-only CHANGELOG commits;
3. run the full Build 180 workflow against the exact release SHA after any version/merge changes;
4. optionally perform the deferred physical matrix;
5. create the explicit merge/release commit;
6. update the isolated/test installation first;
7. verify launcher/update/rollback behavior on the target Windows host;
8. only then update production.

No step above is executed automatically by Build 180.14.
