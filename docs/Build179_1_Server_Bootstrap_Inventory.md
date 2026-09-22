# Build 179.1 — server bootstrap textual patches and installer inventory

Base: Build 178.28.1 on `build/178-development`.

179.1 is inventory-only. Runtime behavior is unchanged.

## Production entry

`package.json` starts production as `node -r ./src/message-actions-bootstrap.js server.js`.

`message-actions-bootstrap.js` temporarily replaces `Module._extensions['.js']`, intercepts only the resolved production `server.js`, immediately restores the original JS loader, reads `server.js` as text, applies the textual patches below in order, inserts the installer block before the existing cleanup/listen marker, then executes the resulting source through `module._compile(source, filename)`.

This loader interception remains part of the production composition contract until 179.5.

## A. Textual patch inventory

| ID | Order / patch | Dependencies | Guard / admission point | Route / handler | Preserved effect |
| --- | --- | --- | --- | --- | --- |
| T1 | First: after `const db = createDb(DATABASE_PATH);` create `fpUserBlocks165` and `fpBlockedInviteEvents165` | `db`, `createUserBlocks165(db)`, `createBlockedInviteEventStore(db)` | exact `replaceOnce` marker | server initialization | Makes the single block store and blocked-invite event store available before all later patched guards/installers. No WS send by this patch itself. |
| T2a | Participant presence DTO replacement, occurrence 1 of exactly 2 | `fpUserBlocks165.participantPresenceDto`, `safeDeviceId`, `toIsoUtc` | `replaceAllChecked(..., expected=2)` | successful `POST /api/invites/:inviteCode/join` response | Participant list becomes viewer-aware for blocked presence; existing join system-message/unread effects remain outside this replacement. |
| T2b | Participant presence DTO replacement, occurrence 2 of exactly 2 | same as T2a | same exact-count guard | `POST /api/rooms/:publicId/join` response | Same block-aware presence DTO for ordinary room reopen/join. |
| T3 | Replace `broadcastPresenceUpdate()` | `q.findRoomByPublicId`, `q.listParticipantsByRoom`, `fpUserBlocks165.canViewerSeePresence`, `socketsByDevice`, `sendWsJson` | exact one-shot function marker | all existing presence broadcast callers | `presence:update` is sent only to viewers allowed to see subject presence; payload shape stays unchanged. |
| T4 | Add block guard to `handleTextMessage()` | `fpUserBlocks165.roomSendGuard`, `sendMessageRejected` | after participant + room-open checks; before clientMessageId/ciphertext validation and insert | WS inbound `message:send` | Blocked send uses existing rejection transport with `blocked` + guard code and never reaches DB insert. Existing ACK/new-message path remains after guard. |
| T5 | Add same block guard to base `message:new` branch | `fpUserBlocks165.roomSendGuard`, `sendMessageRejected` | after participant + room-open; before ciphertext/media validation | WS inbound `message:new` legacy/media path | Blocked send never reaches pending-media binding or message transaction. |
| T6 | Add block guard to encrypted photo/video upload | `fpUserBlocks165.roomSendGuard` | after participant auth + room-open; before MIME/file checks | `POST /api/rooms/:publicId/media/upload` | Blocked sender receives HTTP 403 `{ok:false,error:'blocked',code}`; existing encrypted upload validation/persistence follows only when allowed. |
| T7 | Add invite guard | `fpUserBlocks165.inviteGuard`, `fpBlockedInviteEvents165.note` | after normalized device/name and deviceId-required; before duplicate/full-room checks and invite-consume transaction | `POST /api/invites/:inviteCode/join` | Creator-blocked joiner: private `blocked_invite_attempt` event is inserted/updated and route returns 403 `INVITE_BLOCKED_BY_CREATOR`. Joiner-blocked creator: 403 `INVITE_CREATOR_BLOCKED_BY_YOU`. Rejected path does not consume invite or insert participant. |
| T8 | Insert complete installer block immediately before the exact cleanup/listen marker | all I1–I10 dependencies | startup marker must exist; compile occurs only after insertion | startup composition | All extension routes/listeners are registered before original `cleanupExpiredSoloRooms()`, cleanup interval and `server.listen()`. |

### Contractual textual order

`T1 → T2 (2 sites) → T3 → T4 → T5 → T6 → T7 → T8 → cleanupExpiredSoloRooms() → cleanup interval → server.listen()`.

T2–T7 refer to stores created by T1, so T1 cannot be removed while any of those textual guards remain.

## B. Installer inventory

