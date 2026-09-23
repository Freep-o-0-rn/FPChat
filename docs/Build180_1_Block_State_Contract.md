# Build 180.1 — block-state owner and active guard/notification contract

Build 180.1 is audit-only. No runtime, schema, polling or notification behavior is changed.

## Canonical owner

The canonical block truth is the server-side SQLite table `chat_request_blocks`, exposed through the single runtime object created in `server.js`:

`const fpUserBlocks165 = require('./src/user-blocks165').createUserBlocks165(db);`

`createUserBlocks165(db)` owns the prepared statements and decisions for:

- directed block lookup `blocker -> blocked`;
- `relationship(a,b)`;
- `roomSendGuard(roomId,senderId)`;
- presence visibility;
- room status;
- block/unblock mutations;
- invite admission.

The client is **not** an authority for permission. `public/user-blocks165.js` caches `/api/user-blocks/room-status` only for presentation/prevention UX. Server guards still decide whether text/media/voice/typing/invite operations are accepted.

## Block / unblock

`block(blockerId, blockedId)` reads `chat_request_blocks` first and uses `INSERT OR IGNORE` only when the directed pair does not already exist. Repeating the same block therefore returns the existing row instead of creating another logical block.

`unblock(blockId, blockerId)` may delete only a block whose `public_id` belongs to that blocker. Successful unblock also records the existing pair reset using `chat_request_pair_resets`.

HTTP surfaces:

- `POST /api/user-blocks` — block by room peer or username;
- `DELETE /api/user-blocks/:blockId` — unblock owned block;
- `GET /api/user-blocks/status` — profile block status;
- `GET /api/user-blocks/room-status` — room relationship/presence/send presentation;
- `GET /api/user-blocks/pair-status` — system-chat action status.

Client block/unblock actions refresh the server-derived room status and dispatch local `fpchat:block-list-changed` only as a UI refresh signal.

## Relationship / send semantics

`relationship(viewer, peer)` is directional:

- `blockedByMe` = row `(viewer -> peer)`;
- `blockedByPeer` = row `(peer -> viewer)`;
- `communicationBlocked` = either row exists.

`roomSendGuard` preserves the current rejection codes:

- own directed block -> `USER_BLOCKED_BY_YOU` and own `blockId`;
- peer directed block -> `USER_BLOCKED_BY_PEER`;
- no active peer -> allowed;
- invalid sender -> `ACCESS_REVOKED`.

The same server block truth currently protects:

### Text

`handleTextMessage` calls `fpUserBlocks165.roomSendGuard(room.id, ws.deviceId)` before persistence and returns the existing rejected message ACK with the block code.

### Legacy/media message commit

The `message:new` WS path calls the same `roomSendGuard` before message/media association is committed.

### Encrypted image/video upload

`POST /api/rooms/:publicId/media/upload` checks the same `roomSendGuard` before the encrypted pending media persistence path.

### Voice upload

`POST /api/rooms/:publicId/voice/upload` checks `userBlocks.roomSendGuard` and returns HTTP 403 `blocked` with the same block code.

### Typing / media / voice activity

`typing-server.js` uses `userBlocks.roomSendGuard` before creating activity state or emitting `typing:update`. When communication is blocked, activity is not started/broadcast.

## Presence semantics

Presence is intentionally not a symmetric presentation rule.

`canViewerSeePresence(viewer, subject)` hides the subject only when the **subject has blocked the viewer** (`subject -> viewer`). Therefore:

- if peer blocked viewer: peer online/lastSeen are hidden;
- if viewer blocked peer: the room is communication-blocked and the client hides the composer, but `canViewerSeePresence` itself does not hide peer presence solely because of viewer's own block.

`participantPresenceDto` applies this rule to room participant payloads. `broadcastPresenceUpdate` applies it per recipient before sending `presence:update`.

Client `/room-status` presentation converts hidden presence to offline/null and shows `Статус недоступен` when applicable.

## Invite semantics

`inviteGuard(roomId, joinerId)` reads the same `chat_request_blocks` truth and preserves two distinct directions:

- creator blocked joiner -> `INVITE_BLOCKED_BY_CREATOR`;
- joiner blocked creator -> `INVITE_CREATOR_BLOCKED_BY_YOU`.

The production join route checks this guard before participant creation and invite consumption. The blocked-by-creator branch records a private blocked-invite system event through `fpBlockedInviteEvents165` and returns HTTP 403. Exact invite-consumption/counter acceptance belongs to Build 180.3.

## Blocked-invite system chat

The current production blocked-invite notification owner is `src/blocked-invite-events165.js`, writing the private `system_events` table.

For one creator + blocked joiner + room it uses a stable dedupe key and stores/increments `attemptCount` inside `transaction.immediate()`. The personal system chat renders `blocked_invite_attempt`, displays the attempt count, and checks `/api/user-blocks/pair-status` before offering unblock.

`createUserBlocks165` still exposes the older `noteBlockedInviteAttempt(...)` room-message helper, but the current production invite route does not call it; current blocked invite attempts use `fpBlockedInviteEvents165.note(...)`.

## Server block-change notification

`installUserBlocks165Server` currently keeps a snapshot of **all** block rows:

`allBlocks -> Map(public_id -> row)`

Every 1000 ms it reads a new snapshot, detects added/removed block ids and calls `notifyPair(blocker, blocked)`.

`notifyPair` finds shared rooms and sends:

`{ type: 'user-block:changed', roomId }`

to every currently registered socket of both devices.

This watcher is part of the accepted current contract. Build 180.1 does not replace it with transaction events.

## Client notification / recovery behavior

`public/user-blocks165.js` wraps the stable WS payload handler. On `user-block:changed` it calls `refreshRoomStatus(roomId, true)` and returns without treating the event as normal message traffic.

The client also refreshes active room block status every 10 seconds while visible. This is a synchronization fallback/presentation refresh, not permission authority.

Client submit/attachment/voice click interception prevents obvious blocked actions for UX, but these checks are not trusted for access control; server guards listed above remain mandatory.

## Deferred optimization

Replacing the 1-second server snapshot watcher with transaction-driven events is explicitly **not** part of Build 180.1/180.2 by default. Such a change first needs proof that:

- every mutation path emits after successful DB commit;
- rolled-back mutations emit nothing;
- retries/idempotent block calls do not duplicate effects;
- missed events recover through existing synchronization.

Until then, removing the watcher would change the block notification contract.

## Acceptance

`npm run test:180:block-contract`

The regression freezes the owner, directed semantics, every active server guard, WS watcher, client refresh behavior and blocked-invite system-chat path without modifying runtime.
