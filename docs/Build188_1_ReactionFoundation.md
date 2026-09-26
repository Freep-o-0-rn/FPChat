# Build 188.1 — Reaction Foundation

## Scope

Build 188.1 starts the reactions line on a separate branch:

`build/188-reactions-development`

Base: Build 187.1.

This step introduces the reaction domain and ownership boundaries only. Telegram-style pills, quick strip, full picker, long-press Reaction Details and lazy-history rendering are intentionally deferred to later Build 188 steps.

## Owners

### Client

- `FPReactionManager188`
  - canonical client owner of reaction summary state;
  - owns `reactionRevision`, aggregate summary and current participant reactions;
  - RAM only;
  - no persistent cache;
  - no offline queue;
  - no DOM, gesture, transport or scroll ownership.

- `FPReactionArbiter188`
  - one FIFO lane per `roomId + messageId`;
  - maximum 20 in-flight + queued operations per message;
  - no coalescing;
  - no retries;
  - no persistence;
  - different messages may progress independently.

The client owners are loaded only after `fpchat:boot-ready` in 188.1 so the foundation does not extend the critical startup path.

### Existing global owners remain unchanged

- `FPGesture135` remains the single gesture arbiter.
- `FPLayer173` remains the single layer arbiter.
- `FPNetwork171` remains the transport owner.
- `FPMessageStore172` remains the canonical message-content store.
- `FPHistory174` remains the only owner of the bounded/lazy message window.

Build 188.1 does not patch any of those mechanisms.

### Server

- `FPReactionMutationArbiter188`
  - serializes reaction mutations per `roomId + messageId`;
  - owns ordering only;
  - does not own HTTP, WebSocket or SQLite business logic;
  - empty lanes are removed.

- `FPMessageReactions188`
  - owns reaction persistence, revision and mutation rules;
  - exposes explicit ADD/REMOVE HTTP mutations;
  - emits viewer-neutral `reaction:update` after real changes only.

Room-wide admission/rate budgeting for large future groups is deliberately deferred to the later concurrency step of Build 188.

## Catalog

Single source of truth:

`public/reactions-catalog188.json`

The same versioned catalog is consumed by server validation and exposed to the client through:

`GET /api/reactions/catalog`

Build 188.1 catalog rules:

- stable `reaction_id`;
- type/value live in the catalog, not duplicated in the reaction table;
- disabled entries can remain in the catalog for historical rendering;
- quick strip is defined by `quickOrder`;
- current quick set: 😂 ❤️ 👍 👎 🔥 🥰 👏;
- current catalog version: 1;
- max reactions per participant/message: 3.

## SQLite

### `message_reactions`

Stores only active reaction ownership:

- `room_id`
- `message_id`
- `participant_id`
- `reaction_id`
- `created_at`

Uniqueness:

`message_id + participant_id + reaction_id`

### `message_reaction_state`

Stores:

- `room_id`
- `message_id`
- `revision`

The revision increments only when the canonical state actually changes.

No-op ADD/REMOVE does not increment revision and does not emit WebSocket updates.

## Three-reaction FIFO rule

One participant may keep at most three different reactions on one message.

Example:

`❤️ 😂 🔥 + 👍 -> 😂 🔥 👍`

The fourth new reaction removes the oldest active reaction and inserts the new reaction inside one SQLite transaction.

The replacement is one user mutation and therefore increments `reactionRevision` once.

ADD and REMOVE are explicit operations. There is no server-side TOGGLE command.

## Mutation API

ADD:

`PUT /api/rooms/:publicId/messages/:messageId/reactions/:reactionId`

REMOVE:

`DELETE /api/rooms/:publicId/messages/:messageId/reactions/:reactionId`

The request identifies the current device. The server resolves it to the existing room participant and stores `participant_id` in the reaction row.

The authoritative mutation response contains:

- `reactionRevision`;
- sorted aggregate reaction summary;
- viewer-specific `mine`;
- `myReactions`;
- catalog version.

A client `mutationId` may be echoed as a correlation identifier, but no ever-growing mutation-dedupe table is created. Explicit ADD/REMOVE are idempotent by state.

## Ordering and compact summary

Reaction groups are sorted by:

1. count descending;
2. first reaction row ascending;
3. reaction ID ascending.

Preview participants:

- count 1: one participant ID;
- count 2: two participant IDs, newest first;
- count >= 3: no profile preview in the summary.

This supports the agreed compact Telegram-like presentation without loading large reactor lists.

## Permissions

Reactions are allowed on normal user messages, including text/media/voice/reply/edited content.

They are not allowed on:

- system/service messages;
- deleted-for-all messages;
- messages hidden for the current device through direct new API calls.

ADD uses the existing block/send authority and cannot bypass a communication block.

REMOVE is less restrictive than ADD, but still requires an active participant with room access.

No reaction mutation is persisted for later automatic delivery.

## Delete semantics

### Delete for all

Message deletion has priority.

Inside the existing message delete transaction:

- pending server reaction lane entries are cancelled;
- `message_reactions` rows are deleted;
- `message_reaction_state` is deleted.

The message cannot be resurrected through a late reaction mutation because every mutation rechecks that the message still exists and is not deleted-for-all.

### Delete for self

The server reaction rows are not deleted.

The message is hidden only for that participant; other participants retain the message and its reactions.

Client-side queued reaction cancellation for delete-self will be wired with the reaction UI/client action integration in later Build 188 steps.

### Room deletion

Reaction rows/state and pending lanes are cleared before the room rows are removed.

## WebSocket contract

A real state change emits one viewer-neutral event:

`reaction:update`

It contains:

- room/message identity;
- `reactionRevision`;
- aggregate reactions;
- catalog version;
- `changedParticipantId`;
- that participant's current reaction IDs.

There is no viewer-specific `mine` field in the broadcast payload. Later client integration derives ownership using the existing participant identity.

No-op mutations emit no WS event.

## Memory and startup

Build 188.1 introduces no persistent reaction cache and does not touch the media cache.

`FPReactionManager188` already exposes lifecycle primitives for:

- release message state;
- sync to a future history range;
- temporary holds;
- destroy message;
- release room.

Actual `FPHistory174` integration is intentionally not performed in 188.1.

The reaction client foundation loads after boot-ready to avoid extending the startup critical path.

## Explicitly deferred

Not part of Build 188.1:

- reaction pills under messages;
- message-context quick reaction strip;
- full reaction picker;
- reaction tap/long-press/right-click interaction;
- `FPGesture135` integration;
- Reaction Details and profile opening;
- Details pagination by 30;
- bulk reaction summary in lazy-history pages;
- bounded reaction RAM cache synchronized to `FPHistory174`;
- room-wide reaction admission budget based on online participants;
- server spam/rate guards;
- group UI.

These remain separate steps so the working lazy-history, gestures and rendering paths are not changed prematurely.

## Regression

`npm run test:188:foundation`

checks:

- catalog uniqueness and the seven quick reactions;
- client/server syntax;
- client queue limit = 20;
- no reaction localStorage/IndexedDB persistence;
- reaction server composition;
- delete-for-all and room-delete hooks;
- SQLite 3-reaction FIFO;
- no-op revision behavior;
- system/deleted message rejection;
- participant preview order;
- per-message server FIFO lane cleanup.

Physical UI acceptance is not applicable yet because Build 188.1 intentionally exposes no reaction UI.
