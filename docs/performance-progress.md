# FPChat performance optimization progress

## Current state

- Series status: **Steps 1–4 completed; follow-up plan items 1–13 plus diagnostic 3.1 completed; same-session reopen now safely reuses a fully matching MessageStore window after the normal join access check**.
- Active follow-up plan: [Small development prompts after Step 4](performance-next-steps-prompts.md), recorded 2026-09-28 at the user's request.
- Follow-up numbering is independent of the original step table. New-plan items 1–13 and diagnostic 3.1 are complete; execute only the next item explicitly supplied by the user.
- The follow-up plan refines near-term work after original Step 4. New-plan item 1 concerns text-send behavior and does **not** complete original Step 5 (startup). Original and follow-up numbering remain independent.
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


## Follow-up plan: docs/performance-next-steps-prompts.md — item 1

Status: **done — defect reproduced; runtime unchanged**.

### Plan mapping

- Follow-up plan item: **1 — reproduce repeated-send blocking**.
- Original performance-series step: **not equivalent to original Step 5**. Original Step 5 remains pending startup work.
- This item was executed because the user explicitly selected it from the new follow-up plan.
- No later follow-up item was started.

### Confirmed cause in current FPTextSend170

The current `public/text-send170.js` ordering is:

1. reject a submit when `sendingForms.has(form)`;
2. add the form to `sendingForms`;
3. connect/encrypt/create `clientMessageId`;
4. optimistically render and call the existing `queuePendingTextSend(outbound)`;
5. clear the visible composer;
6. when the draft is unchanged, `await clearDraftOnServer(roomId)`;
7. only in `finally`, call `sendingForms.delete(form)`.

Therefore the form-level double-submit guard remains held while the server-side draft DELETE is in flight, even though the first text has already entered the existing pending queue and may already have received its ACK.

### Narrow browser reproduction

Added:

- `scripts/regression-next1-send-draft-lock.cjs`;
- npm script `test:next:1`.

The regression:

- creates one isolated room;
- keeps the real existing `FPTextSend170`, `FPSendManager177`, `FPConnection170` and `pendingTextSends` path;
- delays only `DELETE /api/rooms/:roomId/draft` with a Playwright route;
- wraps the existing global `queuePendingTextSend` in the test page only to count queue handoffs, then restores it;
- sends text A;
- waits until text A has a numeric server message id (ACK promotion observed);
- confirms the draft DELETE is still held and the WebSocket remains open;
- immediately fills and submits different text B;
- confirms B stays in the composer, creates no optimistic bubble and does **not** call `queuePendingTextSend`;
- releases the DELETE;
- submits B again and confirms B then enters the existing pending queue with its own `clientMessageId`.

The test also statically pins the private `sendingForms` ordering because the WeakSet itself is intentionally not exposed:

- guard exists;
- `sendingForms.add(form)` occurs before draft cleanup;
- `await clearDraftOnServer(roomId)` occurs while the guard is held;
- `sendingForms.delete(form)` occurs only afterwards in `finally`.

### Verification

GitHub Actions run `36406377137` passed:

- `npm run test:next:1` — PASS;
- `npm run test:177:text-dispatch` — PASS.

Observed regression output:

- first text receives ACK while draft DELETE is deliberately held;
- delayed draft DELETE keeps the FPTextSend170 form guard active after ACK;
- second distinct submit does not enter the queue while the guard is held;
- the same second text enters the existing queue immediately after DELETE releases;
- existing double-submit, reconnect, clientMessageId, A→B and ACK/echo behavior remains green.

The temporary CI workflow was removed after verification.

### Relation to the two Step 4 send timeouts

The **blocking mechanism is reproduced** and matches the Step 4 symptom class: a later send can fail to produce an optimistic row while the socket is still open because the previous submit has not left `sendingForms`.

However, the exact historical Step 4 outcome of **2 failures out of 5 throttled sends is not causally proven** by this item. The Step 4 benchmark did not record whether a draft DELETE was still in flight for those exact two samples. Therefore the correct conclusion is:

- repeated-send lock due to delayed draft DELETE: **confirmed**;
- exact attribution of both historical `optimistic-timeout` samples to this lock: **not yet proven**.

### Files changed

Test/infrastructure only:

- `scripts/regression-next1-send-draft-lock.cjs`;
- `package.json`;
- `docs/performance-progress.md`.

No `public/*`, `server.js`, database schema, owners/managers/arbiters or production configuration were changed.

### Rollback

Remove `test:next:1` from `package.json`, remove `scripts/regression-next1-send-draft-lock.cjs`, and revert this journal entry. There is no runtime/data rollback.

### Continuation point

**No next item started automatically.**

If explicitly requested, new-plan item 2 may use this reproduction to change the release point safely while preserving double-submit protection, existing queue ownership, draft ordering and A→B behavior. Original Step 5 remains independently pending.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 2

Status: **done — repeated-send draft lock fixed without a new send queue**.

### Plan mapping

- Follow-up plan item: **2 — fix waiting for draft deletion**.
- Depends on follow-up item 1, which confirmed that `sendingForms` remained held across `await clearDraftOnServer(roomId)`.
- Original performance-series Step 5 remains independent and pending; this item does not complete startup work.
- No later follow-up item was started.

### Runtime change

Two existing responsibilities were adjusted without adding a new manager or outgoing queue.

#### FPTextSend170

`public/text-send170.js` now keeps the form-level double-submit guard through:

- connection;
- encryption;
- `clientMessageId` creation;
- optimistic projection;
- existing `queuePendingTextSend(outbound)`;
- local composer/draft reset;
- registration of the existing server-side draft clear.

Only after those steps does it call `sendingForms.delete(form)`.

The network DELETE may still be in flight after the form is released. The submit operation still waits for that cleanup before its existing final `finish(operation, 'queued')`, so operation accounting was not broadened into a new owner.

The existing `finally { sendingForms.delete(form); }` remains as the error/cancellation safety net.

#### Existing draft worker

A simple early release without ordering would allow a later draft PUT to overtake an older DELETE and then be erased when that DELETE completes.

To prevent that race, the existing per-room draft state in `public/app.js` now carries one `clearPromise` barrier:

- `clearDraftOnServer(roomId)` preserves DELETE ordering by chaining behind an already-running clear for that room;
- `saveDraftNow(roomId)` waits until all currently registered clears for that room finish before it snapshots and PUTs the latest draft;
- a new draft typed while an old DELETE is pending therefore remains local, then persists after the DELETE chain completes;
- this is draft I/O ordering only, not a message-send queue and not a second network owner.

The existing 700 ms draft debounce, encrypted PUT/DELETE transport, room-specific storage and `pendingTextSends` ownership remain unchanged.

### Narrow regression

The pre-fix reproduction script from item 1 was retired from the current tree after the bug was fixed; its reproduction remains in Git history and in the item-1 journal entry.

Added:

- `scripts/regression-next2-send-draft-release.cjs`;
- npm script `test:next:2`.

The regression checks both source ordering and real browser behavior.

Browser scenario:

1. create rooms A and B;
2. hold only room-A `DELETE /draft`;
3. send text A1 with a double submit;
4. wait for its server ACK while DELETE remains held;
5. type/send different text A2, again with a double submit;
6. confirm A2 enters the existing queue before A1 DELETE completes;
7. type an unsent new room-A draft and wait past the normal 700 ms debounce;
8. confirm no draft PUT is allowed to overtake the held DELETE chain;
9. navigate A → B while room-A cleanup is still pending;
10. send text in room B and confirm its queue handoff remains bound to B;
11. release room-A DELETE;
12. confirm ordered room-A DELETEs finish and the newer unsent room-A draft is then PUT and survives on the server;
13. confirm each sent text exists exactly once in its source room.

### Before / after

Same forced-delay class as item 1:

- before: with room-A DELETE held, the second distinct submit still had **not** entered `queuePendingTextSend` after 250 ms and remained blocked until DELETE release;
- after: in CI run `36407632520`, the second distinct text entered the existing queue in **7 ms** while the older DELETE was still deliberately held.

This 7 ms value is a single regression-run observation, not a new production/mobile performance baseline.

### Verification

GitHub Actions run `36407632520` passed:

- `npm run test:next:2` — PASS;
- `npm run test:177:text-dispatch` — PASS;
- `npm run test:177:composer-draft-save` — PASS;
- `npm run test:177:composer-draft-restore` — PASS;
- `npm run test:177:send-entry-contract` — PASS.

Confirmed:

- two different messages can queue while an older draft DELETE is still in flight;
- double submit still creates one logical queue handoff per text;
- distinct sends retain distinct `clientMessageId` values;
- no new outgoing queue exists in `FPTextSend170`;
- a new draft typed during DELETE waits behind the clear barrier and survives server persistence;
- A → B keeps each send bound to its captured room;
- existing reconnect/retry/ACK/echo text behavior stays green;
- existing normal draft encrypted PUT, empty DELETE and restore behavior stays green;
- no uncaught browser errors were observed.

The temporary item-2 CI workflow was removed after verification.

### Files changed by item 2

Runtime:

- `public/text-send170.js`;
- `public/app.js`.

Regression/documentation:

