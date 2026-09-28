# FPChat performance optimization progress

## Current state

- Series status: **Steps 1–4 completed; follow-up prompts documented, implementation pending**.
- Active follow-up plan: [Small development prompts after Step 4](performance-next-steps-prompts.md), recorded 2026-09-28 at the user's request.
- Follow-up numbering is independent of the original step table. Start with the browser reproduction of the repeated-send lock (new plan item 1), then execute only the item the user supplies.
- This follow-up order supersedes the historical "Step 5 next" instructions below; those entries remain the record of the Step 4 handoff. Original steps are not automatically completed by a follow-up subtask.
- Repository: `Freep-o-0-rn/FPChat`.
- Verified source branch: `build/190-media-swipe-preview`.
- Verified source build: **190.2**.
- Verified source SHA: `7fa7a4b0d64c22d4aa809692032a0c1dd0f3aced`.
- Performance working branch: `optimization/performance-series`.
- Branch base: exactly `7fa7a4b0d64c22d4aa809692032a0c1dd0f3aced`.
- At Step 1 verification there were no newer commits on `build/190-media-swipe-preview`.
- `AGENTS.md` is not present anywhere in the verified tree; no repository-local AGENTS instructions were available to apply.
- `public/version.json` remains Build 190.2. Step 1 does not assign a new build number.
- Production/server state is not changed by this step and is not inferred from GitHub.
- The GitHub operation cannot inspect or overwrite a user's uncommitted local working tree; creating this remote branch from the verified SHA leaves local files untouched.

## Architecture ownership map

The map below is based on the current code at the verified base. It distinguishes owner/arbiter responsibilities from executors and consumers instead of inventing new managers.

| Area | Real owner / arbiter | Executors / consumers | Files and boundaries |
| --- | --- | --- | --- |
| Startup / boot | `FPBoot152` + `FPStartup174` startup contract | `boot-ready152.js` releases the UI after required owners/assets are ready | `public/index.html`, `public/boot-ready152.js`. `FPStartup174.ready` is a dependency/readiness promise, not a second app coordinator. Preload fetches do not change execution order. |
| Browser lifecycle | `FPLifecycle170` | subscribers react to normalized lifecycle events | `public/lifecycle170.js`. It normalizes signals only; it does not reconnect WS, sync, render, or cancel room work itself. |
| Room context | `FPRoomContext170` | room/open/send operations use captured context | `public/room-context170.js`. Owns room generation, transition context, operation `AbortController`/`AbortSignal`, commit/end checks. |
| Room open / join | `room-open170` active owner using `FPRoomContext170` | existing renderer and history path perform rendering | `public/room-open170.js`. Join requests use the room context signal and stale checks after awaits. |
| WebSocket current slot / reconnect | `FPConnection170` | legacy/app workers consume the current socket | `public/connection170.js`. Owns one stable current WebSocket/reconnect slot and socket generation. |
| Sync triggers | `FPSyncCoordinator176` is a thin adapter, not a state owner | `syncAllRoomsAfterReconnect` and `startAppSessionSync` in `public/app.js` | `public/sync-coordinator176.js`, `public/app.js`. No separate queue/retry/polling state is owned by the adapter. |
| Network / XHR | `FPNetwork171` | feature layers call normal fetch/XHR or `FPNetwork171.upload` | `public/network171.js`. Owns centralized fetch/XHR dispatch and media download admission/budget. |
| Media CacheStorage physical mutation | `FPNetwork171` mutation gate | `FPStorage167` cache policy/read path; `FPStorage167ClearGuard` exclusive clear coordination | `public/network171.js`, `public/storage167.js`, `public/storage167-clear-guard.js`, `public/storage167-cache-fix.js`. Managed cache is `fpchat-media-v167`; clear waits for active media/cache work. |
| Canonical message state | `FPMessageStore172` | render/history/status consumers read merged records | `public/message-store172.js`. Owns merge precedence, identity promotion, status monotonicity and tombstones. It does not create a persistent outgoing queue. |
| Retry of pending text sends | existing runtime queue in `app.js` | `FPTextSend170` queues into it; ACK/status clears/promotes it | `public/app.js`, `public/text-send170.js`. Current queue remains runtime-only. |
| History mounted range | `FPHistory174` | `FPWork174` slices work; MessageStore supplies canonical state; FPScroll performs scroll writes | `public/history174.js`, `public/work174.js`. Current constants are `PAGE=100`, `LIMIT=300`. History owns the mounted window, not canonical message content. |
| Message rendering | current renderer surface in `app.js`; `FPMessageRender178` is the incoming-message adapter | `appendMessage`, `renderChatView`, history renderer | `public/app.js`, `public/history174.js`. This is an execution surface, not a second message store. |
| Media lifecycle | `FPMediaManager177` | preview, voice UI, microphone and viewer lifecycle consumers | `public/app.js`. Owns preview identity/open/close/cancel, generated preview thumbnail ObjectURL lifecycle, voice UI delegation, microphone resource lifecycle and viewer open/close delegation. |
| Media viewer interaction | admission/claim: `FPGesture135`; layer priority: `FPLayer173`; executor: runtime owner `media-gallery185` | photo pan/pinch, viewer swipe, video picture-surface gesture | `public/media-gallery134.js`, `public/gesture-manager135.js`, `public/layer-manager173.js`. Gallery also carries its own generation checks for stale hydration/assets. |
| Media I/O | `FPNetwork171` is network/cache owner | common `readEncryptedMedia174` path and gallery/message consumers | `public/network171.js`, `public/app.js`, `public/media-gallery134.js`. Resource admission remains centralized; consumers keep AbortSignal/generation checks. |
| Send dispatch | `FPSendManager177` thin stateless dispatcher | `FPTextSend170`, `FPMediaSend170`, voice executor in `voice.js` | `public/send-manager177.js`, `public/text-send170.js`, `public/media-send170.js`, `public/voice.js`. Dispatcher owns no queue or message state. |
| Text send | `FPTextSend170` | runtime retry queue + MessageStore/render path | `public/text-send170.js`, `public/app.js`. Captures room/key/device context and starts a room operation before async work. |
| Media send | `FPMediaSend170` | `FPNetwork171.upload` + stable WS | `public/media-send170.js`. Validates prepared thumbnail, uses room operation signal, and cleans pending upload on cancellation before commit. |
| Voice send | voice executor in `voice.js`, dispatched through `FPSendManager177` | media/network/WS path | `public/voice.js`. Starts `FPRoomContext170.beginOperation(..., 'voice-send')`; no separate send manager is introduced. |
| UI layer state | `FPLayer173` | overlays/viewer/selection/composer claim layer tokens | `public/layer-manager173.js`. Owns priority and current top layer. |
| Gesture arbitration | `FPGesture135` | drawer/reply/selection/voice/viewer executors request/claim actions | `public/gesture-manager135.js`. It is the arbiter; feature executors retain their specific behavior. |
| DOM lifecycle observation | `FPDOM173` | feature modules subscribe to mounted/unmounted events | `public/dom-lifecycle173.js`. DOM is a projection; this owner does not own chat/message state. |
| Message scroll geometry | `FPScroll173` | history, unread, reply focus, viewport helpers delegate writes | `public/app.js`. It is the message-scroll writer for bottom/focus/prepend preservation. |
| Mobile viewport geometry | `FPViewport173` | keyboard/orientation/visual viewport corrections; delegates message bottom pinning to `FPScroll173` | `public/viewport-fix.js`. It owns mobile viewport geometry, not message history/scroll state. |
| Keyboard/list surface state | `FPViewport136` | layout synchronization | `public/viewport-layout136.js`. Registered as keyboard-state owner; not a replacement for `FPScroll173`. |
| Performance observation | `FPRuntime169` only observes | owners emit explicit loading hooks; browser Performance API supplies bounded resource/long-task observations | `public/runtime169.js` plus explicit owner hooks. It must not become a scheduler, transport, store, renderer, gesture owner or state coordinator. |

