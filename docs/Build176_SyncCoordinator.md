# Build 176.17 — current SyncCoordinator baseline

This note records the existing `syncAllRoomsAfterReconnect` behavior before any SyncCoordinator adapter is added.
It is descriptive only: no sync ordering, polling, retry, room selection, payload handling, or request algorithm changes are introduced here.

## Existing triggers

### 1. Stable WebSocket open

`connectStableWs(...)` installs the current socket. Its current-socket `onopen` handler finishes the connect promise and then calls:

```text
ws.onopen
  -> syncAllRoomsAfterReconnect(safeDeviceId)
```

This is a direct post-connect sync trigger.

### 2. Reconciliation after session/resume/online work

`reconcileKnownChats(deviceId)` first runs unread refresh and ensures the stable WebSocket. If the WebSocket is ready it flushes pending reads for the active room and then awaits:

```text
reconcileKnownChats(deviceId)
  -> syncAllRoomsAfterReconnect(deviceId)
```

`reconcileKnownChats` is reached from the existing session paths:

```text
startAppSessionSync()
  -> reconcileKnownChats(deviceId)

setView('chats')
  -> startAppSessionSync()

handleAppResume()
  -> startAppSessionSync()

Lifecycle foreground / focus / online / pageshow
  -> handleAppResume()
  -> startAppSessionSync()
  -> reconcileKnownChats(deviceId)
```

The app sync watchdog also calls `reconcileKnownChats(deviceId)` when the expected stable WebSocket is absent, not OPEN, or belongs to a different device.

## Existing deduplication

The single current dedupe resource is:

```js
let stableWsSyncPromise = null;
```

At entry:

```js
if (stableWsSyncPromise) return stableWsSyncPromise;
```

Therefore every overlapping reason shares one global in-flight sync operation.

This in-flight operation is not keyed by room, device, lifecycle reason, or RoomContext generation.
Because `syncAllRoomsAfterReconnect` is itself an `async function`, two callers do not receive the same outer Promise object by identity; each caller receives an async wrapper that adopts the same internal `stableWsSyncPromise`.
While the internal operation is active:
- a second WebSocket-open reason joins the existing work;
- a resume/online reconciliation joins the existing work;
- a watchdog reconciliation joins the existing work;
- the later trigger does not start a second room-request set.

The Promise is cleared only in `.finally(...)`, so a later trigger can start a new sync after the current run settles, including after failure.

## Room set for one run

A run snapshots one de-duplicated room list at its start from:

```text
state.chats roomIds
+
getLocalRoomDevicePairs() roomIds
+
state.roomId
```

A JavaScript `Set` removes duplicate room IDs.

A trigger that arrives while `stableWsSyncPromise` is active does not rebuild this room snapshot and does not queue a second pass by itself.

## Device selection

The `deviceId` argument passed to `syncAllRoomsAfterReconnect(deviceId)` is a fallback device captured by the run that actually starts.

For each room the existing code prefers:

```text
STORAGE.get(STORAGE.roomState(roomId))?.deviceId
```

and uses that run's trigger `deviceId` only when the stored room-specific device ID is unavailable.

`getLocalRoomDevicePairs()` contributes room IDs to the room set, but its pair device ID is not directly passed into `syncRoomAfterReconnect` by `syncAllRoomsAfterReconnect`; device selection is re-read from `STORAGE`.

If another trigger with a different fallback device arrives while the first run is active, it joins the existing internal operation and its fallback device does not replace the first run's fallback.

Therefore the current sync is a global room batch, but individual room requests normally use stored room-specific participant device IDs.

## Per-room work

For every snapshotted room, the existing worker is:

```text
syncRoomAfterReconnect(roomId, roomDeviceId)
```

All rooms in the batch are started through one `Promise.all(...)`.

Per-room failures are caught and converted to `false`.
The overall run resolves `true` only when every room result is truthy.

A `ROOM_NOT_FOUND` path removes the stale room and is treated by the current worker as a handled result.

## Generation / stale-result boundary

`syncAllRoomsAfterReconnect` itself does not capture or compare `FPRoomContext170` navigation generation.

Its primary identity is the explicit `roomId`, plus the selected device ID for that room.

Existing narrower stale-result protections remain separate:
- API unread fetches created with `trackUnread:true` receive a per-room unread sync sequence;
- `applyRemoteUnreadState(...)` accepts API unread state only when that per-room sync sequence and unread-event sequence are still current;
- active-chat DOM application inside `processStableIncomingMessage(...)` checks the current room view before modifying the mounted message view.

Those mechanisms are not the `stableWsSyncPromise` dedupe and must not be conflated with it.

## Current ownership boundary before 176.18

```text
Trigger reasons:
app.js / lifecycle / ConnectionManager socket-open callback

Dedupe state:
app.js -> stableWsSyncPromise

Batch worker:
app.js -> syncAllRoomsAfterReconnect()

Per-room worker:
app.js -> syncRoomAfterReconnect()

Network:
existing fetchRoomMessagesPage()

Connection:
FPConnection170 / existing stable WebSocket worker
```

No `FPSyncCoordinator176` owner exists yet.

176.18 may wrap exactly one existing post-reconnect sync entry, but it must call this same worker and preserve the same single internal `stableWsSyncPromise` operation. It must not require outer Promise identity and must not create a second request batch, polling loop, queue, or replacement reconciliation algorithm.