- `scripts/regression-next2-send-draft-release.cjs`;
- `package.json`;
- `docs/performance-progress.md`.

Removed from the current test tree because it asserted the pre-fix behavior:

- `scripts/regression-next1-send-draft-lock.cjs`;
- npm script `test:next:1`.

No server, schema, MessageStore, RoomContext, Connection170, SendManager177, cache owner or production configuration changed.

### Rollback

Revert the item-2 changes in `public/text-send170.js` and `public/app.js`, restore the item-1 reproduction test if the old behavior is intentionally restored, and remove `test:next:2`. No database or server migration is involved.

### Continuation point

**No next follow-up item started automatically.**

The repeated-send draft-lock defect is fixed and covered. Original Step 5 remains independently pending, and any next work must be explicitly selected by the user.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 3

Status: **done — startup mandatory waits measured; runtime unchanged**.

### Plan mapping

- Follow-up plan item: **3 — measure mandatory startup waits**.
- This is the measurement prerequisite requested before choosing follow-up item 4 or 5 for the original performance-series Step 5.
- Original Step 5 is **not** completed by this measurement.
- No follow-up item 4 or 5 was executed automatically.

### Measured runtime and stand

Measured runtime SHA:

`1eb7a97184a307562c51525aa358450f8346ea36`

Build: **190.2**.

Successful measurement run:

- GitHub Actions `36408339641`;
- artifact `10963820289` (`next3-startup-waterfall`);
- digest `sha256:e837166c1c02b2da9cd180682149212e99ebfc9fd89f4f9517fb5015f2b0e07b`.

For each network profile the browser context retained localStorage, identity, service-worker registration and ordinary caches. One synthetic room with saved local access was used.

Profiles:

- normal: no added latency/bandwidth limit;
- slow: Chromium CDP `Network.emulateNetworkConditions`, 200 ms latency, 125000 B/s download (~1 Mbit/s), 62500 B/s upload (~0.5 Mbit/s), `cellular3g`.

The update scenario used the real application path by setting the local build to 190.1 and allowing `checkAppVersionOnEntry → applyAppUpdate → location.reload` to run unchanged.

### Main startup timeline

Saved-data startup:

| Boundary | Normal | Slow |
| --- | ---: | ---: |
| wall | 341 ms | 3997 ms |
| loader → boot-ready | 210.2 ms | 3655.9 ms |
| first version request | 4.2 ms | 6.9 ms |
| version-ready → owners-ready | 66.1 ms | **1291.2 ms** |
| service worker | 8.0 ms | 0.9 ms |
| second version/update gate | 9.6 ms | 12.7 ms |
| core-ready → boot-ready owner start | 57.5 ms | **2096.5 ms** |
| layers | 41.2 ms | 223.4 ms |
| final asset settle | 22.0 ms | 22.8 ms |

Update path:

- normal total wall: **503 ms**, two navigations;
- slow total wall: **6280 ms**, two navigations.

Slow update detection navigation:

- version: 4.1 ms;
- owners wait: **1284.3 ms**;
- service worker: 2.0 ms;
- update gate: 24.3 ms.

Slow final navigation after update:

- version: 3.9 ms;
- owners wait: **1286.2 ms**;
- service worker: 1.7 ms;
- second version gate: 11.7 ms;
- core-ready → boot-ready owner start: **2768.0 ms**;
- layers: 225.2 ms;
- final asset settle: 20.3 ms.

### Second version.json request

There are two startup version requests per navigation:

1. loader request from `index.html`;
2. `checkAppVersionOnEntry()` request from `app.js` after owners and service-worker registration.

Measured first-request → second-request start delay:

- saved normal: **78.3 ms**;
- saved slow: **1298.9 ms**;
- update detection normal: **66.1 ms**;
- update final normal: **63.6 ms**;
- update detection slow: **1290.4 ms**;
- update final slow: **1291.8 ms**.

Actual second request durations were only about **4.6–10.8 ms**.

All observed version responses were explicitly marked by Chromium as `fromServiceWorker=true`, with zero encoded network body bytes and `fromDiskCache=false`.

Therefore the large slow-network “delay of the second version request” is primarily **delay before it is allowed to start**, caused by the required owner chain. The duplicate request itself is real but was not a major transfer bottleneck on this stand.

### Requests, transfer and cache evidence

| Scenario | Requests | Encoded transfer | SW responses | Disk-cache responses |
| --- | ---: | ---: | ---: | ---: |
| saved normal | 95 | 30.2 KiB | 2 | 0 |
| saved slow | 92 | 22.4 KiB | 2 | 0 |
| update normal | 152 | 44.1 KiB | 4 | 0 |
| update slow | 138 | **140.9 KiB** | 4 | 0 |

For slow update:

- first navigation: 10.9 KiB;
- final navigation after cache/update work: **130.0 KiB**.

Largest encoded script transfers in that final slow navigation:

- `voice.js`: ~63.4 KiB;
- `message-context.js`: ~32.6 KiB;
- `swipe-fix.js`: ~14.6 KiB.

No response was explicitly marked as disk-cache served. Warm static resources often transferred only a few hundred encoded bytes despite much larger source sizes; this is cache/revalidation-like evidence, but the captured flags do not prove a specific memory-cache path. Production cache policy is not inferred from this localhost Chromium stand.

### Resource attribution

On saved slow startup, before `owners-ready`, long existing resource observations include `network171.js` (~675 ms) and the required send-owner chain through `text-send170.js` and `media-send170.js`.

After `core-ready`, another existing resource chain delays entry into the boot-ready readiness loop. Representative overlapping observations include:

- `boot-ready152.js` ~813 ms;
- `media-gallery134.js` ~802 ms;
- `viewport-layout136.js` ~754 ms;
- `gesture-manager135.js` ~664 ms;
- `system-chat144.js` ~634 ms;
- `global-search156.js` ~622 ms;
- `build165-ui.js` ~610 ms.

These timings overlap and are not summed.

### Decision evidence for original Step 5

The measurement does **not** support treating duplicate `version.json` as the main startup bottleneck. Removing it would save only the small second-request/gate duration in this stand, while required owner/resource waits are measured in hundreds to thousands of milliseconds.

Therefore the evidence favors follow-up **item 5** over item 4 as the next investigation for original Step 5.

This is only a decision from measurement. Item 5 was **not** started, and no specific optional dependency has yet been removed.

### Permanent files

- `scripts/benchmark-next3-startup-waterfall.cjs` — isolated measurement harness;
- `docs/performance-next3-startup-waterfall.md` — detailed timeline and interpretation;
- `docs/performance-next3-startup-summary.json` — compact machine-readable values.

The full raw request waterfall remains in CI artifact `10963820289`.

### Runtime impact

None for item 3. No `public/*`, server, schema, owner/manager/arbiter or production configuration was changed by the measurement task.

### Rollback

Remove the benchmark script and item-3 documentation/journal entry. No runtime/data rollback is required.

### Continuation point

**No next item started automatically.**

Measurement evidence currently points to follow-up item 5 rather than item 4, but execution requires an explicit user request.


## Follow-up plan diagnostic: item 3.1 — Service Worker network coverage

Status: **done — measurement gap confirmed and test stand corrected; runtime unchanged**.

### Why 3.1 was necessary

Item 3 applied Chromium network emulation only to the page CDP target.

Current `sw.js` intercepts `/version.json` and performs its own upstream:

`fetch(event.request, { cache: 'no-store' })`

That fetch runs in the Service Worker target, not in the page target.

The original item-3 slow measurements therefore did not prove that the configured 200 ms latency reached the Service Worker upstream request.

### Isolated coverage proof

Run `36409730941` used three diagnostic paths.

1. Service Worker active, 200 ms throttle on page target only:
   - page fetch wall: **3.7 ms**;
   - worker upstream: **1.8 ms**;
   - worker request observed, status 200, HTTP/1.1, 409 encoded bytes, `fromDiskCache=false`.

2. Same Service Worker path, 200 ms throttle applied to both page and worker target:
   - page fetch wall: **204.9 ms**;
   - worker upstream: **202.6 ms**.

3. Diagnostic control with Service Worker blocked and only the page target throttled:
   - direct request wall: **226.7 ms**.

Conclusion: **coverage gap confirmed**. Page-target emulation does not automatically apply to the Service Worker target in this stand.

The worker-target request used a unique query string and was directly observed by the worker CDP Network domain. This confirms the request reached the server/network layer in the diagnostic scenario.

### Cache interpretation correction

Historical item-3 page events reported:

- `fromServiceWorker=true`;
- zero page-level encoded bytes.

Those values are **not cache proof**.

The corrected worker-target trace records 409 encoded bytes for each upstream `version.json` response while `fromDiskCache=false`.

The accurate interpretation is:

- `fromServiceWorker=true` means the page response came through the Service Worker interception path;
- zero encoded bytes at the page target means the upstream body was accounted on another target;
- neither fact proves a cache hit.

### Stand-only fix

Only test/measurement infrastructure changed:

- `scripts/benchmark-next31-sw-network-coverage.cjs` adds the isolated proof;
- `scripts/benchmark-next3-startup-waterfall.cjs` now applies the requested network profile to both the page and active Service Worker targets;
- Service Worker upstream requests are observed separately from page logical requests to avoid double-counting.