## FPRuntime169 contract

Verified in `public/runtime169.js`:

- the file explicitly states that it does **not** own chat logic, transport, rendering, gestures, storage or message state;
- `registerOwner` records ownership metadata only;
- resource and long-task data are observed through browser Performance APIs;
- `loading` uses explicit owner hooks and a bounded record set;
- room traces are tied to existing room contexts and cancellation;
- no text, room/media/device/message IDs, URLs, keys, request bodies or raw error messages are intended in the loading export;
- missing/unsupported measurements are not to be interpreted as zero.

Known diagnostic drift recorded for **Step 3**, not changed in Step 1: the current loading report still hardcodes `build: '186.5'` and downloads as `FPChat-186.5-loading.json` even though the verified client build is 190.2. This is documentation only here; runtime remains untouched.

## Rules for the optimization series

1. Execute only the requested step. Keep one independently reviewable logical change at a time.
2. If multiple independent causes are discovered, fix at most one in the current step and record the rest as explicit substeps.
3. Before changing runtime behavior, record the reproduced delay/problem, responsible owner and verification method.
4. If the problem is already solved in current code, document that result instead of changing code for activity's sake.
5. Preserve existing managers/arbiters and single writers. Do not add a duplicate scheduler, store, WebSocket owner, cache writer, gesture arbiter or persistent outgoing queue.
6. Preserve room generation/AbortSignal checks, post-await freshness checks, idempotency, ACK/clientMessageId, unread/anchor behavior, access control, device identity/recovery, `data/.env` and privacy.
7. `FPRuntime169` stays passive. No global API interception is added for diagnostics, and diagnostics must not collect message text, secrets, IDs or URLs.
8. Keep diagnostic storage bounded. A missing metric is unknown, not zero.
9. Before each behavioral patch, save a baseline. After it, run relevant regressions plus cancellation/error/repeated-call checks and compare before/after measurements.
10. Do not disable behavior tests or source guards merely to make the suite green; classify stale guards separately from behavioral failures.
11. Do not run a full `npm install` when dependencies are already usable. Tests use isolated data.
12. Do not clear user identity or change production during the optimization series.
13. Do not change a real build number merely to label internal performance steps. Step number + commit SHA identify intermediate states until release preparation.
14. After every step update this file with status, change/reason, owner, commit/diff, measurements, tests, unverified items, rollback and exact next step. Do not start the next step automatically.

