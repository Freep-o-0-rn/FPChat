# Build 178.21 — active gesture promotion, cancellation and session isolation

Base: Build 178.20 on `build/178-development`.

## Existing promotion contract

`FPGesture135.promote()` only moves an active session upward when the current `FPLayer173` priority becomes greater than the session's frozen layer. It never demotes the same session.

Example:

`chat touch → context appears → session.layer=context → lower actions cancel('layer')`.

If context then closes before the finger is released, `FPLayer173.top` may return to chat, but the active gesture session remains frozen at context. The old lower-screen recognizer therefore cannot resume in the same physical gesture.

## Proven stale-lease hole

Before 178.21 `watchAction()` removed cancelled watchers from `session.actions`, but the previously returned lease object could still call `claim()` as long as the same session object remained current.

This violated the arbiter contract even though current feature callbacks normally stop themselves after cancel.

178.21 tightens only the lease:

`lease.claim()` now succeeds only when `session.actions.get(owner) === cancel`, meaning the watcher is still actively registered in that session.

After layer cancellation, explicit release, or replacement, a stale lease can no longer revive.

## Session isolation

Touch restart cancels only the previous touch actions and replaces only `touchSession`.

Pointer restart does the same only for `pointerSession`.

`touchcancel/touchend` run `endSession('touch')`; `pointercancel/pointerup` run `endSession('pointer')`. Their cleanup microtasks clear only the matching session object.

The explicit lifecycle reset (`blur/pagehide/background`) intentionally clears both session kinds.

## Regression

`npm run test:178:gesture-layer-lifecycle` runs static guards plus browser-harness scenarios:

- chat gesture promoted to context when context appears;
- lower watcher receives `cancel('layer')` exactly once;
- context closes before finger release but active session does not demote;
- stale lower lease cannot claim after cancellation;
- touch restart invalidates the old touch lease;
- touchcancel leaves a parallel pointer session alive;
- pointercancel leaves a parallel touch session alive.

No layer priorities, feature thresholds or recognizers are changed.
