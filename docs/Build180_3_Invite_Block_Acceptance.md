# Build 180.3 — invite block and system-event counter acceptance

180.3 changes no production runtime. It adds a dedicated integration acceptance for invite blocking and duplicate prevention.

## Test topology

The test starts the real `server.js` on a random localhost port with a temporary SQLite database and temporary upload directory. It creates a room/invite through `POST /api/rooms`, inserts one canonical `chat_request_blocks` row in that temporary database, and then exercises the real `POST /api/invites/:inviteCode/join` route.

No production/user database or files are used.

## Blocked join — first attempt

Expected:

- HTTP 403 with `INVITE_BLOCKED_BY_CREATOR`;
- invite `used_at` remains NULL;
- invite `used_by_device_id` remains NULL;
- invite `room_secret` remains present;
- only the creator remains an active participant;
- no participant row for the blocked joiner;
- no `participant_joined` room message;
- exactly one private `system_events` row of type `blocked_invite_attempt` for the creator;
- payload `attemptCount === 1`, correct joiner, room and block id.

## Blocked join — repeated attempt

Expected:

- same HTTP 403;
- invite still unconsumed and reusable;
- no access/participant granted;
- same system-event row id and dedupe key;
- still exactly one private event row;
- `attemptCount` becomes 2;
- event is unread again/currently unread.

## Normal join after removing the test block

Expected:

- HTTP 200;
- invite is consumed exactly once;
- `used_by_device_id` is the joiner;
- server-held invite secret is cleared;
- exactly one joiner participant exists;
- exactly one `participant_joined` room system message exists.

## Repeated normal join with the same invite

Expected:

- HTTP 410 `invite expired or used`;
- participant count does not change;
- the joiner participant row remains unique;
- `participant_joined` does not duplicate;
- prior blocked-attempt system event remains one row with `attemptCount === 2`.

## Ordering contract

The static regression also freezes:

`inviteGuard → duplicate/full-room checks → transaction → consumeInvite → upsertParticipant → participant_joined event`.

Therefore a blocked join is rejected before invite consumption and before access writes.

## Acceptance

- `npm run test:180:invite-block-static` — fast static guard/order check;
- `npm run test:180:invite-block-integration` — real server + temporary SQLite;
- `npm run test:180:1803` — both plus the accumulated 180.1/180.2 block contract.