## Step table

| Step | Status | Scope |
| ---: | --- | --- |
| 1 | **done** | Working branch, architecture map and rules |
| 2 | **done** | Baseline regressions green after stale source-guard maintenance; no runtime behavior change |
| 3 | **done** | Observer coverage; existing stage hooks sufficient; export build identity corrected |
| 4 | **done** | Five-run Chromium baseline: normal/throttled, 30/1000/10000 messages, media, send, reaction, scroll and 10 s outage |
| 5 | pending | One confirmed startup wait |
| 6 | pending | One confirmed critical JS/CSS resource |
| 7 | pending | One confirmed server join/history bottleneck |
| 8 | pending | One confirmed media-card geometry jump |
| 9 | pending | Earlier useful text/composer |
| 10 | pending | Initial history-window experiment |
| 11 | pending | Reuse existing RAM state |
| 12 | pending | Decide whether persistent history cache is needed |
| 13 | conditional | Storage adapter only if Step 12 justifies it |
| 14 | conditional | Cache write/invalidation only if Steps 12–13 justify it |
| 15 | conditional | Cache read only if Steps 12–14 justify it |
| 16 | pending | Prioritize selected viewer media before neighbors |
| 17 | conditional | Media queue priority only if Step 16 is insufficient |
| 18 | pending | One confirmed cache-maintenance conflict |
| 19 | pending | One message-status render hotspot |
| 20 | pending | One reaction/edit/dependency render hotspot |
| 21 | pending | One confirmed main-thread long task |
| 22 | pending | Bounded DOM/history anchor |
| 23 | pending | One measured geometry/gesture conflict |
| 24 | pending | One duplicate sync/join/history path |
| 25 | pending | Send/retry/ACK responsiveness on poor network |
| 26 | pending | One background/resume duplicate operation |
| 27 | pending | One confirmed resource leak |
| 28 | conditional | Worker only for remaining measured CPU bottleneck |
| 29 | conditional | Visual-effect reduction only if profiling proves cost |
| 30 | pending | Full functional/race regression matrix |
| 31 | pending | Device performance acceptance against Step 4 |
| 32 | pending | Release build, updater consistency and rollback |

## Step 1 verification

### Changed

- Created remote branch `optimization/performance-series` from the exact verified 190.2 SHA.
- Added this progress document.
- No application/runtime/server behavior was changed.
- No version, service worker cache suffix, updater build, schema or dependency was changed.

### Measurements

None. Step 1 is architecture/process setup; no performance result is claimed.

### Tests

No behavioral suite was required for this docs-only change. The base SHA and branch state were read directly from GitHub, and ownership was checked against current source files.

### Unverified / open

- Physical iPhone/Android behavior is not part of Step 1.
- Production deployment/version was not inspected or changed.
- The user's local uncommitted working tree is not visible through the GitHub connector.
- The hardcoded 186.5 loading-report label is recorded for Step 3 and intentionally not fixed here.

### Rollback

Delete `optimization/performance-series` or reset it to `7fa7a4b0d64c22d4aa809692032a0c1dd0f3aced`. The source branch `build/190-media-swipe-preview` is untouched.

## Continuation point

**Current continuation: Step 5 — investigate one confirmed startup wait.**

Steps 2–4 are complete. The next permitted change is the single startup bottleneck selected from the Step 4 baseline; do not combine it with room/history/media optimization.


## Step 2 — baseline regressions

Status: **done**.

### Baseline execution environment

The repository could not be cloned into the assistant container because that container could not resolve `github.com`. This is an assistant-environment limitation, not an FPChat test failure.

To execute the repository tests on the actual branch, a temporary GitHub Actions workflow was added only for Step 2 and then removed. It used:

- GitHub-hosted Ubuntu 24.04;
- Node.js 22.23.2;
- npm 10.9.8;
- Playwright 1.55.0;
- Playwright Chromium 140.0.7339.16;
- production dependencies from the committed lockfile with `npm ci --omit=dev --no-audit --no-fund`;
- synthetic/isolated server data created by the existing browser harnesses.

The temporary CI workflow is not present in the final tree.

### Minimal baseline set selected

| Area | Commands |
| --- | --- |
| Startup | `npm run test:186:startup` |
| Room/context | `npm run check:170` |
| Send/ACK | `npm run test:177:send-entry-contract`; `npm run test:177:text-dispatch`; `npm run test:178:message-store-ack` |
| History/anchor/DOM | `npm run test:178:history-saved-anchor`; `npm run test:178:bounded-dom` |
| Ownership | `npm run test:180:single-owner-audit`, with `npm run check:171` used to distinguish network-owner semantics from stale source inventory |
| Media/current Build 190 | `npm run test:190` |

The existing Build 190 workflow had already passed on the exact source SHA `7fa7a4b0d64c22d4aa809692032a0c1dd0f3aced` before the optimization series. Step 2 repeated the current media gate on the performance branch as well.

### Results

#### Startup — PASS

`npm run test:186:startup` passed.

Confirmed by the existing suites:

