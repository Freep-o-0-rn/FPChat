# Build 177.6 — ResourceArbiter contract for existing media slots

Build 177.6 does not create a new resource manager or change concurrency limits. The contract is the media-download admission state already implemented inside `FPNetwork171`.

## Owner and state

```text
Owner: FPNetwork171
Admission queue: mediaWaiters[]
Reserved weighted capacity: reservedMediaSlots
Budget: stats.mediaBudget.limit = 4
```

This queue is an admission queue for media resource usage. It is not a message-send queue, retry queue or persistent work queue.

## Admission weights

| Resource | Existing weight | Effective concurrency |
|---|---:|---:|
| encrypted original `/api/media/:id/blob` | 4 | 1 |
| thumbnail `/api/media/:id/thumb` | 1 | 4 |

The total weighted budget remains 4. An original therefore excludes other media downloads while it owns its lease. Four thumbnails may run concurrently.

The current queue is FIFO: callers append to `mediaWaiters`, and `drainMediaSlots()` considers the head waiter against the remaining weighted capacity.

## Acquire

For same-origin GET requests matching `/api/media/:id/blob` or `/api/media/:id/thumb`:

```text
request
  -> media-download-budget171
  -> acquireMediaSlot(signal, weight)
  -> existing FPNetwork171 fetch layers
  -> native fetch
```

Admission is separate from download/decrypt execution. The slot is acquired before the downstream fetch starts.

A request aborted while still queued is removed from `mediaWaiters`, increments the existing cancellation statistic, rejects with `AbortError`, and never reserves capacity.

## Release

There are two existing release contracts.

### Normal fetch consumer

Without a lease, the slot is released when the wrapped response body completes, is cancelled, errors, or the request fails.

### `FPNetwork171.consumeMedia()`

`consumeMedia()` installs the existing `fpMediaLease174`. With this lease, end-of-stream alone does not release the slot. The lease is released in `consumeMedia()`'s `finally` after the supplied consumer callback completes.

For the current `readEncryptedMedia174()` path this means:

```text
acquire
  -> fetch encrypted body
  -> consume response body
  -> decrypt encrypted blob
  -> consumer returns
  -> release
```

This preserves the existing resource policy: one large original remains admitted through download and decrypt rather than releasing capacity immediately after network EOF.

## Existing byte guards

The slot owner also keeps the existing body limits unchanged:

- original: `100 * 1024 * 1024 + 64` encrypted bytes;
- thumbnail: `4 * 1024 * 1024` bytes.

Build 177.6 changes neither these limits nor the slot budget.

## Boundary for 177.7

Direct media consumers that use ordinary `fetch()` still pass through the slot layer because `FPNetwork171` owns `window.fetch`, but some consumers do not use `consumeMedia()` and therefore release at body completion rather than after higher-level consumption/decrypt.

Build 177.6 only documents and verifies the existing contract. Moving one confirmed consumer to the intended lease semantics, if required, belongs to Build 177.7.