No `public/*`, `sw.js`, server, owner, manager, arbiter or production configuration was changed.

### Corrected startup measurements

Corrected run:

- GitHub Actions `36409985895`;
- artifact `10963583079`;
- digest `sha256:d84d31af228e54db7e35d4044d537a3f0a4930c8d7672a5229daf699ebe74100`;
- runtime SHA still `1eb7a97184a307562c51525aa358450f8346ea36`.

Saved-data startup:

| Boundary | Normal | Slow |
| --- | ---: | ---: |
| wall | 346 ms | **4199 ms** |
| loader → boot-ready | 215.5 ms | **3865.5 ms** |
| first version boundary | 6.4 ms | **212.3 ms** |
| owners wait | 66.5 ms | **1278.9 ms** |
| service-worker registration | 1.0 ms | 1.7 ms |
| second version/update gate | 10.7 ms | **218.9 ms** |
| layers | 44.7 ms | 224.1 ms |
| assets settle | 16.7 ms | 27.1 ms |

Service Worker upstream version durations:

- normal: 2.7 ms and 4.5 ms;
- slow: **210.2 ms and 217.2 ms**.

Corrected second-request start delay on saved slow startup: **1492.9 ms**. This includes the first network wait plus the existing owner chain; the second request itself costs about 217 ms.

Corrected real update path:

- normal wall: **521 ms**;
- slow wall: **6441 ms**;
- slow SW version requests across two navigations: **207.7, 213.1, 206.8, 212.1 ms**.

The duplicate app-side checks are the second and fourth requests above: about **213 ms + 212 ms** of upstream request time across the two-navigation update path.

### Historical measurements preserved

The original item-3 report and JSON remain in the repository and are not rewritten as if they never existed.

The old statement that slow-network `version.json` itself costs only ~5–11 ms is marked as superseded in `docs/performance-next3-startup-waterfall.md`.

Corrected values are stored separately in:

- `docs/performance-next31-corrected-summary.json`.

### Decision between item 4 and item 5

With corrected Service Worker coverage, the next justified small change is **follow-up item 4**.

Reason:

- there is now one directly confirmed sequential cause;
- the duplicate version request costs about **215 ms per slow-network navigation**;
- it is removable without first having to identify which one optional resource dominates a multi-resource critical chain;
- item 5 may have larger eventual upside, but item 3/3.1 has not yet proved one single optional dependency as the causal owner of the larger ~1.28 s / ~2 s intervals.

This only selects the next candidate. Item 4 was **not started**.

### Files

Added/updated for 3.1:

- `scripts/benchmark-next31-sw-network-coverage.cjs`;
- `scripts/benchmark-next3-startup-waterfall.cjs`;
- `docs/performance-next31-corrected-summary.json`;
- `docs/performance-next3-startup-waterfall.md`;
- `docs/performance-progress.md`.

### Rollback

Revert only the measurement scripts and 3.1 documentation. No runtime/data rollback is required.

### Continuation point

**No optimization started automatically.**

Measurement evidence now supports follow-up item **4** as the next explicit prompt.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 4

Status: **done — loader version result reused on startup; duplicate app-side startup request removed**.

### Plan mapping

- Follow-up item: **4 — eliminate repeated startup version request**.
- Chosen after diagnostic 3.1 proved that the second Service Worker-backed `version.json` really costs about 215 ms under the requested slow-network model.
- This is the selected small optimization for the original performance-series Step 5.
- Follow-up item 5 was not started.

### Runtime change

`public/index.html` now stores a startup version handoff only after a successful, valid loader result and only for the same build used to generate startup resource URLs.

The existing `FPStartup174` object gained one data field:

`versionResult: loaderVersionResult174`

No readiness owner, transition, fail path or execution chain was replaced.

`public/app.js` initial startup now passes that result explicitly into `checkAppVersionOnEntry`.

Reuse is accepted only if:

- build syntax is valid;
- numeric build is finite;
- `resourceBuild === build`;
- the actual loaded `app.js` URL has `?v=` matching the same resource build.

Any missing, malformed or mismatched startup result uses the existing fresh `fetch('/version.json', {cache:'no-store'})` fallback.

Resume remains fresh because `handleAppResume()` still calls `checkAppVersionOnEntry()` with no startup result.

### No resource-version mixing

The handoff is not accepted merely because its build number parses.

It must match the version suffix of the actual executing `app.js`. Therefore an injected/stale/mismatched loader result cannot be reused for a differently versioned startup graph.

When the loader version fetch fails, `versionResult` stays null and the app-side network fallback remains active.

### Request count

Saved-data startup:

- corrected item 3.1 before: 2 logical version requests / 2 SW upstream requests;
- item 4 after: **1 logical version request / 1 SW upstream request**.

Real update consists of two navigations:

- before: 4 total version requests;
- after: **2 total version requests**, one loader request per navigation.

### Performance comparison against corrected item 3.1

Saved slow:

- wall: 4199 → 4164 ms;
- loader → boot-ready: 3865.5 → 3828.0 ms;
- second version gate: **218.9 → 0.3 ms**;
- version count: 2 → **1**;
- encoded page transfer: 22.4 → 22.4 KiB.

Saved normal:

- wall: 346 → 314 ms;
- second version gate: 10.7 → 0.1 ms.

Update normal:

- wall: 521 → 447 ms;
- total version count: 4 → **2**;
- final second version gate: 11.9 → 0.5 ms.

Update slow:

- wall: 6441 → 6657 ms;
- total version count: 4 → **2**;
- final second version gate: **214.8 → 0.1 ms**;
- encoded page transfer changed materially: 67.9 → 152.4 KiB.

The update-slow wall difference is therefore **not attributed to item 4**. There is one before and one after diagnostic run and the network/resource transfer conditions differed substantially despite the same requested throttle.

The confirmed optimization effect is narrower:

- duplicate request removed;
- its sequential gate removed;
- fresh-resume behavior preserved.

Do not convert the ~215 ms removed request into a claimed ~215 ms end-to-end speedup. In saved slow startup most of that interval overlapped with other resource loading, so the observed wall delta was only 35 ms in this single comparison.

### Functional verification

New regression:

- `scripts/regression-next4-version-reuse.cjs`;
- `npm run test:next:4`.

Final CI run `36411301150` passed:

- `test:next:4`;
- `test:186:startup`;
- `test:189:system-push`;
- corrected startup waterfall.

Confirmed:

- normal startup uses one version request;
- real update uses one version request per navigation and still clears the update marker;
- malformed loader version falls back to a fresh app-side request;
- mismatched loader/resource version is rejected;
- direct `/chat` starts through existing owners;
- existing direct invite path remains green in `test:186:startup`;
- required owner readiness/order remains green;
- optional asset failure/late settle and existing boot readiness/safety behavior remain green;
- system push behavior remains green;
- lifecycle resume performs a new version request.

### Regression guard maintenance

`scripts/regression180-init-coordination.cjs` initially failed because it contained an exact literal for the old `FPStartup174` object.

It was updated only to allow the intentional `versionResult:loaderVersionResult174` field. The existing coordination fields and owner chain remain exact requirements.

This was a stale source guard caused by the intended item-4 surface extension, not a behavioral runtime failure.

### Files

Runtime:

- `public/index.html`;
- `public/app.js`.

Regression:

- `scripts/regression-next4-version-reuse.cjs`;
- `scripts/regression180-init-coordination.cjs`;
- `package.json`.

Results:

- `docs/performance-next4-version-reuse.md`;
- `docs/performance-next4-version-reuse-summary.json`;
- this journal.

Artifact from the successful verification/measurement run:

- workflow `36411301150`;
- artifact `10963774575`;
- digest `sha256:14e465b10dc73603b8839a3242c36576605c52c2a347e378862edcc3b1986c4b`.

### Runtime areas not changed

- `sw.js`;
- server/API;
- DB/schema;
- RoomContext/generation/AbortSignal;
- Connection170/WS ownership;
- SendManager/pending send queue;
- MessageStore/history;
- cache writer/media policy;
- layer/gesture/viewport owners;
- updater behavior.

### Rollback

Revert the item-4 edits in `public/index.html` and `public/app.js`, restore the old Build 180 exact guard if the handoff field is removed, and remove `test:next:4` plus its regression/docs.

No database/data migration is involved.

### Continuation point

**No next item started automatically.**

Follow-up item 5 remains pending and independent.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 5

Status: **done — investigated optional startup waits; no runtime optimization retained**.

### Plan mapping

- Follow-up item: **5 — remove one optional startup wait only if measurement confirms it**.
- This follows item 4 and uses the corrected startup evidence from item 3/3.1.
- No later follow-up item was started.

### replyVisualReady184 check

The requested `replyVisualReady184` path was checked first.

Corrected slow saved-data evidence before item 5:

- `reply-swipe-visual184.js`: 432.2 → 643.3 ms;
- `reply-swipe-visual184.css`: 432.2 → 655.0 ms;
- `app.js` real script insertion/load: 1292.9 → 1307.5 ms.

