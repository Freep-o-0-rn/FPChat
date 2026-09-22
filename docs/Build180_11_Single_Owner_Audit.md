# Build 180.11 — single-owner audit

## Scope

180.11 is an audit-only step.

It does not create another manager/arbiter, move business logic, remove compatibility fallbacks, or change timer cadence. The goal is to prove ownership using concrete write sites, listener sites and timer sites rather than class names.

The audit covers resources already transferred in Builds 170–180.

## Result

No second **active** owner was proven for the migrated resources.

Several compatibility paths and safety timers remain visible in source. They are documented below because hiding them would make the audit misleading. They do not currently form a second owner for the same migrated resource under the accepted startup graph.

## Evidence matrix

| Resource | Canonical owner / executor | Writer evidence | Listener / timer evidence | Result |
| --- | --- | --- | --- | --- |
| Room transition/context | `FPRoomContext170` | one active context, one pending transition, one operations map | no polling loop owns room transitions | PASS |
| Browser lifecycle normalization | `FPLifecycle170` | one publisher of `fpchat:lifecycle170` | visibility/online/offline/focus/blur/pageshow/pagehide are registered by the lifecycle owner; no interval polling | PASS |
| WebSocket construction | existing stable WS worker in `app.js` | exactly one client `new WebSocket(...)` construction site | `FPConnection170` observes open/close/error and owns one reconnect timeout; it does not construct another socket | PASS |
| Reconnect/resume sync trigger | `FPSyncCoordinator176` facade + existing app workers | exactly one coordinator call for reconnect and one for resume | coordinator owns no timer, queue, fetch or retry loop; existing worker dedupe remains in app | PASS |
| Fetch transport | `FPNetwork171` | non-configurable `window.fetch` accessor is the physical coordinator; legacy assignments are registered as known stages | no second fetch scheduler | PASS |
| XHR open/send | `FPNetwork171` | non-configurable accessors own `XMLHttpRequest.prototype.open/send`; typing compatibility assignment becomes one registered layer | upload listeners remain request-local | PASS |
| Managed encrypted-media cache mutation | `FPNetwork171` | physical native Cache.put/delete calls are inside the managed-cache gate; one namespace `fpchat-media-v167` | in-flight write map provides serialization; no cache polling owner | PASS |
| Media resource slots | `FPNetwork171` media budget | one physical `releaseMediaSlot(weight)` path behind an idempotent per-request release closure | no interval admission loop; queued requests are released by completion/cancel/error | PASS |
| Message state | `FPMessageStore172` | normal `messageCache` is its compatibility adapter; legacy `.set()` calls delegate to Store metadata/tombstone mutation | Store emits one canonical changed event; no Store polling interval | PASS |
| Chat-list render | `FPChatList174` | legacy `renderChats` delegates; row identity keyed by roomId | render revision/frame batching stays in owner | PASS |
| Message render | `FPMessageRender178` + single `appendMessage` template | active incoming path canonicalizes through Store then mounts once | decorators wrap the existing renderer rather than creating another template | PASS |
| Read batching/flush | `FPReadState178` | exactly one `pendingReadQueue` map and one bulk-send worker | exactly one per-entry 1500 ms retry timeout; legacy flush is a facade delegate | PASS |
| Composer normal bind | `FPComposer177` | one normal input listener and one normal keydown listener per form; render delegates | WeakSet prevents repeat bind; text submit remains separate owner | PASS |
| Text submit | `FPTextSend170` | one `form.onsubmit = dispatchSubmit` assignment | repeated bind guard prevents stacking | PASS |
| Send arbitration | `FPSendManager177` | stateless one-executor dispatch only | owns no listener, queue, retry, transport or timer | PASS |
| Media preview / generated thumbnail lifetime | `FPMediaManager177` | active preview identity and generated-thumbnail ObjectURL release are centralized | no upload/encryption/MediaRecorder timer moved into manager | PASS |
| Voice composer UI lifetime | `FPMediaManager177` + existing `voice.js` worker | mount/unmount delegates once per exact form | `FPDOM173` composer lifecycle drives normal mount/unmount; existing voice room-change timer remains voice recording/preview logic, not a second UI-lifetime owner | PASS |
| Layer state | `FPLayer173` | exactly one claims map | layer observers update the same claims map; no second layer stack | PASS |
| Gesture arbitration | `FPGesture135` | one active gesture session/claim arbiter | global touch/pointer capture listeners live in gesture manager; feature thresholds/timers remain in feature controllers | PASS |
| Message scroll | `FPScroll173` | normal `#messages` writes use the central writer; message-removal direct writer was removed | native scroll listeners are observational; viewport direct write remains only a guarded compatibility fallback if both scroll owners are unavailable | PASS with explicit fallback |
| Viewport numeric geometry | `FPViewport173` / `viewport-fix.js` | all JS writers of `--fpchat-visible-height` and `--fpchat-viewport-correction-y` are in one file/owner | resize/orientation/visualViewport listeners and settle timeouts belong to that same geometry owner | PASS |
| History page DB snapshot | `FPHistoryRead179` | one history read transaction wraps page SELECT plus media hydration; no second DB connection/pool | no history polling owner | PASS |
| Server extension composition | explicit `server.js` composition | production starts as `node server.js`; each migrated installer is invoked once | old preload bootstrap is not the production entry | PASS |
| Block authority | one `fpUserBlocks165` instance / SQLite `chat_request_blocks` | text/media/voice/typing/invite guards read the same server owner | one accepted 1 s server change watcher; client 10 s room-status refresh is presentation recovery, not authority | PASS |
| Client startup readiness | `FPStartup174` | one readiness promise and one final send-owner ready event | one room-lifecycle readiness listener; no AppCoordinator, init queue or startup interval was added | PASS |