| ID | Installer / order | Dependencies passed by bootstrap | Current install guard | HTTP routes | WS / startup effects |
| --- | --- | --- | --- | --- | --- |
| I1 | `installMessageActionsServer` | `app, db, q, socketsByDevice, sendWsJson, sendToRoomParticipants, broadcastUnreadState, toIsoUtc, safeUnlink, isRoomOpen, roomStatePayload` | **No installer-local installed flag**; dependency assertion only | GET message-actions `state`, `mutations`, `latest`; PUT message `edit`; DELETE message | Extends message schema and replaces shared `q` queries. Emits `message:edited`; delete-self emits `message:deleted` to one device; delete-all emits room-wide; unread state rebroadcast. Must precede I2 because pins uses `deleted_for_all` / `message_hidden`. |
| I2 | `installMessagePinsServer` | `app, db, q, socketsByDevice, sendWsJson, sendToRoomParticipants, toIsoUtc, isRoomOpen, roomStatePayload` | **No installer-local installed flag**; dependency assertion only | GET room pins; POST message pin; DELETE message pin by scope; DELETE all pins by scope | Emits `pins:changed`; personal scope only to owner device, shared scope to room. Pins schema/triggers depend on message delete semantics from I1. |
| I3 | `installTypingServer` | `wss, q, sendToRoomParticipants, isRoomOpen, userBlocks: fpUserBlocks165` | `wss.__fpTypingInstalled` | none | Adds one `wss.on('connection')`; consumes `client:state`, `message:send`, `message:new`, `typing:start/stop`, `activity:start/stop`; emits `typing:update`; 7 s timeout; requires open room, active participant, visible active room and passing block guard. |
| I4 | `installUsernameServer` | `app, db` | `app.__fpUsername140Installed` | GET profile username; GET/PATCH privacy; GET username check; GET user by username; PUT username; PATCH display-name; DELETE username | No direct WS effect. Ensures username/identity/privacy schemas; username/display-name writes use DB transactions. |
| I5 | `installSystemEventsServer` | `app, db` | `app.__fpSystemEvents144Installed` | GET system state; GET system events; PATCH system events read | No direct WS effect. Ensures personal system-event schema/store. |
| I6 | `installStorageStats168` | `app, db` | `app.__fpStorageStats168Installed` | GET `/api/storage/media-inventory` | No WS effect. Adds read-support indexes; metadata-only inventory; detects whether `deleted_for_all` exists. |
| I7 | `installUserBlocks165Server` | `app, db, q, socketsByDevice, sendWsJson, toIsoUtc, userBlocks: fpUserBlocks165` | `app.__fpUserBlocks165Installed` | GET block status; GET room-status; POST block; DELETE block | Reuses the T1 store. Starts 1 s unref snapshot watcher; pair changes emit `user-block:changed` to both devices in shared rooms. |
| I8 | `installUserBlockEventActions165` | `app, userBlocks: fpUserBlocks165` | `app.__fpUserBlockEventActions165Installed` | GET `/api/user-blocks/pair-status` | No direct WS effect; reads the same shared T1 relationship store. |
| I9 | `installChatRequestsServer` | `app, db, q, isRoomOpen, removeRoomCascade` | `app.__fpChatRequests147Installed` plus explicit required-`q` checks | GET status, blocks, mine; DELETE block; POST create, claim, complete, reject, block | No direct WS effect. Starts 30 s unref reconciliation interval and may call `removeRoomCascade` for abandoned pending rooms. |
| I10 | `installVoiceServer` | `app, db, q, upload, UPLOAD_DIR, fs, path, randomToken, safeUnlink, isRoomOpen, userBlocks: fpUserBlocks165` | `app.__fpVoiceInstalled` | GET voice-meta; POST encrypted voice upload with `upload.single('encryptedFile')` | No direct WS effect. Ensures `voice_meta`; upload checks participant, open room, block guard, encrypted payload/mime/duration/size, persists pending audio/media and optional opaque metadata, with failure cleanup. |

## C. Guard / order facts required for 179.2–179.5

1. Bootstrap restores the original JS loader before compiling patched `server.js`; non-target JS files always use the original loader.
2. Every textual replacement is checked. Participant presence specifically requires exactly two base markers.
3. I1 and I2 currently have **no installer-local idempotency guard**. Their single-install safety is the current one-shot production composition. Explicit composition must not call them while T8 still injects them.
4. I3–I10 have the installed flags listed above, but those flags do not justify running both old and new startup paths during migration.
5. Express middleware/route registration order is part of the contract: T8 installs immediately before existing cleanup/listen; duplicate route registration is prohibited.
6. I3 adds another `wss.on('connection')` listener beside the base server listener. It must remain exactly once.
7. T1 + T7 are a minimal dependency/guard pair for blocked invite-attempt recording.
8. T1 + T4/T5/T6/I3/I7/I8/I10 share the same `fpUserBlocks165` instance; no second block store should be introduced.

## Regression

`npm run test:179:bootstrap-inventory` freezes the production preload entry, target-only loader interception/restoration, textual patch order/count, T8 install order, current installer guards (including deliberate absence on I1/I2), route counts, and the WS-effect signatures used by this inventory.

No runtime source file changes in 179.1.
