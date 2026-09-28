# Build 178.26 — geometry property / writer map

Base: Build 178.25 on `build/178-development`.

178.26 is an audit/contract step. Runtime behavior is unchanged.

## Rule

A conflict exists only when two active mechanisms write the **same concrete property on the same target**.

Two modules reacting to the same browser event are not automatically competing writers. For example, keyboard detection may write keyboard state while viewport layout writes CSS geometry. Those are different properties and may coexist.

## Property / writer table

| Concrete property | Target | Active writer(s) | Consumer / effect | 178.26 classification |
| --- | --- | --- | --- | --- |
| `scrollTop` / smooth scroll | `#messages` | `FPScroll173` (`app.js::scrollCoordinator.write`) | opening, unread, restore, bottom, history anchor, reply/pin | **message scroll**; not viewport geometry |
| direct bottom fallback `scrollTop = scrollHeight` | `#messages` | `viewport-fix.js::keepBottomPinned()` only if `FPScroll173` and legacy coordinator are both unavailable | keyboard-transition bottom pin compatibility fallback | known **message-scroll fallback**, not a viewport-geometry property |
| `--fpchat-visible-height` | `#appRoot` inline style | `viewport-fix.js::syncViewportNow()` / cleanup | injected CSS resolves `#appRoot height` | **viewport geometry**; one active JS writer |
| `--fpchat-viewport-correction-y` | `#appRoot` inline style | `viewport-fix.js::syncViewportNow()` / cleanup | injected CSS resolves `#appRoot transform` | **viewport geometry**; one active JS writer |
| resolved `height` | `#appRoot.fpchat-mobile-chat-viewport` | CSS rule installed by `viewport-fix.js`, consuming `--fpchat-visible-height` | fixed mobile chat viewport height | CSS consumer of the same viewport owner, not a second JS writer |
| resolved `transform` | `#appRoot.fpchat-mobile-chat-viewport` | CSS rule installed by `viewport-fix.js`, consuming `--fpchat-viewport-correction-y` | compensates WebKit viewport pan | CSS consumer of the same viewport owner, not a second JS writer |
| `fp-keyboard-open`, `fp-keyboard-opening`, `fp-keyboard-closing`, `data-fp-keyboard` | `<html>` | `viewport-layout136.js` / `FPViewport136` | keyboard-dependent CSS | **keyboard state**, not numeric viewport geometry |
| `padding-bottom` while iOS keyboard is open | `.composer` | conditional CSS installed by `viewport-layout136.js` | replaces default safe-area padding while keyboard owns bottom region | CSS geometry driven by keyboard state; not a JS geometry writer |
| `bottom` while iOS keyboard is open | `.new-messages-pill` | conditional CSS installed by `viewport-layout136.js` | positions pill above keyboard/composer | CSS geometry driven by keyboard state; not message scroll |
| `env(safe-area-inset-*)` contribution | multiple CSS targets (`.composer`, list, sheets, toast) | browser CSS environment + static `styles.css` rules | safe-area padding/offsets | CSS/browser input; no JS writer |
| `height` | `#msgInput` textarea | `app.js::autoResizeMessageInput()` for normal autosize; `chat-fix.js::collapseEmptyComposer()` only when value is empty | composer textarea size | same property, but **composer subsystem**, not viewport geometry; established role split |
| `scrollTop` | `#msgInput` textarea | `chat-fix.js` empty reset | collapses stale WebKit textarea scroll after clear | textarea scroll, not `#messages` |
| `transform` | `.fp-settings131` | active `swipe-fix.js` settings gesture | visual edge-back translation | gesture geometry, not viewport geometry |
| `transform` | `.fp-settings131` | `settings-ui131.js::installBackSwipe()` contains legacy writes, but the function has no call site | none in current runtime | dormant definition, not a second active writer |
| `transform` | `.chat-view` | legacy `app.js::setupChatBackSwipe()` only when `FPGesture135` is absent | fallback chat back swipe | gesture fallback, not `#appRoot` viewport transform |
| `scrollTop` | `.message-context-scroll` | `message-context.js` | keep context menu/clone visible | separate overlay scroll container, not `#messages` |