- preload preserves owner execution order;
- one reveal boundary remains;
- delayed system/request data does not block UI reveal;
- pending CSS still holds the splash;
- failed optional assets settle without blocking installed owners;
- failed required owner produces the retry UI instead of a partially owned chat;
- direct `/chat` and invite entry remain behind owner readiness;
- text send remains available after direct room entry;
- asset timeout evidence remains bounded/frozen;
- update splash/reload path remains intact.

The browser suite itself reports an isolated Linux Chromium environment and explicitly leaves physical mobile startup acceptance open.

#### Room/context — PASS

`npm run check:170` passed.

The check confirmed syntax and critical ownership invariants including RoomContext generations, independent send operation contexts, captured room keys, Connection170 subscription and absence of a second WebSocket constructor in Connection170.

#### Send / retry / ACK — PASS

All selected send checks passed.

Confirmed:

- one text form entry dispatches one `FPTextSend170` executor;
- double submit creates one logical pending text/clientMessageId;
- transport-offline pending text resends after reconnect;
- A → B navigation does not redirect the source-room send;
- ACK/echo preserves one logical message and retry reuses clientMessageId;
- exactly one text message is saved in the browser integration fixture;
- canonical MessageStore identity survives optimistic → ACK/remount;
- old history does not beat edit or resurrect delete;
- stronger delivery status remains monotonic.

No uncaught browser errors were reported by the text-dispatch integration test.

#### History / anchor / bounded DOM — PASS

The selected history checks passed.

Confirmed:

- saved anchor can be loaded through `FPHistory174.around`;
- saved message id and pixel offset survive the server round trip;
- initial restore waits for layout and uses the existing `FPScroll173` path;
- bounded DOM remains `LIMIT=300`, `PAGE=100`;
- unread outside the mounted range is preserved;
- DOM eviction preserves selection identity;
- optimistic Store/retry state survives eviction and later ACK without a mounted node.

#### Media / Build 190 — PASS

`npm run test:190` passed on the performance branch.

It included:

- displayed build/updater labels;
- Build 189.11 system-push integration;
- Build 190 owner/arbiter contract;
- video deferred-claim swipe contract;
- thumbnail generation/fallback/upload invariants;
- Build 190.2 video-only play badge;
- MediaManager177 viewer lifecycle;
- Build 185 photo zoom browser suite (16 groups);
- Build 186.2 media/cache browser suite (9 groups);
- Build 190 browser acceptance (8 groups).

The Build 190 browser acceptance confirmed video tap without gesture claim, horizontal navigation, up/down dismiss, native-touch drag admission, one-shot broken/missing video thumbnail fallback and rejection of zero-plaintext encrypted thumbnails.

Physical video playback/device behavior is still not proven by Chromium automation.

### Ownership audit — source-guard drift found

The initial `test:180:single-owner-audit` failed before reaching later assertions.

#### 2.1 — fixed stale fetch-assignment inventory

Initial failure:

`unregistered legacy window.fetch assignment exists`

The audit required the active files containing `window.fetch =` to equal all `FPNetwork171.LEGACY_SPECS` entries exactly.

Current reality:

- `room-lifecycle.js` no longer assigns `window.fetch`;
- it captures `window.fetch.bind(window)`;
- at the real startup point this is already the FPNetwork171 coordinator;
- `FPNetwork171` intentionally retains the `room-lifecycle.js` legacy spec as compatibility admission;
- `check:171` explicitly tests that this compatibility spec still exists.

A trial removal of the runtime spec caused `check:171` to fail and was fully reverted. There is **no final runtime/network171 change** from that experiment.

Only the source audit was corrected to distinguish:

- active legacy `window.fetch =` adapters; and
- the compatibility-only `room-lifecycle.js` spec.

Commit carrying the test-only correction: `eca642e033d12d031c573726eea063070b152e29`.

After restoring the runtime compatibility spec, `npm run check:171` passes again.

#### 2.2 — stale canonical block-owner fingerprint maintenance — completed

After 2.1 the same old Build 180 audit progressed further and failed at:

`canonical block owner instance duplicated`

with actual count `0`, expected `1`.

This is currently localized as another stale **exact source fingerprint**, not evidence of a duplicate owner:

- the audit searches for the exact historical string `createUserBlocks165(db)`;
- current `server.js` creates the owner once as `createUserBlocks165(db, { presenceProjector: fpPresencePrivacy187.project })`;
- the current server has one `const fpUserBlocks165 = createUserBlocks165(...)` declaration;
- the extra argument comes from the later presence-privacy integration.

Per the one-small-change rule, this fingerprint was deferred to 2.2 and later fixed there without changing server/runtime behavior.

### Classification of findings

| Finding | Classification | Current status |
| --- | --- | --- |
| Startup suite | behavior | PASS |
| Room/context check | behavior + source invariants | PASS |
| Send/retry/ACK suite | behavior | PASS |
| History/anchor/bounded DOM | behavior + invariants | PASS |
| Build 190 media suite | behavior + owner contracts | PASS |
| Build 180 fetch assignment equality | stale source guard | 2.1 fixed in test only |
| Build 180 exact `createUserBlocks165(db)` matches | stale source fingerprints | **2.2 fixed; relevant owner/block suites green** |
| Assistant container cannot resolve GitHub | environment | bypassed with temporary GitHub Actions harness |
| Missing VAPID keys in isolated CI | environment/config warning | push tests still passed with their isolated fixture; not production verification |
| npm dependency deprecation warnings | environment/dependency warning | not treated as a behavior regression in Step 2 |