Therefore the reply visual completed roughly 638 ms before the existing dependency chain could execute app.js. It is syntactically awaited but was not the measured critical path.

A corrected isolated preflight held only `reply-swipe-visual184.js` and observed the actual app script element rather than its preload network request.

Run `36412277803` confirmed:

- no real `<script src="/app.js">` existed while the visual file was held;
- the enhanced visual was not installed;
- after release, app.js insertion followed 42 ms later.

So the dependency can block under an artificial delay, but item-3/3.1 does not show that it delayed the ordinary startup.

A tentative runtime removal was reverted and is absent from the final tree.

### system-ui148 check

The next candidate was selected from the measured end of the slow `layersReady` chain.

Before item 5:

- `system-ui148.js` ended at ~4004.0 ms;
- `layers-end` was ~4021.8 ms;
- the file was explicitly required by `boot-ready152.js → layersReady()`.

The file is an enhancement over the base system-chat implementation: edge-back swipe and preview stabilization. Base system ownership/view is in `FPSystem144` and `chat-request-system147`.

A preflight delayed only `system-ui148.js`.

Run `36412935331` confirmed:

- `core-ready` was already reached;
- after another 500 ms, `layers-end` remained null and `boot-ready` false;
- after release, `layers-end` and `boot-ready` completed.

Thus the old readiness contract can be held by a sufficiently late system-ui148.

### Temporary safety experiment

One line was temporarily removed from `layersReady()`:

`window.__fpSystemUi148Installed`

The loader/order for the file was not changed.

Verification run `36413217197` passed:

- isolated delay/error/late-load regression;
- `test:186:startup`;
- `test:189:system-push`;
- `test:184:browser`;
- `test:next:4`;
- corrected startup waterfall.

The isolated regression verified:

- required owners and boot complete while system-ui148 is held;
- base system chat opens before the enhancement loads;
- late loading installs the enhancement;
- a failed system-ui148 load does not break the base system chat.

### Performance result

Ordinary corrected before/after:

| Scenario | Before | Temporary change |
| --- | ---: | ---: |
| saved normal wall | 314 ms | 348 ms |
| saved slow wall | 4164 ms | 4166 ms |
| saved slow layers | 222.7 ms | 224.3 ms |
| update normal wall | 447 ms | 469 ms |
| update slow wall | 6657 ms | 6647 ms |

There is no confirmed startup improvement.

The temporary system-ui readiness change was therefore reverted.

### Final tree

Compared with item-4 HEAD `84fc1e11261bb79c6868f402cfe5036dac37f57e`, item 5 leaves **no runtime/package behavior change**.

The retained item-5 files are diagnostic/documentation only:

- `scripts/benchmark-next5-reply-visual-preflight.cjs`;
- `scripts/benchmark-next5-system-ui-preflight.cjs`;
- `docs/performance-next5-optional-wait.md`;
- this journal entry.

Temporary CI workflow and temporary post-change regression were removed.

### Artifact/evidence

Temporary experiment verification:

- workflow `36413217197`;
- artifact `10966430478`;
- digest `sha256:5750cb1497866e44f04142265c6aeeac5bb636000d676a74b3c4d3c638f2cb72`.

### Rollback

No runtime rollback is required because the runtime experiment was already reverted.

To remove only item-5 evidence, delete the two diagnostic scripts and item-5 documentation/journal entry.

### Continuation point

**No next item started automatically.**

Follow-up item 6 is the next numbered plan item if explicitly requested.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 6

Status: **done — repeated JS/CSS caching/revalidation measured; no runtime or cache-policy change**.

### Scope

Item 6 measured repeated startup static requests on the isolated localhost Chromium stand.

Measured runtime before adding diagnostics:

`b75d01761706280cfc1e04d253739d32160c2ad2`

Build: **190.2**.

Successful run:

- workflow `36414543629`;
- artifact `10965878305`;
- digest `sha256:0410f672ad0ea0228a86ae24a827f98640903ed619b1487156dee59405d4f447`.

No production/CDN cache policy is inferred from these localhost measurements.

### Ordinary opening vs reload

For each network profile the browser context was first primed, preserving site data, HTTP cache state and Service Worker registration.

- ordinary opening = close the priming page, open a new page in the same browser context;
- reload = `page.reload()` on that already-open page.

Results:

| Scenario | JS/CSS requests | Encoded transfer | Network 304 | Conditional | Disk cache | Served-from-cache |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal ordinary open | 81 | 21.0 KiB | 81 | 72 | 0 | 0 |
| normal reload | 81 | 21.0 KiB | 80 | 70 | 0 | 0 |
| slow ordinary open | 76 | 19.5 KiB | 75 | 66 | 0 | 0 |
| slow reload | 77 | 19.5 KiB | 75 | 61 | 0 | 0 |

Observed localhost static response policy:

`Cache-Control: public, max-age=0`

Validated resources carried ETags.

The main repeat behavior is therefore conditional network revalidation, not a full-body re-download and not an explicitly reported disk-cache hit.

### Logical status vs actual network status

Chromium frequently reports the resource to the page as status 200 while `Network.responseReceivedExtraInfo` shows actual network status **304**.

Matching `If-None-Match` and response ETag values were recorded.

Therefore cache analysis uses the ExtraInfo network status instead of treating the logical 200 as a full re-download.

### Selected resource: app.js

Selected:

`/app.js?v=190.2`

Reason:

- required executable startup resource;
- repeat validation is large on the slow stand;
- app execution directly depends on it.

Measurements:

| Scenario | Duration | Logical | Actual network | Encoded bytes |
| --- | ---: | ---: | ---: | ---: |
| normal ordinary | 47.4 ms | 200 | 304 | 267 B |
| normal reload | 42.3 ms | 200 | 304 | 267 B |
| slow ordinary | **864.1 ms** | 200 | 304 | 267 B |
| slow reload | **867.8 ms** | 200 | 304 | 267 B |

All four had:

- `Cache-Control: public, max-age=0`;
- ETag `W/"31ab5-1a0e7b9ecd6"`;
- matching `If-None-Match`;
- `fromDiskCache=false`;
- `requestServedFromCache=false`.

The ~864–868 ms is a validation-path duration under the constrained request set, not transfer of the full app.js body. Only ~267 encoded bytes were transferred.

`room-lifecycle.js` was numerically slower (~1.03 s), but `app.js` was chosen because its critical executable role is direct and unambiguous.

### URL/content check

`app.js` changed during item 4:

Before item 4, ref `63664e5c013cfb44bda7f179b383a6460fd595d2`:

- app.js blob SHA `80b9a3952322f27a15cda9292c5ba2e7ff2840e3`;
- build `190.2`.

Current:

- app.js blob SHA `c6cb6b3d58e5423d11d628882c00564df7b73d21`;
- build still `190.2`.

The loader before and after constructs:

`/app.js${buildSuffix}`

Therefore the content changed while the requested URL remained:

`/app.js?v=190.2`

The scheme is build-versioned, not content-addressed. A content change alone does not change the URL.

On this localhost stand, max-age=0 + ETag revalidation still detects changed content. This must not be extrapolated to production caching behavior.

### Files

Added:

- `scripts/benchmark-next6-static-cache.cjs`;
- `docs/performance-next6-static-cache.md`;
- `docs/performance-next6-static-cache-summary.json`;
- this journal entry.

No `public/*`, server runtime, `sw.js`, DB/schema, owner/manager/arbiter or updater behavior changed.

### Continuation point

**No next item started automatically.**

Follow-up item 7 is next only if explicitly requested.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 7

Status: **done — app.js URL now changes with app.js content**.

### Scope

Selected resource from item 6: `public/app.js`.

The project-wide build mechanism remains unchanged. Only app.js received a minimal content-derived revision.

### Revision contract

`public/version.json` now contains:

`appRevision: c6cb6b3d58e5423d11d628882c00564df7b73d21`

This is the Git blob SHA of the exact current `public/app.js` bytes.

`scripts/regression-next7-app-revision.cjs` recomputes the Git blob SHA and fails if app.js changes without a matching appRevision update.

### URL

Current app.js URL:

`/app.js?v=190.2&r=c6cb6b3d58e5423d11d628882c00564df7b73d21`

All other startup resources keep the existing `?v=build` scheme.

The app preload and executable script both use the same `appBuildSuffix190`, and the browser regression requires their resolved URLs to be identical.

### Update / rollback verification

Final CI run `36415957342` passed.

Confirmed:

- current appRevision matches current app.js bytes;
- current revision URL returns those exact bytes;
- synthetic content update changes the URL and executes/returns the updated bytes;
- rollback changes the URL back and executes/returns the rollback bytes in the same browser context;
- `test:next:4` remains green;
- `test:186:startup` remains green;
- `test:180:rollback-contract` remains green.

The synthetic A/B fixture uses a Service Worker-blocked diagnostic context only so the test can control server bytes. The real current startup is separately verified with the normal Service Worker path.

### Files

Runtime/config:

- `public/version.json`;
- `public/index.html`.

Regression:

- `scripts/regression-next7-app-revision.cjs`;
- `package.json`.

Documentation:

- `docs/performance-next7-app-revision.md`;
- this journal entry.