## Important separation

### 1. Keyboard state is not viewport geometry

`FPViewport136` decides whether the software keyboard is open and writes state to `<html>` classes/data. It does not write `--fpchat-visible-height`, `--fpchat-viewport-correction-y`, or `#messages.scrollTop`.

### 2. Viewport geometry is not message scroll

`FPViewport173` / `viewport-fix.js` owns the mobile viewport CSS variables. It may request a bottom pin through `FPScroll173`, but that request does not make it the owner of message scroll.

The one remaining direct `box.scrollTop = box.scrollHeight` line in `viewport-fix.js` is already-known compatibility fallback behavior for **message scroll**. It must not be reclassified as a second viewport-geometry writer.

### 3. CSS geometry is not automatically a JS writer

The `#appRoot` height/transform rules consume variables written by `viewport-fix.js`. Keyboard-open composer/pill rules consume state written by `FPViewport136`. Safe-area values come from CSS `env(...)`.

These change computed geometry, but they do not create independent JavaScript writers for the viewport variables.

## 178.27 implication

This audit does **not** prove a competing active writer for either viewport numeric property:

- `--fpchat-visible-height`;
- `--fpchat-viewport-correction-y`.

Therefore 178.27 must not migrate code merely because `viewport-fix.js` and `viewport-layout136.js` both observe resize/visualViewport/keyboard-related events. A migration in 178.27 is justified only if a second active writer of the same concrete viewport property is demonstrated.

178.26 itself makes no runtime changes.

## Build 190.2 scroll restore addendum

The Telegram-like scroll restore fix does **not** introduce a second scroll owner.

### Ownership after the fix

- `FPScroll173` remains the single active owner of programmatic `#messages.scrollTop` writes.
- `FPScroll173` also owns capture/restore arbitration for the same message viewport: stable anchor + pixel offset, true-tail detection, user-intent cancellation, bounded durable local capture and network flush scheduling.
- `room-open170` remains the room transition/access owner. On A -> B it asks `FPScroll173` to freeze A's concrete snapshot before replacing RoomContext/DOM, then carries B's durable candidate through the existing guarded join. It does not write message scroll itself.
- `FPHistory174` remains the bounded history-window loader. It supplies/mounts the required window and requests established scroll operations; it does not become a persistence or scroll owner.
- `FPLifecycle170` remains the lifecycle signal owner. Lifecycle paths may request a final `FPScroll173` capture; lifecycle does not perform a second restore.
- `STORAGE` is only the persistence medium for compact position metadata. It is not a manager/arbiter.
- the server `chat_view_state.client_seq` check is an ordering guard against stale writes, not a scroll controller.
- `FPRuntime169` remains passive diagnostics only.

### Persistence/ordering contract

The scroll owner stores only position metadata:

- room/device identity;
- anchor message id;
- viewport-relative anchor offset;
- true-tail flag;
- local capture time/context generation;
- tab identity/interaction version;
- monotonically ordered `clientSeq`.

No message plaintext, room secret or cryptographic key is added to the position snapshot.

Local capture is bounded to a declared 300 ms interval while the user is actively changing position. Network flush is bounded to a declared 900 ms maximum lag while the page remains runnable. A process kill can therefore restore only the last snapshot that actually reached durable local storage; the contract does not promise an unsaved final pixel.

For shared-device/multi-tab ordering, the client keeps a durable per-device sequence floor and uses Web Locks when available; the server independently rejects stale/equal ordered writes. A stale/background tab that has no new position intent may flush its existing snapshot but may not manufacture a newer sequence from old geometry.

### Restore priority

The active restore contract is:

1. explicit focus/bottom action already queued by the user;
2. user scroll that interrupts an unfinished opening;
3. valid saved non-bottom anchor + pixel offset;
4. first unread when there is no usable saved reading anchor (including a previously saved true tail with newly unread messages);
5. true tail.

A loaded-window bottom with `hasNewer` / local newer history is not treated as the true end of chat.

Read state remains separate: restoring geometry does not itself mark messages read; the existing visibility admission/read owner remains responsible.