### Physical devices not verified

Step 2 does **not** claim physical-device acceptance for:

- iPhone Safari/PWA;
- realme C21Y / physical Android;
- native mobile video playback/control behavior;
- real mobile lifecycle/suspend/resume;
- device-specific keyboard/viewport timing;
- real push delivery through production credentials.

Chromium browser automation is recorded only as browser automation.

### Step 2 changes

Runtime/application behavior: **unchanged**.

Final intended source change from Step 2 so far:

- `scripts/regression180-single-owner-audit.cjs`: source guard now distinguishes the active fetch adapters from the retained compatibility-only `room-lifecycle.js` network spec.

The temporary test workflow was removed. The trial `network171.js` edit was reverted, so `public/network171.js` is back to the verified 190.2 content.

### Measurements

No performance timing baseline was collected in Step 2. That remains Step 4. This step establishes regression behavior only.

### Rollback of Step 2.1

Revert the test-only change in `scripts/regression180-single-owner-audit.cjs` to restore the original Build 180 exact-list assertion. No production/runtime rollback is required because runtime code is unchanged.

### Continuation point

**Step 2 complete. Step 4 baseline was later collected successfully after Step 3.**

The ownership baseline remained green through the measurement stage.


## Step 3 — observer coverage

Status: **done**.

### Coverage map

The existing `FPRuntime169.loading` + owner hooks already cover the requested timing boundaries without adding a second observer or execution coordinator.

| Stage | Existing marks / source | Interpretation |
| --- | --- | --- |
| Boot / loader | `FPBoot152.mark186`: loader/version/core/layers/assets/boot-ready/safety-release | Explicit loader/gate times. `completed:false` means the wait boundary timed out or did not complete; it must not be reported as fully ready. |
| Room key | `key-start → key-ready` in `room-open170.js` | Existing key derivation duration for ordinary room open. |
| Join | `join-start → join-headers → join-ready` in `room-open170.js` | Request start, response headers and parsed join payload. Direct/invite entry remains documented as partial where the trace starts after earlier work. |
| Initial history | `history-start → history-ready` in `app.js`; `history-page` in `FPHistory174` | Initial history hydration duration plus page count. |
| First mounted content | `first-message-mounted` in the existing renderer | First message node mounted after its text/caption decrypt path. This is a first mounted message marker, not a guarantee that the message type itself is plain text. |
| Initial text/render completion | `render-start → text-ready` | Existing renderer finished the initial message batch; message count is allowlisted. |
| Draft/composer | `draft-start → draft-ready → composer-ready` | Draft restore and usable composer boundary. |
| Initial scroll/layout | `scroll-start → scroll-ready`; `layout-wait-start → layout-thumbs-wait-end → layout-wait-end` | Existing initial-position and media-layout waits. |
| Reveal | `messages-revealed → visible-frame` in `chat-opening129.js` | Visibility removal followed by a visible-page RAF opportunity. `visible-frame` is **not** hardware paint or pixel presentation. |
| Media admission queue | `queue-start → slot-ready` in `FPNetwork171` | Time waiting for the existing weighted media resource budget. |
| Managed media cache | cache start/open/meta/match/delete/repair marks + cache state | Distinguishes managed disk-cache hit/miss/expired/error and repair work. HTTP/browser cache is not inferred. |
| Network response/body | `network-start → response-ready → body-start → body-ready` | Existing admitted request and encrypted body-read path. |
| Buffer/crypto | `buffer-start → buffer-ready → decrypt-start → decrypt-ready` | Blob-to-buffer and AES-GCM decrypt boundaries. |
| Media URL/element readiness | `url-ready → element-ready → paint-opportunity` | Element load/loadedmetadata/loadeddata and next-frame opportunity only; not native decode isolation or actual paint. |
| Viewer current vs neighbor | `viewer` records with `gallery-current` / `gallery-neighbor` consumers; parent media records | Current/neighbor work is attributable without collecting media IDs/URLs. |
| Gallery history | `gallery-history` + `history-page` | Separate gallery scan/page count. |
| Long main-thread work | bounded PerformanceObserver `longtask` list when supported | Browser-dependent; unsupported/missing data is unknown, not zero evidence. |

No timing stage gap was found that justified another owner hook in Step 3.

### One diagnostic defect fixed: report build identity

The loading report/export was still hardcoded to Build `186.5` while the verified client is Build 190.2. That made A/B files ambiguous and could cause measurements from different builds to be mislabeled.

The fix is diagnostic only:

- `runtime169.js` reads the already-present `?v=<build>` from its own script URL through `document.currentScript`;
- no fetch, timer, storage read or global interception is introduced;
- the value is accepted only when it matches the numeric build format;
- if unavailable, report `build` is `null` and the filename uses `unknown` instead of fabricating a build;
- current Build 190.2 exports as `FPChat-190.2-loading.json`.

This keeps the existing execution order unchanged. The build query already comes from the loader's existing `version.json` result and is propagated to `runtime169.js` by the existing script loader.

