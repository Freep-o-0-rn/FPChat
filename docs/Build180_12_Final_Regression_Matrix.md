# Build 180.12 — Final regression and physical 168 → final matrix

## Status

**Automated accumulated regression: PASS.**

**Physical / production acceptance: NOT RUN.**

Build 180.12 must not convert an unknown physical result into PASS. The automated candidate is accepted by CI, but the physical-device/production part remains open until it is actually executed on the target devices and installation.

## Compared revisions

- Stable behavior baseline: Build 168 commit `9c53a7a0329f267a51c7e976f1c4c825d9b7ae42`.
- Automated final candidate: `c4ca434a706d3c98c5b731257086e206da30171c`.
- Full acceptance workflow run: `35812091731`.
- Branch: `build/180-development`.

The documentation commit created after this result does not change executable application/test code.

## Automated accumulated regression

The Build 180.12 runner executes the leaf-level checks directly instead of inflating the total with npm aggregators that call the same files again.

Result on the final candidate:

| Result | Count |
|---|---:|
| PASS | 108 |
| EXPECTED_FAIL | 1 |
| FAIL | 0 |
| TIMEOUT | 0 |
| XPASS | 0 |
| Total leaf checks | 109 |

The separate Windows acceptance job also completed successfully. It includes the accumulated Build 180.1–180.11 contract plus isolated updater, launcher and failed-update rollback checks.

### Explicit automated exception

`regression178-release.cjs` is the only `EXPECTED_FAIL`.

Reason: it intentionally freezes the Build 178.28.1 updater/launcher release contract. Build 180.4–180.7 deliberately replaced that exact Windows script contract with the newer protected-data, isolated staging, dedicated launcher and automatic rollback behavior. The replacement behavior is covered by the Build 180 Windows static and isolated acceptance tests.

This exception is not counted as PASS and is not hidden. Any other failed test, timeout, or unexpected pass of an expected-failure entry fails the Build 180.12 cumulative gate.

## Regression infrastructure corrections made during 180.12

Only regression/test infrastructure was corrected; application runtime behavior was not rewritten for this step.

- Browser regression harness now launches the same production entry: `node server.js`.
- Build 170–173/176 checks accept dotted later build metadata instead of rejecting `178.28.1` as non-numeric.
- Stale source-text checks were updated to follow the already accepted later owners/delegates such as `FPStartup174` and `FPReadState178`.
- Broken helper parsers that confused destructuring braces with function bodies were corrected.
- The gesture regression now keeps the old lease reference instead of overwriting it before testing invalidation.
- The composer-edit browser regression waits for the actual settled edit UI state before taking its assertion snapshot.
- The cumulative runner has an explicit expected-failure manifest and a hard gate: unexpected FAIL, TIMEOUT, or XPASS fails CI.

## Physical 168 → final matrix

Legend:

- **PASS** — physically executed and matched the Build 168 behavior/invariant.
- **FAIL** — physically executed and behavior regressed.
- **NOT RUN** — not physically executed in Build 180.12; must not be interpreted as PASS.
- **N/A** — intentionally changed behavior accepted by the Build 180 plan.

