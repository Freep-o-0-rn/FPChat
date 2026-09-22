# Build 178.13 — pending-read flush ownership

Base: Build 178.12 on build/178-development.

Scope is only the existing pending-read flush command. Queue creation, read admission and server status handling are not moved.

## Minimal transfer

The old flushPendingReads body is preserved as flushPendingReadsWorker178().

FPReadState178 now exposes:

flushPending: flushPendingReadsWorker178.

The old global function remains as a compatibility entry:

flushPendingReads(roomId, deviceId) → FPReadState178.flushPending(roomId, deviceId).

If the facade is unexpectedly unavailable during fallback startup, the compatibility function directly calls the same worker rather than creating any queue or alternate transport.

## Queue remains unchanged

There is still exactly one pendingReadQueue Map.

Each room entry remains:

{ deviceId, ids: Set, sentAt, retryTimer }.

queueReadIds() still deduplicates IDs in the same Set. No ReadStateManager-local queue is added.

## Flush behavior preserved

The worker keeps the existing:

- OPEN WebSocket requirement;
- deviceId match;
- 1000 ms duplicate-send throttle;
- numeric positive ID filtering;
- one message:read:bulk payload containing the whole current Set;
- sentAt update;
- 1500 ms retry timer;
- failure behavior that clears sentAt/timer but retains pending IDs.

The retry timer deliberately calls the public flushPendingReads() compatibility command, which now re-enters FPReadState178.flushPending().

markIncomingMessagesRead(), reconnect retry and acknowledgeRead() also retain their existing calls to flushPendingReads(), so all normal flush triggers converge on the same owner entry.

Regression: npm run test:178:read-flush-owner