Runtime patch commit: `fdf730861ff9f903de920c02d66ea3a25cd47041`.

Regression assertion update commit: `317775b6ae84f1c5c62448451763bed4426a13ba`.

### Privacy / boundedness / cleanup verification

The existing loading regression passed after the patch and confirms:

- report does not contain fixture room/device/secret/message text/media path/blob URL/raw body error strings;
- metadata remains allowlisted;
- journal remains bounded to 240 records and increments `dropped`;
- unsupported/missing measurements remain absent/null rather than synthesized as zero;
- disabling collection clears active loading observations but does not alter media reads or scroll;
- reset clears loading records while preserving fixed boot evidence;
- queued abort is classified as cancelled and releases the media resource lease;
- unmounted media elements cancel their element watch and remove listeners;
- HTTP, transport, body and crypto failures retain safe error categories without raw private error content;
- an optional-layer timeout remains `completed:false`, not falsely marked ready;
- `visible-frame`/`paint-opportunity` remain frame opportunities, not claims of hardware paint.

### Verification

Temporary CI was used only to execute the existing suites and was removed afterwards.

Environment:

- Ubuntu 24.04 GitHub runner;
- Node 22;
- Playwright 1.55.0 / Chromium;
- isolated synthetic test data.

Passed:

- `npm run check:169`;
- `npm run test:186:browser`;
- `npm run test:190`.

The loading browser regression explicitly passed key/join/history/text/draft/composer/reveal coverage, cold/warm cache differentiation, queue wait/cancel, privacy, bounded export/reset and incomplete-timeout semantics.

`test:190` also stayed green after the observer patch, including current media/browser regressions.

Physical iPhone/Android performance is not claimed by these browser tests.

### Step 3 changes

- `public/runtime169.js`: diagnostic export build identity only.
- `scripts/regression186-loading-browser.cjs`: expect current build and current export filename.
- `docs/performance-progress.md`: coverage/result record.

No application owner, queue, network ordering, room behavior, message state, render ordering, gesture arbitration, cache policy or production configuration changed.

### Rollback

Revert the `runtime169.js` build-identity patch and the paired regression assertion. No data migration, cache cleanup or server rollback is required.

### Continuation point

**Step 3 complete. Step 4 baseline was later collected successfully.**


### Step 2.2 completion

The open baseline blocker was stale source matching around the single canonical `fpUserBlocks165` construction after Build 187 added the `presenceProjector` option:

`const fpUserBlocks165 = createUserBlocks165(db, { presenceProjector: fpPresencePrivacy187.project });`

No duplicate block owner exists in current `server.js`. The regression guards were updated to verify the semantic invariant instead of the historical one-argument source string:

- exactly one `const fpUserBlocks165 = createUserBlocks165(` declaration;
- the canonical owner is created before dependent blocked-invite storage;
- existing block permission/presence/invite/send semantics remain checked by their dedicated suites.

The same stale fingerprint existed in several regression consumers of the same invariant, so they were updated consistently as one logical Step 2.2 maintenance change:

- `scripts/regression180-single-owner-audit.cjs`;
- `scripts/regression180-block-contract.cjs`;
- `scripts/regression180-block-owner-bypass.cjs`;
- `scripts/regression179-explicit-block-stores.cjs`;
- `scripts/regression179-final-composition.cjs`;
- `scripts/regression180-final-architecture-acceptance.cjs`.

No `server.js`, block-store implementation, privacy logic, network owner, cache owner, room owner or client runtime behavior was changed by Step 2.2.

Final Step 2.2 verification on Node 22 / GitHub Actions:

- `npm run test:180:single-owner-audit` — PASS;
- `npm run test:180:block-contract` — PASS;
- `npm run test:180:block-owner-bypass` — PASS;
- `npm run test:179:explicit-block-stores` — PASS;
- `npm run test:179:final-composition` — PASS;
- `node ./scripts/regression180-final-architecture-acceptance.cjs` — PASS;
- `npm run test:187:presence-privacy` — PASS;
- `npm run check:171` — PASS.

The temporary Step 2.2 CI workflow was removed after verification.

Rollback: revert only the regression-source-guard commits listed above. There is no runtime/server/data rollback because application behavior was not modified.

### Active continuation after Step 2.2

Step 4 was subsequently completed. See the Step 4 section below for the current continuation point.


## Step 4 — performance baseline

Status: **done**.

### Measured code and environment

- Runtime baseline SHA: `1c1e0453416203f6c916f214dae36bd1186f0047`.
- Build: **190.2**.
- Successful measurement workflow run: `36387427449`.
- Measurement run HEAD: `4bf9cbdea791aca730da1960ccc89ab8af88cfad`.
- Artifact: `10955296789`, `step4-performance-baseline`, digest `sha256:d8733c9baed9e510358bacf60c3b570538fd1ea32039f23c4d959357d4567f56`.
- Chromium 140.0.7339.16, Linux x64 GitHub runner, Node 22.23.2, 4 vCPU, AMD EPYC 7763, ≈15.6 GiB RAM.
- Real `server.js` against isolated temporary SQLite.
- Synthetic fixed rooms: 30, ~1000 and ~10 000 messages.
- Five identical runs per scenario.
- Physical iPhone/Android: not measured.