No app.js runtime logic, Service Worker, server, DB/schema, owner/manager/arbiter, updater logic or project-wide build system changed.

### Rollback

Remove appRevision, restore app.js to the common buildSuffix URL, and remove `test:next:7`.

No data migration is involved.

### Continuation point

**No next item started automatically.**

Follow-up item 8 is next only if explicitly requested.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 8

Status: **done — long-lived immutable caching enabled only for exact revisioned app.js URLs**.

### Scope

Selected resource from items 6–7:

`public/app.js`

No project-wide cache policy was added.

### Server safety contract

`server.js` now verifies the app revision against the actual current app.js bytes at server startup.

Long-lived immutable caching is served only when:

- path is exactly `/app.js`;
- request includes `r=<40-hex revision>`;
- `version.json.appRevision` is valid;
- that revision equals the Git blob SHA of the current app.js bytes;
- request `r` equals that verified revision.

Exact revisioned app.js response:

`Cache-Control: public, max-age=31536000, immutable`

A stale revision receives:

- HTTP 410;
- `Cache-Control: no-store`.

Therefore current bytes are never served under an old immutable URL.

If the request has no `r`, it falls through to the existing ordinary static policy. A build number alone is not treated as immutable.

If server startup cannot verify appRevision against app.js bytes, revisioned app.js fails closed with HTTP 503/no-store.

### Isolation

Regression confirms immutable is not applied to:

- HTML;
- `version.json`;
- `sw.js`;
- `/api/*`;
- unrevisioned app.js;
- other JS/CSS files.

### Repeat-launch result

Item 6 app.js baseline:

| Scenario | Before |
| --- | ---: |
| normal ordinary | 47.4 ms, 304, 267 B |
| normal reload | 42.3 ms, 304, 267 B |
| slow ordinary | 864.1 ms, 304, 267 B |
| slow reload | 867.8 ms, 304, 267 B |

Item 8:

| Scenario | After |
| --- | ---: |
| normal ordinary | 7.8 ms, disk cache, 0 B |
| normal reload | 0.2 ms, cache, 0 B |
| slow ordinary | 7.8 ms, disk cache, 0 B |
| slow reload | 0.1 ms, cache, 0 B |

Removed selected-resource network wait:

- normal ordinary: **-39.6 ms**;
- normal reload: **-42.1 ms**;
- slow ordinary: **-856.3 ms**;
- slow reload: **-867.7 ms**.

Dedicated repeat-launch evidence:

- `fromDiskCache=true`;
- no 304 network status;
- encoded network bytes = 0;
- Resource Timing transferSize = 0.

### End-to-end wall

Single-run startup wall did not mirror the full app.js saving because other resources still revalidate and overlap:

| Scenario | Item 6 | Item 8 |
| --- | ---: | ---: |
| normal ordinary | 370 ms | 402 ms |
| normal reload | 335 ms | 353 ms |
| slow ordinary | 4141 ms | 4083 ms |
| slow reload | 4135 ms | 4268 ms |

These one-run wall differences are not attributed to app.js caching.

The confirmed effect is the elimination of the app.js validator round trip itself.

### Update / rollback

Final item-8 CI re-ran `test:next:7`, which exercises immutable synthetic app responses in one browser context.

Confirmed:

- A → B changes URL and executes/returns B bytes;
- B → A rollback changes URL back and executes/returns A bytes.

Item 8 adds the server-side stale-revision fail-closed rule, so an old revision request can never receive current bytes.

### Verification

Workflow `36416821530` — SUCCESS.

Passed:

- `test:next:8`;
- `test:next:7`;
- `test:next:4`;
- `test:186:startup`;
- `test:180:rollback-contract`;
- repeat static-cache benchmark.

Artifact:

- id `10968107003`;
- digest `sha256:e82d81a0c3b2327a27c33cbbf2222e6f46091bce3182a3fd7657c79643e03dd2`.

### Files

Runtime/server:

- `server.js`.

Regression:

- `scripts/regression-next8-app-immutable-cache.cjs`;
- `package.json`.

Results:

- `docs/performance-next8-app-cache.md`;
- `docs/performance-next8-app-cache-summary.json`;
- this journal.

No `sw.js`, HTML cache policy, version.json cache policy, API cache policy, DB/schema, owner/manager/arbiter or project-wide static caching change was made.

### Production limit

The server policy is verified on the isolated application server. This item does not claim that Cloudflare or another production proxy preserves these headers unchanged.

### Rollback

Revert the targeted revision-aware `/app.js` route and remove `test:next:8`.

Item-7 URL revisioning can remain independently.

### Continuation point

**No next item started automatically.**

Follow-up item 9 is next only if explicitly requested.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 9

Status: **done — static JS/CSS compression added on the local application server**.

### Preflight

Accessible localhost stand had no compression.

Raw `Accept-Encoding: br, gzip` requests returned:

- no `Content-Encoding`;
- no `Vary: Accept-Encoding`;
- full uncompressed app.js/styles.css bodies.

Normal browser cold-start:

- 394 ms;
- 1,267,065 B JS/CSS encoded transfer.

Slow browser cold-start:

- 11,481 ms;
- 1,158,897 B JS/CSS encoded transfer.

Slow profile remained:

- 200 ms latency;
- ~1 Mbit/s down;
- ~0.5 Mbit/s up.

### Implementation

One compression mechanism was added using built-in Node `zlib`.

It applies only to GET static `.js/.css` responses.

Excluded:

- `sw.js`;
- `/api/*`;
- HTML;
- `version.json`;
- non-JS/CSS;
- Range requests.

Negotiation supports:

- Brotli;
- gzip;
- identity.

Eligible responses include:

`Vary: Accept-Encoding`

Existing ETag and Cache-Control behavior remains authoritative.

Bodies below 1 KiB and `no-transform` responses are left uncompressed.

Compressed representations are cached in memory by exact content SHA-1 plus encoding.

### Negotiation verification

`test:next:9` confirms:

- `br, gzip` → Brotli;
- `gzip` → gzip;
- `br;q=0, gzip;q=1` → gzip;
- `br;q=0, gzip;q=0, identity;q=1` → uncompressed identity;
- identity body exactly equals the original app.js bytes;
- compressed body decompresses to the exact original bytes;
- `Vary: Accept-Encoding` exists;
- ETag conditional request still returns 304;
- HTML/version.json/sw.js/API do not receive compression.

### Raw size

app.js:

- identity: 203445 B;
- Brotli: 51434 B;
- gzip: 52734 B.

styles.css:

- identity: 22435 B;
- Brotli: 5528 B;
- gzip: 5327 B.

### Browser before/after

Normal:

- JS/CSS transfer: 1,267,065 → **375,257 B**;
- reduction: **891,808 B / 70.38%**;
- startup: 394 → **374 ms**.

Slow:

- JS/CSS transfer: 1,158,897 → **343,216 B**;
- reduction: **815,681 B / 70.38%**;
- startup: 11,481 → **5753 ms**.

app.js slow:

- encoded transfer: 203797 → **51808 B**;
- duration: 4123 → **1723.3 ms**.

The transfer reduction is direct. Startup-time deltas are single-run diagnostics, not stable percentile results.

### Verification

Final workflow `36419759923` — SUCCESS.

Passed:

- `test:next:9`;
- `test:next:8`;
- `test:next:7`;
- `test:186:startup`;
- normal compressed benchmark;
- slow compressed benchmark.

Final artifact:

- `10969415405`;
- digest `sha256:8a518a4f918b272bcbd9f2bb1ce9818e9ce7dbe069e25be453f1ca327197ea8e`.

Historical no-compression evidence remains:

- normal run `36419046699`, artifact `10967179484`;
- slow run `36419329084`, artifact `10967254875`.

### Files

Runtime/server:

- `server.js`.

Regression/measurement:

- `scripts/regression-next9-static-compression.cjs`;
- `scripts/benchmark-next9-static-compression.cjs`;
- `package.json`.

Documentation:

- `docs/performance-next9-static-compression.md`;
- `docs/performance-next9-static-compression-summary.json`;
- this journal.

No Service Worker, client owner/manager/arbiter, DB/schema, updater, HTML/version cache policy or production proxy/CDN configuration changed.

### Production limit

The compression policy was verified only on the local FPChat application server. Cloudflare or reverse-proxy compression was not changed or measured.

### Rollback

Remove `staticCompression190`, the zlib import, and item-9 test/benchmark registration.

No data migration is involved.

### Continuation point

**No next item started automatically.**

Follow-up item 10 is next only if explicitly requested.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 10

Status: **done — fixed-room join/history causes measured; runtime unchanged**.

### Final measurement

Runtime measured:

`1917f36ba2257611098a8dfc5bd26c54636143d9`

Build: **190.2**.

Final clean workflow:

- run `36422527825`;
- artifact `10969644009`;
- digest `sha256:2b170cb5c1908d41c1106f7ba689edb2dea0341a32ad8c0bb4379615c685d63d`.

Fixture:

- one fixed room;
- 1500 synthetic text messages;
- initial target ordinal 351 for non-tail scenarios;
- page size 100;
- five repetitions per scenario;
- same device identity every time;
- database read/view state reset before every open;
- fresh isolated browser context per measured open;
- room becomes known only after app boot to prevent startup session-sync contamination.

