# Build 177.8 — ResourceArbiter acquire/release balance

Build 177.8 verifies the existing media admission mechanism. It does not add another queue, retry scheduler or resource owner.

## One acquire

For a same-origin media GET matching `/api/media/:id/blob` or `/api/media/:id/thumb`, the existing `media-download-budget171` layer calls `acquireMediaSlot(signal, weight)` once.

`FPNetwork171.consumeMedia()` does not call `acquireMediaSlot()` itself. It invokes `coordinatorFetch(..., { fpMediaLease174 })`, so the same request passes the same admission layer once and receives the release closure through the lease.

## One effective release

A request may encounter several terminal signals: abort, stream cancel, EOF, body error or outer fetch failure. The per-request release closure is idempotent:

```text
released = false

release()
  if released -> return
  released = true
  releaseMediaSlot(weight)
```

Therefore multiple terminal paths cannot subtract the same weight twice or admit multiple waiters from one freed slot.

For a normal fetch, EOF/cancel/error owns the final release.

For `consumeMedia()`, the body wrapper intentionally does not release on normal EOF while `fpMediaLease174` is present. `consumeMedia()` releases the same lease in its `finally`, after the consumer completes.

## Queue boundary

`mediaWaiters` remains only an admission queue. Its waiter shape contains:

```text
resolve
reject
signal
weight
onAbort
```

It does not contain message payloads, `clientMessageId`, upload IDs, resend state or retry policy. Build 177.8 does not turn it into a send/retry queue.