The benchmark harness is `scripts/benchmark-step4.cjs`. It is test/measurement code only; Step 4 did not optimize or alter application runtime behavior.

### Network model

Normal profile adds no latency or bandwidth limit.

Throttled profile uses Chromium CDP `Network.emulateNetworkConditions` with:

- 200 ms latency;
- 125000 B/s download ≈ 1 Mbit/s;
- 62500 B/s upload ≈ 0.5 Mbit/s;
- `cellular3g` connection type.

This shaping is applied in Chromium's network stack, not on the OS or server. The 10-second outage uses `BrowserContext.setOffline(true)` for 10000 ms and then restores connectivity.

Site identity/localStorage are never cleared. Repeated passes preserve normal caches. Cold-media runs clear only the managed image cache through `FPStorage167.clearCache(['image'])`.

### Key medians

| Scenario | Normal | Throttled |
| --- | ---: | ---: |
| Saved-data startup | 289 ms | 4973 ms |
| First startup through update path | 515 ms | 6830 ms |
| Open 30 messages | 254 ms | 1095.4 ms |
| Open ~1000 messages | 304.5 ms | 1765.3 ms |
| Open ~10 000 messages | 271.5 ms | 3097 ms |
| Scroll older ~1000 | 65 ms | 618.5 ms |
| Scroll older ~10 000 | 80.8 ms | 592 ms |
| Reaction optimistic | 2.3 ms | 3.5 ms |
| Reaction ACK | 38.5 ms | 232.4 ms |
| Cold photo | 178 ms | 856 ms |
| Warm-disk photo | 135 ms | 100 ms |
| Reconnect after 10 s offline | 104 ms | 122 ms |

No p95 is reported because each group has n=5. For n≥20 the retained rule is nearest-rank `ceil(0.95*n)`.

### Confirmed latency sources

1. **Startup asset/update path on slow network.** Saved-data startup moves from 289 ms median to 4973 ms; the update path moves from 515 ms to 6830 ms.
2. **Room join/history on slow network.** For the ~1000-message room, wall open is 1765.3 ms and join is 1151.9 ms. For ~10 000, wall open is 3097 ms with join 1397.1 ms and history 1272.3 ms. Nested durations are attribution only and are not summed with wall time.
3. **Cold media transfer.** The same photo is 856 ms median cold versus 100 ms warm-disk under throttling. A representative cold loading trace has queue ≈0 ms, cache ≈10 ms, decrypt ≈3 ms and `responseAfterAdmission` ≈378 ms, so queue/decrypt are not the dominant delay in that trace.

### Pre-existing send finding

Normal text send succeeded 5/5 times; optimistic median 12.5 ms and ACK median 14.4 ms.

Under throttling, only 3/5 samples produced the optimistic row and ACK. The successful samples had optimistic median 10.7 ms and ACK median 31 ms. Two samples were recorded as `optimistic-timeout` after 10 seconds while the socket remained open.

Those two samples remain `null`, not 0. Step 4 does not assert the root cause. This is a pre-existing baseline finding for the existing `FPTextSend170` send path and should be investigated in the later send/retry/ACK performance step, not silently folded into another optimization.

### Background/resume

Headless Chromium did not transition the measured page into `visibilityState === 'hidden'`. Background/resume therefore remains unsupported in this laboratory run and is recorded as `null`, not zero. Physical-device acceptance is required.

### Baseline files

Permanent repository records:

- `docs/performance-step4-baseline.md` — methodology, medians/ranges, raw five-run values and interpretation;
- `docs/performance-step4-summary.json` — machine-readable raw baseline values;
- `scripts/benchmark-step4.cjs` — repeatable benchmark harness.

The successful CI artifact additionally contains the real `FPRuntime169.loading` exports:

- `loading-open-medium-normal.json`;
- `loading-photo-cold-normal.json`;
- `loading-photo-warm-normal.json`;
- `loading-open-medium-throttled.json`;
- `loading-photo-cold-throttled.json`;
- `loading-photo-warm-throttled.json`;
- `step4-summary.json`.

The harness verified that fixture room/device/secret values were absent from the loading exports.

After the successful v8 run, only the benchmark aggregator was corrected so `null`/unsupported values cannot be coerced to numeric zero. The raw v8 samples did not change and no runtime rerun was required for that reporting-only correction.

### Regression / behavior impact

Step 4 introduced no application optimization and no production/runtime behavior change. All application measurements target the fixed runtime SHA above.

Earlier Step 2/3 behavioral and ownership gates remain the baseline acceptance set. The benchmark itself completed all requested laboratory scenarios in the successful v8 run.

### Targets are not results

The 100 ms response target and 600 ms repeated-open target on a weak Android are optimization acceptance goals only. Step 4 does not claim those targets were achieved, and the GitHub runner is not a weak Android.

### Rollback

The benchmark script and Step 4 documentation can be reverted without any application/data migration. No production rollback is needed because runtime behavior was not changed.

### Current continuation

**Step 5 — isolate one confirmed startup wait.**

Use the Step 4 startup evidence to choose exactly one measured startup dependency/wait. Do not begin Step 6 or unrelated room/media/send optimization in the same change.


## Step 4 — performance baseline

Status: **done**.