| Area | Physical comparison to Build 168 / required result | Status |
|---|---|---|
| Windows desktop browser | Open app, chats list and existing 1-to-1 room; no boot errors or visible startup regression | NOT RUN |
| Second physical device | Two real participants can open the same room and exchange messages | NOT RUN |
| iPhone / Safari PWA | Open/install PWA, chat navigation, keyboard, safe-area/header, return from background | NOT RUN |
| Android / weaker device | Open long room, scroll, type/send, background/foreground without visible degradation | NOT RUN |
| Text send | One send action creates exactly one message; no duplicate send | NOT RUN |
| Delivery/read status | sent → delivered → read remains correct between two physical devices | NOT RUN |
| Reconnect | Temporary network loss/recovery reconnects without duplicate WS behavior or duplicate sends | NOT RUN |
| Runtime offline queue | Send while the current tab is temporarily offline, then recover; behavior remains the accepted non-persistent runtime queue | NOT RUN |
| Room A → B isolation | Fast room switch never lets late A data/UI mutate B | NOT RUN |
| Draft | Draft save/restore remains Build-168-compatible | NOT RUN |
| Reply | Reply selection, preview and reply target behavior remain intact | NOT RUN |
| Edit | Enter/cancel/commit edit; draft restored correctly; send/mic state correct | NOT RUN |
| Delete message | Delete for self / for both follows existing permissions and UI behavior | NOT RUN |
| Pins | Pin/unpin/open pinned message and pin screen behavior remain intact | NOT RUN |
| Context/selection | Long press/context menu/selection actions do not duplicate or leak after navigation | NOT RUN |
| First unread | Room opens at the accepted first-unread target when applicable | NOT RUN |
| Saved scroll restore | Existing saved position restoration behaves as before | NOT RUN |
| Bottom/new message | Bottom anchoring and new-message pill behave as before | NOT RUN |
| Lazy/prepend history | Loading older history does not steal user scroll or visibly jump after media/layout changes | NOT RUN |
| Long history | Large history remains responsive and bounded without breaking reply/pins/unread/selection | NOT RUN |
| Back gesture | Edge back from chat/settings works and vertical scrolling is not stolen | NOT RUN |
| Keyboard/orientation | Mobile keyboard open/close and orientation changes do not displace header/composer/scroll unexpectedly | NOT RUN |
| Photo send | Encrypt/upload/receive/open photo on second physical device | NOT RUN |
| Video send/playback | Encrypt/upload/receive/play video on second physical device | NOT RUN |
| Voice record/send/play | Press/lock/stop/preview/cancel/send/play on real microphone devices | NOT RUN |
| Media cancel/cleanup | Cancel before encryption, during upload, and around commit boundary without stale preview/object URL | NOT RUN |
| Media viewer lifecycle | Open/close viewer and leave room without closing or corrupting another room's viewer | NOT RUN |
| Push notification | Real push while receiver is backgrounded/closed; one notification per message | NOT RUN |
| Push privacy | Sender/text visibility follows current notification settings on a real device | NOT RUN |
| Presence | Online/offline/background visibility behaves as Build 168 intended between physical clients | NOT RUN |
| Normal invite join | Invite grants exactly one normal join and does not duplicate the system event | NOT RUN |
| Blocked invite join | Blocked join grants no access and does not consume the invite | NOT RUN |
| Block state | Block/unblock and presence/send restrictions match the current server-authoritative contract | NOT RUN |
| Real Windows updater | Update an isolated copy created from the actual server installation and verify protected data/config/dependencies | NOT RUN |
| Real production update | Update the live FPChat installation with real user data | NOT RUN |
| Real launcher | On the actual Windows host: one FPChat instance only, unrelated Node processes untouched | NOT RUN |
| Real rollback | Force a failed update against a disposable clone of the real installation and verify exact compatible restore | NOT RUN |
| WAN / Cloudflare tunnel | Two physical devices over separate networks exchange text/media/voice through the deployed tunnel | NOT RUN |

## Automated coverage corresponding to the physical matrix

The `NOT RUN` labels above do not mean there is no coverage. CI covers many of the same invariants using static checks, integration fixtures, Chromium browser tests and isolated Windows copies, including:

- RoomContext/generation/cancellation and connection ownership.
- FPNetwork fetch/XHR/cache ownership.
- MessageStore merge/status/reply dependencies.
- Layer/Gesture/Scroll/Viewport ownership.
- history paging, anchor restoration and bounded DOM.
- composer/send/media/voice ownership paths.
- read/unread delivery separation and batching.
- server bootstrap/direct composition and history DB read owner.
- block state/invite guards.
- updater/launcher/rollback Windows contracts and isolated copies.

Those results establish the automated candidate, but they do not substitute for the physical rows above.

## Build 180.12 acceptance decision

### Closed

- Accumulated automated regression: **PASS**.
- Unexpected automated failures: **0**.
- Timeouts: **0**.
- Unexpected expected-failure passes: **0**.
- Windows updater/launcher/rollback isolated acceptance: **PASS**.
- All automated exceptions are explicitly listed.

### Still open

- Physical-device 168 → final matrix: **NOT RUN**.
- Actual production-server update/rollback: **NOT RUN**.
- Real push/microphone/media/WAN behavior: **NOT RUN**.

Therefore Build 180.12 is **automatically accepted but not physically/production accepted yet**. Do not label the whole 168 → final physical acceptance PASS until the corresponding rows have actually been executed.