Network during open:

- 200 ms latency;
- ~1 Mbit/s down;
- ~0.5 Mbit/s up.

### Timing semantics

A test-only Node preload hook adds request-wall timing for room join/messages.

This is **not production instrumentation**.

`serverMs` = Node HTTP request event → `res.end()`.

It includes route/access work, SQLite and JSON serialization. It is not SQL-only time.

`ttfbMs` = browser request start → response headers.

`durationMs` = browser request start → body complete.

### End position

Open:

- median **964.8 ms**;
- range 961.8–966.2 ms.

Join:

- server wall median **25.78 ms**;
- TTFB median **227.05 ms**;
- non-server part of TTFB median **202.79 ms**;
- body complete median **587.58 ms**;
- 45,397 B Content-Length;
- 45,702 encoded bytes;
- 100 messages / 44,699 B message JSON.

Initial tail is mounted; no around-target before/after request is needed.

### Saved anchor outside latest page

Open:

- median **2131.4 ms**;
- range 2096.2–2483.8 ms.

Join:

- server wall median **26.15 ms**;
- TTFB median **229.45 ms**;
- body complete median **589.20 ms**;
- 100 latest messages;
- 44,699 B message JSON.

Required around-target requests:

- before: server 2.45 ms median, TTFB 213.20 ms, complete 981.14 ms, 45,062 encoded bytes;
- after: server 3.74 ms median, TTFB 224.41 ms, complete 1076.23 ms, 50,562 encoded bytes.

Target is mounted in all runs; latest tail from join is not mounted.

### First unread outside latest page

Initial unread count is restored to exactly 1150 before every run.

Open:

- median **2044.5 ms**;
- range 2029.0–2062.4 ms.

Join:

- server wall median **24.46 ms**;
- TTFB median **228.09 ms**;
- body complete median **563.39 ms**;
- 100 latest messages;
- 41,099 B message JSON.

Required around-target requests:

- before: server 2.19 ms median, TTFB 213.11 ms, complete 956.95 ms, 45,028 encoded bytes;
- after: server 1.57 ms median, TTFB 224.71 ms, complete 1004.04 ms, 46,964 encoded bytes.

First unread is mounted/matches in all runs; latest tail from join is not mounted.

### Database interpretation

These numbers do not support calling join delay a database delay.

Join server request wall is only ~24–26 ms while the full join response finishes around ~563–589 ms under the configured network.

Around-history server work is ~2–4 ms while ~45–51 KB pages finish in roughly ~0.96–1.08 s.

No SQL-only duration is claimed.

### One selected confirmed extra query

Selected over-fetch:

`getMessageHistoryPage(room.id, null, HISTORY_PAGE_SIZE, updated.id)`

inside `POST /api/rooms/:publicId/join` for non-tail opens.

Evidence:

- join always embeds the latest 100;
- target ordinal 351 is not inside the latest 100;
- FPHistory174 immediately fetches before+after around the real target;
- after hydration the latest tail delivered by join is not mounted;
- join message payload alone is 44,699 B for saved-anchor and 41,099 B for unread.

The POST /join itself is required and is **not** called redundant. Only its unconditional latest-history sub-query/payload is selected.

The SQL-only cost of that one sub-query was not measured separately.

### Additional sync traffic

The clean harness also observed three no-cursor `GET /messages?limit=100` requests during the 1200 ms post-open window in each scenario, plus a zero-message after-cursor sync in the non-tail cases.

Source inspection ties latest-page snapshot behavior to existing reconnect/session sync logic.

Those requests are recorded but **not selected or modified** in item 10. Removing/deduplicating sync-owner traffic would require a separate focused task.

### Superseded exploratory run

Historical first run:

- workflow `36421597571`;
- artifact `10969462869`.

It is retained but not used for final request counts because room state was present before app boot and could start background session sync before measurement.

### Files

Diagnostics only:

- `scripts/next10-server-timing-hook.cjs`;
- `scripts/benchmark-next10-join-history.cjs`;
- package script `bench:next:10`;
- `docs/performance-next10-join-history.md`;
- `docs/performance-next10-join-history-summary.json`;
- this journal.

No `public/*`, `server.js`, DB/schema, manager/owner/arbiter, Service Worker or updater runtime changed.

### Continuation point

**No next item started automatically.**

Item 11 is next only if explicitly requested.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 11

Status: **done — server can opt in to the correct initial history window; client remains unchanged**.

### Server contract

`POST /api/rooms/:publicId/join` now supports optional:

`initialWindow: true`

Without the flag, the request follows the legacy branch unchanged and still returns
the latest page with the old response shape.

With the flag, after the existing access check the server resolves:

1. first unread;
2. saved anchor when not at bottom;
3. tail fallback.

Numeric targets are revalidated with current `q.findMessageInRoom`.

### History path

The new mode reuses existing history helpers:

- older side through `getMessageHistoryPage(... before=target+1 ...)`;
- newer side through `getMessageSyncPage(... after=target ...)`.

No new DB schema/index/query family, cache, store, manager or owner was added.

The around result is bounded to the existing page size per side, deduplicated and
sorted ascending.

It exposes the existing older cursor plus explicit newer continuation:

- `hasMore` / `nextCursor`;
- `hasNewer` / `newerCursor`.

One latest-message record is included under `initialWindow.latestMessage` so the
future client switch can retain tail identity without reloading latest-100.

### Access / unread / deletion

Verified:

- unknown device still receives 403 `ACCESS_REVOKED`;
- first unread wins over saved anchor;
- unread count and firstUnreadMessageId remain unchanged by window selection;
- no saved anchor falls back to tail;
- deleted-for-all stale anchor is rejected and falls back to tail;
- deleted unread is excluded by the existing unread queries and the next unread is selected.

### Backward compatibility

Verified without `initialWindow`:

- latest 100 are still returned;
- legacy `hasMore` / `nextCursor` remain;
- no `initialWindow`, `hasNewer`, or `newerCursor` fields are added.

The client does not send the new flag in item 11.

No `public/*` file changed.

### Cursor verification

From the returned around window:

- `GET /messages?before=<nextCursor>` returns only older messages;
- `GET /messages?after=<newerCursor>` returns only newer messages.

### Final verification

Final workflow run `36426325098`: **SUCCESS**.

Passed:

- server syntax;
- `test:next:11`;
- `test:178:history-page-owner`;
- `test:178:history-saved-anchor`;
- `test:178:unread-restore-bottom`;
- `test:188.1`;
- `test:180:single-owner-audit`.

Two pre-existing test issues were observed and intentionally not repaired in this item:

- `test:179:history-read-owner` has a stale exact source fingerprint predating item 11;
- `test:188.2` has an unrelated reaction-key ordering assertion (`heart,fire` vs `fire,heart`).

### Files

Changed for item 11:

- `server.js`;
- `scripts/regression-next11-initial-window.cjs`;
- `package.json`;
- `docs/performance-next11-initial-window.md`;
- this journal.

No DB/schema, client runtime, RoomContext, FPHistory174, FPScroll173, MessageStore,
WebSocket owner, Service Worker, updater or build number changed.

### Rollback

Revert the item-11 server/test/docs changes. No data migration or client cleanup is
required because the new server behavior is opt-in and unused by the current client.

### Continuation point

**No next item started automatically.**

Item 12 is next only if explicitly requested.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 12

Status: **done — item-11 initial history window connected to the existing client room-open path**.

### Client integration

`public/room-open170.js` now adds:

`initialWindow: true`

to the existing guarded `POST /join`.

The same RoomContext transition, `context.signal`, stale-generation checks and commit flow remain in place.

No new fetch owner or room-open owner was added.

### Initial target semantics

When the server returns `initialWindow.version=1`, the client honors the server-selected target:

- first unread;
- saved anchor;
- tail fallback.

When `initialWindow.mode=tail`, the client does not retry an unavailable/deleted saved anchor.

When the response has no `initialWindow` field, the previous client logic remains active. This is the old-server compatibility path.

### FPHistory / FPScroll

A server-provided around window already contains the target, so FPHistory174 does not issue the initial target-specific `before + after` pair.

`initialWindow.latestMessage` is preserved as `data.latestMessage174` so chat-list activity and last-known tail identity remain correct.

Existing `hasMore/nextCursor` and `hasNewer/newerCursor` continue through FPHistory174.

Later older/newer loads were verified through the existing FPHistory174 owner.

FPScroll173 remains unchanged and remains the scroll writer.

### A→B→A / cancellation

The item-12 regression delays the first A join, then runs A→B→A.

Verified:

- final `state.roomId` = A;
- current RoomContext = A;
- only the latest generation owns the final rendered DOM;
- B target is absent;
- A target is mounted.

### Old server

The regression strips `initialWindow` before the join reaches the server, forcing the legacy response.

Verified that the client falls back to the old FPHistory174 around hydration and still opens the saved anchor with newer history available.

### Deleted/stale anchor

A saved anchor is marked `deleted_for_all`.

The current server returns tail mode.

Verified that the client:

- does not issue stale-target `before`;
- does not issue stale-target `after`;
- mounts the actual tail;
- reports no newer history.

### Request count

Item-10 non-tail opening:

- join with latest 100;
- target `before`;
- target `after`.

Critical initial history requests: **3**.

Item 12:

- one join containing the useful around window.

Critical initial history requests: **1**.

Reduction: **3 → 1**.

The three no-cursor `GET /messages?limit=100` requests from existing sync/reconnect behavior are still observed post-open and remain outside item-12 scope.

### Timing comparison

Same synthetic 1500-message room, target ordinal 351, five runs, 200 ms latency, ~1 Mbit/s down / 0.5 Mbit/s up.

Tail:

- 964.8 → **962.2 ms** median;
- effectively unchanged.

Saved anchor:

- 2131.4 → **1445.0 ms**;
- delta **-686.4 ms / -32.20%**.

First unread:

- 2044.5 → **1399.8 ms**;
- delta **-644.7 ms / -31.53%**.

Critical initial encoded transfer:

- saved anchor: 141,327 → **96,309 B**;
- first unread: 134,097 → **92,639 B**.

Five samples only, so no p95 is reported.

### App revision contract

Initial verification exposed a stale app revision after modifying `public/app.js`.

The existing immutable guard correctly prevented boot.

`public/version.json.appRevision` was updated to the exact current app.js Git blob:

`b9190a5c859ee1f6bd5896a149e9eb8e7952deee`

Build remains **190.2**.

`test:next:7` passes.

### Final verification

Workflow `36429875489`: **SUCCESS**.

Measured runtime state:

`3cf04a31e45998bd2e7318b6c4dc9c980dff5316`.

Artifact:

- `10972454275`;
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

### Files

Runtime/client:

- `public/room-open170.js`;
- `public/app.js`;
- `public/history174.js`;
- `public/version.json` revision only.

Regression/measurement:

- `scripts/regression-next12-client-initial-window.cjs`;
- `scripts/benchmark-next12-initial-window.cjs`;
- `package.json`.

Documentation:

- `docs/performance-next12-client-initial-window.md`;
- `docs/performance-next12-client-initial-window-summary.json`;
- this journal.

No DB/schema, updater, Service Worker, new RoomContext/history/scroll owner or new queue was added.

### Continuation point

**No next item started automatically.**

Item 13 is next only if explicitly requested.


## Follow-up plan: docs/performance-next-steps-prompts.md — item 13

Status: **done — safe same-session MessageStore reuse for chat → list → same chat**.

### Contract

Access is still checked through the normal `POST /join` on every reopen.

The server response remains authoritative for the selected initial history window, unread state, view-state and history cursors.

`FPMessageStore172` only reuses canonical plaintext for the exact server-selected message ids.

A room is eligible only after one successful render in the current page session.

A window is reused only when every server-selected message has a safe canonical record. One missing/unsafe record rejects the whole window and keeps the existing decrypt/render path.

No persistent cache or second history owner was added.

### Canonical edit/delete state

Existing message-actions / WebSocket / lifecycle synchronization continues to update MessageStore while the room is on the list.

Verified:

- edit while on list is present in MessageStore before reopen;
- edited text re-renders from canonical RAM without repeat message decrypt;
- delete-for-all tombstone survives reopen;
- deleted message does not reappear;
- incomplete RAM window is rejected.

The first exploratory workflow `36433728539` failed only because the regression incorrectly assumed every delete must force fallback. Existing sync had already cached the adjacent message entering the shifted tail window, so safe reuse remained possible. The product path was correct; the test assumption was corrected.

### Access

A warmed room was revoked in the isolated DB before reopen.

Verified:

- reopen still issues exactly one join access check;
- rejected access renders no cached room;
- no message decrypt runs;
- active room stays null;
- existing local broken-room cleanup executes.

RAM never authorizes a room.

### Unread / read position

Unread count and first-unread target remain sourced from the fresh join response.

Saved reading position remains server view-state + FPScroll173 owned.

Regression saves a visible anchor/offset, leaves to the list, reopens, then verifies the stored anchor is mounted at the stored offset.

### Benchmark

Five independent room pairs:

- 300 synthetic messages/room;
- tail window 100 messages;
- first open and repeat open in the same page;
- fresh page between pairs;
- normal join on both opens;
- local SQLite / headless Chromium;
- no network throttling.

First open:

- raw: 183.5, 183.9, 184.0, 184.6, 198.1 ms;
- median **184.0 ms**;
- range 183.5–198.1 ms;
- **100** message decrypts median.

Repeat open:

- raw: 136.0, 136.0, 136.5, 138.2, 152.8 ms;
- median **136.5 ms**;
- range 136.0–152.8 ms;
- **0** message decrypts.

Delta:

- **-47.5 ms** median;
- **-25.82%** on this local benchmark;
- repeated message decrypts **100 → 0**.

This is a local CPU/render measurement, not a physical-phone or production-network forecast.

Five pairs only, so no p95.

### Final verification

Workflow `36434066515`: **SUCCESS**.

Runtime measured:

`43d05dbffe20f2bff779f9683aaf194b3f4e0cd2`

Artifact:

- `10974732044`;
- digest `sha256:ea1052f8d00068c85fa60e1e21df3eed614a8a12d2e10a2daec25f37cbdfa4a4`.

Passed:

- `test:next:7`;
- `test:next:13`;
- `test:next:12`;
- `check:170`;
- `test:178:message-store-incoming`;
- `test:178:message-store-ack`;
- `test:179:explicit-message-actions`;
- `test:178:history-saved-anchor`;
- `test:178:unread-restore-bottom`;
- `test:180:single-owner-audit`;
- `bench:next:13`.

### Files

Runtime:

- `public/message-store172.js`;
- `public/app.js`;
- `public/version.json` appRevision only.

Regression/benchmark:

- `scripts/regression-next13-session-reuse.cjs`;
- `scripts/benchmark-next13-session-reuse.cjs`;
- `package.json`.

Documentation:

- `docs/performance-next13-session-reuse.md`;
- `docs/performance-next13-session-reuse-summary.json`;
- this journal.

No server API, DB/schema, persistent message cache, Service Worker, updater, new RoomContext/FPHistory/FPScroll/WebSocket owner or new queue was added.

### Continuation point

**No next item started automatically.**

Item 14 is next only if explicitly requested.

## Follow-up plan: docs/performance-next-steps-prompts.md — item 14

Status: **done — representative photo/cache baseline added; runtime unchanged**.

### Plan mapping

- Follow-up item: **14 — representative photo test**.
- This is a measurement-only prerequisite for item 15.
- It does not change or automatically close an original performance-series step with the same number.
- Item 15 was not started.

### Representative fixture

The old Step 4 media baseline used `public/icons/icon-512x512.png`.

Item 14 instead generates one deterministic synthetic non-personal JPEG and uploads it through the existing media path:

- 4032×3024 px;
- 12.2 MP;
- JPEG quality 0.92;
- 2,186,611 B / 2.1 MiB plaintext;
- 2,186,639 B encrypted server payload;
- SHA-256 `d462b12f3e5618e6a59d1a6deff8ef147aa3d381c80f0038a323650ccaec3f54`.

Server-recorded dimensions, MIME and plaintext size matched the fixture.

### Cache-state contract

Three states are measured for the same media and identity:

1. **managed warm** — FPStorage167 image cache is primed; root navigation clears gallery RAM state; measured media reads are managed-cache hits and emit no media HTTP requests;
2. **managed miss / HTTP retained** — only FPStorage167 image cache is cleared; HTTP cache remains and requests revalidate with 304;
3. **managed miss / HTTP cold** — FPStorage167 is cleared and CDP `Network.clearBrowserCache` clears browser HTTP cache; requests return 200/full bytes.

Managed cache clear uses the existing `FPStorage167.clearCache(['image'])` path after `FPNetwork171.waitForMediaCacheIdle()`.

No site data or localStorage clear is used.

Identity was unchanged in **32/32** checks.

### Measurement events

Preview:

- start: immediately before `openChat(roomId)`;
- finish: target `img.media-thumb` is complete with `naturalWidth > 0`.

Original:

- start: immediately before clicking the target media tile;
- finish: viewer `.media-viewer-content img` is complete with `naturalWidth > 0`.

These are DOM image readiness/decode events, not hardware-presentation timestamps.

Current viewer does not yet use the ready chat thumbnail as an immediate viewer preview. That remains item 15.

### Normal results

| Cache state | Preview median | Original median |
| --- | ---: | ---: |
| Managed warm | 134.8 ms | 41.0 ms |
| Managed miss / HTTP retained | 131.2 ms | 61.9 ms |
| Managed miss / HTTP cold | 131.7 ms | 74.0 ms |

HTTP retained used 304 for preview and original.

HTTP cold used 200/full transfer.

### Throttled results

Profile: 200 ms latency, ~1 Mbit/s down, ~0.5 Mbit/s up.

| Cache state | Preview median | Original median |
| --- | ---: | ---: |
| Managed warm | 665.1 ms | 48.8 ms |
| Managed miss / HTTP retained | 697.2 ms | 296.6 ms |
| Managed miss / HTTP cold | 794.8 ms | 44,293.9 ms |

