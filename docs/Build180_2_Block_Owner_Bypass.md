# Build 180.2 — remove one block-state bypass

180.1 found one live production bypass of the common block-state owner: `src/blocked-invite-events165.js` prepared its own `SELECT ... FROM chat_request_blocks` and independently decided whether the room creator still blocked the joining device.

## Change

`server.js` now constructs the blocked-invite event store with the already-existing canonical owner:

`createBlockedInviteEventStore(db, { userBlocks: fpUserBlocks165 })`

The store no longer prepares or executes its own `chat_request_blocks` query. Its validation is now:

`userBlocks.relationship(creator.device_id, blockedDeviceId).blockedByMe`

This preserves the exact directed meaning `creator -> joiner`, the existing `BLOCKED_INVITE_EVENT_BLOCK_MISSING` result, and the existing `block.public_id` written into the private system-event payload.

## Authority

The source of truth has not moved. `fpUserBlocks165.relationship()` still reads the same server-side SQLite `chat_request_blocks` prepared statement on demand.

No block snapshot is copied into the event store. No browser/client state is accepted as permission input. `public/user-blocks165.js` remains presentation/cache/recovery logic only.

## Unchanged

- block/unblock mutations;
- `roomSendGuard`;
- invite admission guard;
- blocked-invite dedupe and `attemptCount` transaction;
- 1-second server block snapshot watcher;
- `user-block:changed` WS notification;
- 10-second visible-client room-status refresh.

Replacing snapshot polling with transaction-driven events remains deferred optimization.

## Acceptance

`npm run test:180:block-owner-bypass`

The regression proves that the blocked-invite module no longer mentions `chat_request_blocks` or owns `blockPair`, while the canonical `fpUserBlocks165` SQL owner and existing notification mechanisms remain intact.
