# Build 188.7 — Adaptive Reaction Admission

## Scope

Build 188.7 continues:

`build/188-reactions-development`

Base: Build 188.6.

This step hardens the reaction mutation path for future large groups without changing message/history/render ownership.

The accepted requirements are:

- one reaction mutation FIFO lane per `roomId + messageId`;
- server decides mutation order/conflicts;
- room pressure must scale with the number of participants who are actually online;
- registered/offline group members must not inflate the reaction budget;
- normal room bursts wait in a bounded RAM queue instead of being dropped;
- overload is rejected only at explicit caps;
- no automatic client retry/offline persistence is introduced.

## Existing owner

No second server arbiter was added.

The existing:

`FPReactionMutationArbiter188`

now owns both:

1. per-message FIFO ordering;
2. room-wide adaptive mutation admission.

This keeps one authoritative server owner for reaction ordering/admission.

`FPMessageReactions188` remains the reaction business/store owner.

## Online participant source

The room budget is calculated only from participants who are actually online through live visible WebSocket state.

Server composition passes:

`countOnlineRoomParticipants188(roomId)`

to the reaction arbiter.

The counter:

1. reads active participants of that room;
2. checks each participant with the existing live socket visibility owner;
3. counts a participant once if at least one visible socket exists.

Multiple tabs/sockets for the same device do not increase the number.

The current FPChat identity rule remains:

`1 device = 1 participant/user`

Presence privacy does not reduce this internal admission count. A user may hide online status from other people, while the server can still use raw live connection state for resource protection.

## Adaptive room budget

Window:

**5 seconds**

Budget formula:

`budget = clamp(onlineParticipants × 1, 40, 250)`

Examples:

| Online participants | Mutations admitted per 5 s |
|---:|---:|
| 0–40 | 40 |
| 50 | 50 |
| 100 | 100 |
| 250 | 250 |
| 500 | 250 |

The lower floor prevents tiny rooms from feeling artificially throttled.

The upper cap prevents a very large group from scaling reaction write/broadcast pressure without bound.

The online count is sampled when a room admission window is created/refreshed, not for every individual mutation. Therefore large-room admission does not add one full participant scan to every reaction click.

## Room overflow queue

When the current 5-second execution budget is exhausted, accepted operations are not immediately rejected.

They wait in the arbiter's bounded RAM admission queue until the next room window.

Queue capacity:

`queueCapacity = currentRoomBudget`

Therefore:

`maxPending = currentRoomBudget + queueCapacity`

Examples:

| Budget | Executing/admitted window | Extra queued | Max pending |
|---:|---:|---:|---:|
| 40 | 40 | 40 | 80 |
| 100 | 100 | 100 | 200 |
| 250 | 250 | 250 | 500 |

This allows one additional room window of burst absorption while keeping memory bounded.

Only when `maxPending` is already full does the server return:

`503 REACTION_BUSY`

with:

- `retryAfterMs`;
- HTTP `Retry-After`.

The client does not automatically retry. The existing optimistic reaction is rolled back by the 188.4 mutation path.

## Per-user burst guard

Room scaling must not allow one participant to consume the entire room budget.

Each participant therefore has a separate ingress guard:

**20 accepted reaction mutations / 5 seconds / room**

The key is the authenticated room `participant_id`, not user-supplied text/device fields.

If exceeded:

`429 REACTION_RATE_LIMITED`

with `retryAfterMs` and `Retry-After`.

This guard applies across different messages, so spam cannot bypass it by alternating message IDs.

There is still no automatic resend.

## Ordering

Accepted mutations continue to use one lane per:

`roomId + messageId`

For the same message:

`A1 → A2 → A3`

always executes in that order.

Different messages may have independent lanes, but every lane must obtain a room admission permit before its mutation task starts.

Therefore:

- per-message ordering is preserved;
- room-wide throughput is bounded;
- one busy message does not create a second SQLite owner;
- no client mutation determines authoritative ordering.

## Queue lifecycle

Admission state is RAM-only.

It is never stored in:

- SQLite as a queue;
- localStorage;
- IndexedDB;
- media cache.

The room admission state stays alive for the active 5-second window so a fast sequence of individually completed requests cannot reset the per-user guard/budget.

After the room is idle for one full admission window, the arbiter releases that room state.

Wake/idle timers are `unref()`'d and do not keep the Node process alive.

No polling interval is introduced.

## Cancellation

Existing deletion semantics remain.

### Delete for all

`deleteForAll(roomId, messageId)`

still calls:

`FPReactionMutationArbiter188.cancelMessage(...)`

Not-yet-started reaction mutations for that message are cancelled.

If an entry is waiting for a room admission slot, cancellation removes/rejects that waiter instead of allowing it to execute later.

The reaction rows/state are then deleted by the existing reaction store owner.

### Delete room

`cancelRoom(...)` clears queued reaction work for all message lanes in that room.

## Mutable authorization re-check

Admission is not authorization.

After a queued operation finally receives a room permit, the existing task still re-checks:

- room remains open;
- participant still has access;
- ADD is still allowed by the user-block guard;
- message is still mutable/valid.

A mutation cannot use time spent in the admission queue to bypass a later room close, revoke or block.

## HTTP response contract

Two resource-protection responses are added:

### User burst

`429 REACTION_RATE_LIMITED`

### Room saturation

`503 REACTION_BUSY`

Both may include:

`retryAfterMs`

and HTTP:

`Retry-After`

No success response shape is changed.

## Performance intent

For a room with 500 online participants:

- mutation execution is capped at 250 operations per 5 seconds;
- at most another 250 are held pending;
- further ingress gets a deterministic 503 rather than unbounded RAM growth.

For a two-person current FPChat room:

- minimum budget remains 40/5 s;
- normal reaction use will never approach the guard.

This protects the future group path while making the current private 1:1 behavior effectively unchanged.

## Stable Build 187 / previous 188 preservation

Build 188.7 does not modify:

- `FPGesture135`;
- `FPLayer173`;
- `FPNetwork171`;
- `FPMessageStore172`;
- `FPConnection170`;
- `FPRoomContext170`;
- message render/history owners;
- reaction picker/details UI;
- reaction catalog semantics;
- maximum 3 reactions per participant/message;
- client per-message FIFO cap of 20;
- no-retry/offline behavior.

Server changes are restricted to:

- existing reaction mutation arbiter;
- reaction route admission metadata;
- one live-online-count adapter in server composition.

## Regression

`npm run test:188.7`

runs all Build 188.1–188.6 regressions plus the adaptive admission regression.

The 188.7 test verifies:

- 5-second admission window;
- 20/user/5 s burst limit;
- adaptive budget floor/coefficient/cap;
- 2 online → budget 40;
- 100 online → budget 100;
- 500 online → budget 250;
- 41st normal mutation waits rather than being rejected in a budget-40 room;
- waiting mutation is released next window;
- budget-40 room max pending = 80;
- next request receives `503 REACTION_BUSY`;
- user request 21 receives `429 REACTION_RATE_LIMITED`;
- user budget recovers after the window;
- same-message FIFO remains intact;
- room budget uses live visible WebSocket state;
- no persistent reaction queue or polling is introduced.