Managed warm emitted zero measured media HTTP requests.

HTTP-retained requests returned 304 with only 1,325 B preview + 1,340 B original encoded wire data across five samples.

HTTP-cold requests returned 200; across five samples:

- preview: 15,645 B total / 3,129 B each;
- original: 10,934,810 B total / 2,186,962 B each.

### Confirmed variability

Throttled HTTP-cold original raw values:

`18,329.3, 44,293.9, 44,345.6, 18,329.6, 44,326.5 ms`.

The two timing clusters are real in this run, but their cause was not established.

Do not attribute them to AES, resource admission, SQL, cache writer or CDP without a separate measurement.

### Verification

Workflow `36438896836`: **SUCCESS**.

Measured runtime:

`43d05dbffe20f2bff779f9683aaf194b3f4e0cd2`.

Measurement head:

`c0ed25f8162abc6d7cbdb6d4bb58780d9420bea8`.

Artifact:

- id `10977112464`;
- digest `sha256:f4d2ac974c7f89852bdf7c88434107e14016828c108b39ed00ffd4442bd9fc0a`.

Passed:

- benchmark syntax;
- `test:186:media-cache`;
- `test:177:media-viewer-lifecycle`;
- `test:185:browser`;
- `test:190:browser`;
- `bench:next:14`.

No browser page errors were reported.

### Files

Measurement:

- `scripts/benchmark-next14-photo-cache.cjs`;
- `package.json`.

Documentation:

- `docs/performance-next14-representative-photo.md`;
- `docs/performance-next14-representative-photo-summary.json`;
- this journal.

No runtime/application source file was changed.

The temporary item-14 workflow is removed after preserving the result.

### Limits

- only five samples per scenario, so no p95;
- no physical iPhone/Android measurement;
- preview timing begins before room open and includes join/open work;
- throttled HTTP-cold two-cluster original timing remains unexplained;
- the result is a laboratory baseline, not a production/mobile latency prediction.

### Rollback

Remove the item-14 benchmark, npm script and item-14 docs.

No cache migration, identity reset or runtime rollback is required.

### Continuation point

**No next item started automatically.**

Item 15 is next only if explicitly requested.

## Follow-up plan: docs/performance-next-steps-prompts.md — item 15

Status: **done — selected photo preview is shown immediately, then replaced by a decoded original on the existing viewer path**.

### Plan mapping

- Follow-up item: **15 — show preview before original**.
- This does not renumber or automatically close an original performance-series step.
- Item 16 was not started.

### Runtime change

For a selected image whose chat thumbnail is already ready:

- `public/app.js` passes the existing thumbnail `blob:` URL and media dimensions as a narrow preview hint;
- `media-gallery134` immediately mounts that URL in the active viewer slot;
- no new thumbnail request is issued;
- the existing `loadAsset()` path continues loading the original through `FPNetwork171`;
- the original is decoded before presentation;
- the same visible `<img>` node changes from preview to original;
- width/height geometry and the existing pinch/pan transform remain stable.

Videos are unchanged.

If the original fails, the preview remains visible and an error/retry overlay uses the existing `dropAsset() -> mountSlot()` path.

### Owners and cancellation

Preserved:

- `FPMediaManager177` — viewer open/close/cleanup owner;
- `FPLayer173` — existing `viewer` layer;
- `FPGesture135` — gesture arbiter;
- existing Build-185 pinch/pan executor;
- `FPNetwork171` / `FPStorage167` — original network/cache path;
- existing gallery current/neighbor admission;
- RoomContext/generation/AbortSignal ownership.

No second media owner, layer owner, gesture arbiter, queue, cache or persistent storage was added.

`loadAsset`, `dropAsset`, `pruneAssetCache` and `navigateGallery` remain unchanged.

Frozen fingerprints:

- loadAsset: `5d4db0f6e8f07849`;
- dropAsset: `73c987110d973502`;
- pruneAssetCache: `d22f05b91e20c181`;
- navigateGallery: `4c04706e7e9c706f`;
- changed mountSlot: `fd3f520719ce2b7a`.

### Behavioral verification

The new item-15 browser regression verifies:

- existing ready chat preview URL is reused;
- no second thumbnail fetch;
- one existing selected-original load;
- same image node and unchanged untransformed layout geometry across preview -> original;
- pinch while preview is visible survives original readiness;
- pan remains functional after swap;
- close during pending original rejects late UI mutation;
- mobile swipe during pending loads preserves the new current item;
- failed original keeps preview visible;
- retry reuses existing owner/load path;
- no stuck gesture lease.

Existing regressions also pass:

- appRevision contract;
- media viewer lifecycle;
- layer contract;
- gesture/layer lifecycle;
- Build-185 photo zoom;
- media cache;
- Build-190 media browser.

### Corrected test assumptions

Historical failed runs were test-only failures:

- `36442158213`: transformed 2× rect was compared with pre-pinch geometry;
- `36442373156`: test tried to click a desktop nav arrow hidden on the mobile viewport;
- `36442675905`: test expected `media-viewer` while the existing layer contract is `viewer`.

No product regression was confirmed by those runs.

### Controlled same-run performance comparison

To avoid comparing different GitHub runner CPUs, final run `36444021552` executed item 14 and item 15 sequentially on the same runner.

Both used:

- Chromium 140.0.7339.16;
- Node 22.23.2;
- 4 vCPU AMD EPYC 7763;
- identical 4032×3024 / 2,186,611 B fixture;
- identical fixture SHA-256 `d462b12f3e5618e6a59d1a6deff8ef147aa3d381c80f0038a323650ccaec3f54`;
- identical cache/network scenarios;
- five samples each.

#### Normal

| Cache state | Item 14 original | Item 15 preview | Item 15 original |
| --- | ---: | ---: | ---: |
| Managed warm | 41.4 ms | **8.9 ms** | 91.9 ms |
| Managed miss / HTTP retained | 74.6 ms | **22.9 ms** | 108.3 ms |
| Managed miss / HTTP cold | 75.3 ms | **9.7 ms** | 109.5 ms |

#### Throttled

200 ms latency, ~1 Mbit/s down, ~0.5 Mbit/s up.

| Cache state | Item 14 original | Item 15 preview | Item 15 original |
| --- | ---: | ---: | ---: |
| Managed warm | 46.1 ms | **5.9 ms** | 96.4 ms |
| Managed miss / HTTP retained | 295.0 ms | **6.4 ms** | 329.3 ms |
| Managed miss / HTTP cold | 18,363.4 ms | **5.6 ms** | 18,427.0 ms |

In the HTTP-cold throttled case, usable preview becomes ready **18,357.8 ms earlier** than the old item-14 original-only presentation.

The original transfer itself is not made faster.

### Confirmed decode-before-swap cost

Item-15 original readiness is later than item 14 by:

- normal: +50.5 / +33.7 / +34.2 ms;
- throttled: +50.3 / +34.3 / +63.6 ms;

for managed warm / HTTP retained / HTTP cold respectively.

The current implementation deliberately waits for decode before swapping the visible source.

On the throttled HTTP-cold case the +63.6 ms cost is about +0.3% of the full-original wait.

This is recorded rather than hidden as a claimed speedup.

### Final verification

Functional/performance run `36442826065`: **SUCCESS**.

Artifact:

- id `10978968849`;
- digest `sha256:7054c5b144e23c934f82fc401a45a200c7eea1b5f071183c6952eeada4d04b92`.

Controlled A/B run `36444021552`: **SUCCESS**.

Controlled artifact:

- id `10981050583`;
- digest `sha256:81c7f42ec92abaaeb72ada11acdbfd6ab9538d8eeaaf6cd97748da96ea1819e7`.

Runtime measured:

`2bf734e918dfb7e31d14d574d52a7d3256076000`.

Build remains **190.2**.

appRevision:

`01a8e946b71251d38838303a659e28e150d6d48a`.

### Files

Runtime:

- `public/app.js`;
- `public/media-gallery134.js`;
- `public/styles.css`;
- `public/version.json` revision only.

Regression/measurement:

- `scripts/regression-next15-progressive-photo.cjs`;
- `scripts/regression177-media-viewer-lifecycle.cjs` expected fingerprint/comment;
- `scripts/benchmark-next15-progressive-photo.cjs`;
- `scripts/compare-next15-item14.cjs`;
- `package.json`.

Documentation:

- `docs/performance-next15-progressive-photo.md`;
- `docs/performance-next15-progressive-photo-summary.json`;
- this journal.

Temporary item-15 workflow is removed after preserving the result.

### Limits

- five samples per scenario; no p95;
- no physical iPhone/Android/PWA measurement;
- DOM image readiness/decode is not a physical display timestamp;
- progressive preview is only reused when the selected chat thumbnail is already ready;
- decode-before-swap adds a confirmed ~34–64 ms to original-ready in Chromium CI.

### Rollback

Revert the item-15 runtime changes, restore prior appRevision, and remove item-15 test/measurement/docs files.

No DB/cache migration, identity reset or persistent-data cleanup is required.

### Continuation point

**No next item started automatically.**

Item 16 is next only if explicitly requested.