Detailed report: `docs/performance-step4-baseline.md`.

### Measurement identity

- Runtime baseline SHA: `1c1e0453416203f6c916f214dae36bd1186f0047`.
- Successful measurement run HEAD: `4bf9cbdea791aca730da1960ccc89ab8af88cfad`.
- Build: **190.2**.
- GitHub Actions run: `36387427449` — success.
- Artifact: `10955296789` (`step4-performance-baseline`), digest `sha256:d8733c9baed9e510358bacf60c3b570538fd1ea32039f23c4d959357d4567f56`.
- Browser: Chromium 140.0.7339.16, 1100×760.
- Runner: Linux x64, Node 22.23.2, 4 vCPU AMD EPYC 7763, ~15.6 GiB RAM.
- Physical iPhone/Android: not measured.

### Network model

Normal: no added latency/bandwidth shaping.

Throttled:
- 200 ms latency;
- 125000 B/s download (~1 Mbit/s);
- 62500 B/s upload (~0.5 Mbit/s);
- Chromium CDP `Network.emulateNetworkConditions`, `cellular3g`.

10-second outage:
- `BrowserContext.setOffline(true)` for 10000 ms;
- then `setOffline(false)`;
- the requested CDP profile is re-applied after recovery.

The shaping occurs in Chromium's network stack, not at OS/server level.

### Cache/data rules

- Site identity and localStorage were not cleared.
- Repeated normal passes retained browser/managed caches.
- Cold-media passes cleared only FPStorage167 image media cache through its public API.
- Synthetic rooms were isolated: 30, ~1000 and ~10000 messages.
- Each scenario used 5 identical runs.
- p95 was not reported for n=5; if n>=20 is collected later, nearest-rank `ceil(0.95*n)` is the defined rule.
- Nested diagnostic durations are not summed into wall-clock durations.

### Core medians

| Scenario | Normal | Throttled |
| --- | ---: | ---: |
| Startup with saved data | 289 ms | 4973 ms |
| First startup after update | 515 ms | 6830 ms |
| Open 30-message room | 254 ms | 1095.4 ms |
| Open ~1000-message room | 304.5 ms | 1765.3 ms |
| Open ~10000-message room | 271.5 ms | 3097 ms |
| Scroll older ~1000 | 65 ms | 618.5 ms |
| Scroll older ~10000 | 80.8 ms | 592 ms |
| Reaction optimistic | 2.3 ms | 3.5 ms |
| Reaction ACK | 38.5 ms | 232.4 ms |
| Send optimistic, successful samples | 12.5 ms | 10.7 ms (n=3) |
| Send ACK, successful samples | 14.4 ms | 31 ms (n=3) |
| Cold photo | 178 ms | 856 ms |
| Warm disk photo | 135 ms | 100 ms |
| Reconnect after 10 s offline | 104 ms | 122 ms |

### Three confirmed latency sources

1. **Startup asset/update path under slow network.**
   - saved-data startup: 289 ms → 4973 ms median;
   - update path: 515 ms → 6830 ms median.
   This is the selected input for Step 5.

2. **Room join/history under slow network.**
   - ~1000 messages: wall open 1765.3 ms; join median 1151.9 ms;
   - ~10000 messages: wall open 3097 ms; join median 1397.1 ms and history median 1272.3 ms.
   This is retained for the later room/history steps; it must not be mixed into Step 5.

3. **Cold media transfer under slow network.**
   - cold photo median 856 ms;
   - warm-disk photo median 100 ms.
   A representative cold trace shows approximately queue 0 ms, cache 10 ms, decrypt 3 ms and response-after-admission 378 ms. The dominant delay is not the media-slot queue or decryption.

### Additional baseline findings

- Background/resume is unsupported in this headless Chromium run because the measured page did not reliably enter `document.visibilityState === 'hidden'`. The result is `null`, never 0 ms.
- Under the throttled profile, text send succeeded in 3/5 benchmark samples. Two samples produced no optimistic row within the 10-second benchmark window while the socket remained open. They are recorded as `optimistic-timeout` with `null` latency. Step 4 does not assign a root cause; this is a pre-existing baseline finding, not a regression from future optimization.
- `visible-frame` / `paint-opportunity` remain frame opportunities, not hardware-paint timestamps.
- The 100 ms interaction and 600 ms repeated-open figures remain targets only; they are not claimed as weak-Android results.

### Baseline files

The successful artifact contains:

- `step4-summary.json`;
- `loading-open-medium-normal.json`;
- `loading-photo-cold-normal.json`;
- `loading-photo-warm-normal.json`;
- `loading-open-medium-throttled.json`;
- `loading-photo-cold-throttled.json`;
- `loading-photo-warm-throttled.json`.

All loading exports report Build 190.2 and were checked not to contain the fixture room/device/secret values.

### Runtime impact

Step 4 introduced **no runtime optimization**. The committed additions are measurement/reproducibility assets and documentation. The runtime baseline remains `1c1e0453416203f6c916f214dae36bd1186f0047`.

### Continuation point

**Step 5 — inspect and change only one confirmed startup wait.**

Use the Step 4 startup baseline as the before-state. Do not combine startup work with room join/history, media, send or other independent findings.