## Compatibility paths that remain visible

### Fetch/XHR legacy assignment sites

Several legacy modules still contain assignments such as `window.fetch = wrappedFetch` and the typing XHR wrapper.

They are not physical transport owners during the accepted startup path. `FPNetwork171` installs non-configurable accessors first and recognizes those exact source files as compatibility stages. Unknown assignments are rejected.

180.11 verifies that every remaining direct `window.fetch = ...` source belongs to the explicit `LEGACY_SPECS` list.

### MessageStore fallback

`app.js` still contains:

```js
window.FPMessageStore172?.legacyCacheAdapter(...) || new Map()
```

The accepted startup graph loads MessageStore before app.js, so the Map is failure compatibility, not the normal owner.

All normal `messageCache.set(...)` calls therefore enter the Store adapter. Adapter delete/clear cannot destroy canonical Store state.

### Message-scroll fallback

`viewport-fix.js` still contains a direct:

```js
box.scrollTop = box.scrollHeight;
```

It is reached only after both:

1. `window.FPScroll173?.requestBottom` is unavailable;
2. the legacy `scrollCoordinator?.requestBottom` is unavailable.

The accepted startup graph creates `FPScroll173` in app.js before the late viewport layer. This line remains an explicit failed-owner compatibility fallback, not a normal competing writer.

### Voice timer

`voice.js` retains its existing room-change polling used by `handleRoomChange173()`.

Build 177.25 transferred only exact composer voice UI mount/unmount lifetime. Recording/preview cancellation on room identity change deliberately remained in `voice.js`. Therefore this timer is not a second MediaManager voice-UI owner.

### Block timers

The server retains one 1 s block snapshot watcher. It detects committed block-row changes and emits `user-block:changed`.

The client retains:

- the legacy wrapper-install compatibility polling;
- a 10 s visible-room status refresh.

Neither client timer grants permission or mutates canonical block truth. Server guards remain authoritative.

### Sync watchdog

`message-actions.js` retains the accepted 30 s reconciliation watchdog.

`FPSyncCoordinator176` was intentionally designed as a thin trigger facade and owns no timer/queue/retry state. The watchdog remains worker behavior rather than a second coordinator implementation.

## Timer boundary

180.11 does **not** claim that FPChat has zero timers.

It proves that timer existence is assigned to the correct responsibility. Existing feature/safety timers remain visible, including:

- WS reconnect timeout in Connection170;
- read retry timeout in FPReadState178 worker;
- media/typing/voice activity heartbeats;
- voice recording UI/max-duration timers;
- viewport settle timeouts;
- message-actions reconciliation watchdog;
- block server watcher and client status refresh;
- system/chat-request safety refresh/countdown timers;
- server stale-media, heartbeat and solo-room cleanup timers.

A timer is a duplicate-owner defect only when it independently writes or arbitrates the same migrated resource. 180.11 found no such active duplicate in the audited owner set.

## Acceptance

`npm run test:180:single-owner-audit` verifies the evidence above directly from source:

- concrete writer counts;
- concrete listener/publisher counts;
- concrete timer ownership/boundaries;
- compatibility fallback guards;
- explicit server installer counts;
- block authority/timer separation;
- startup readiness uniqueness.

No runtime source changes are made by 180.11.
