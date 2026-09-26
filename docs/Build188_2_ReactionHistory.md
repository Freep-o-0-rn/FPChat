# Build 188.2 — Reaction History & Bounded RAM

## Scope

Build 188.2 continues the same reactions branch:

`build/188-reactions-development`

Base: Build 188.1.

This step wires reaction state into the existing bounded/lazy history lifecycle without adding reaction UI yet.

## Main contract

Reaction state follows the currently mounted message window.

The existing history owner remains unchanged:

`FPHistory174`

Reaction state owner:

`FPReactionManager188`

The relationship is:

`FPHistory174 mounted numeric message IDs -> FPReactionManager188 bounded RAM window`

ReactionManager does not become a second history owner and does not control scroll, message mounting or history paging.

## Server history integration

History responses can now include one top-level array:

`reactionSummaries`

A summary contains only messages from the current page that have reaction state.

Each summary contains:

- `messageId`;
- `reactionRevision`;
- aggregate reaction groups;
- viewer-specific `mine`;
- viewer-specific `myReactions`;
- catalog version.

Reaction data is not loaded with N+1 message queries.

One bulk SQLite statement aggregates all requested message IDs for the page.

### Performance boundary

Normal application sync/unread reads do not automatically execute reaction aggregation.

`GET /api/rooms/:publicId/messages`

only adds reaction summaries when:

`reactions=1`

`FPHistory174` sets that flag on its own lazy-history requests.

Initial room join responses also include reaction summaries because those messages are the initial mounted history window.

This avoids adding reaction SQL work to:

- unread watchdog reads;
- one-message unread refreshes;
- ordinary background chat-list synchronization.

## Bulk summary query

The bulk query uses one requested-ID set and SQL window aggregation.

It computes:

- count by message + reaction;
- stable first active appearance;
- viewer `mine`;
- viewer reaction timestamp;
- newest two participant IDs for counts 1–2.

For count >= 3 participant preview IDs are not returned.

The output remains sorted by the previously accepted rule:

1. count DESC;
2. first active appearance ASC;
3. reaction ID ASC.

## Bounded RAM lifecycle

`FPReactionManager188` now tracks the current numeric message IDs mounted by `FPHistory174`.

When history evicts a message:

`FPHistory174 -> syncHistoryRange() -> ReactionManager releases reaction state`

unless the message is temporarily held by an active reaction feature or has a pending reaction mutation.

No persistent reaction cache is introduced.

Not used:

- localStorage;
- IndexedDB;
- CacheStorage;
- media cache.

The manager also releases inactive history-room reaction state when another room becomes the active history window.

## Initial room open

Reaction owners still load outside the critical initial startup path.

Therefore initial room data may arrive before `FPReactionManager188` exists.

To avoid losing that state:

- the bounded `activeChatHistory` object temporarily stages `reactionSummaries188`;
- when ReactionManager becomes ready it asks `FPHistory174` to synchronize the current mounted range;
- staged summaries are ingested once;
- the staging array is then released.

The staging data is already limited by the history window and is not a second long-lived cache.

## Lazy older/newer history

Every `FPHistory174` page requests:

`reactions=1`

When a page arrives:

1. RoomContext/current-request checks still run first;
2. only summaries belonging to messages in that page are ingested;
3. messages render using the existing history/render path;
4. after mount/trim, ReactionManager receives the final mounted numeric ID set;
5. reaction state for evicted messages is released.

Anchor loading merges reaction summaries from the existing older/newer page pair by message ID and highest revision.

If initial history is sliced to the bounded limit, off-window reaction summaries are discarded with it.

## WebSocket ingest

Existing WebSocket remains the only socket.

New event:

`reaction:update`

is routed through the existing `handleStableWsPayload()`.

Reaction WS events:

- do not call `noteUnreadEvent`;
- do not modify chat unread;
- do not modify chat-list last activity;
- do not modify message delivery/read state;
- do not trigger history loads.

### Unloaded-message rule

If a reaction update arrives for a message outside the current loaded history range:

- ReactionManager ignores it;
- no RAM reaction entry is created.

When that message is later loaded by lazy-history, its current authoritative reaction summary arrives with the history page.

### Startup race bridge

If a reaction WS update arrives after the room is mounted but before ReactionManager has finished loading:

- only updates for currently loaded messages are retained;
- at most one latest payload per loaded message is kept;
- the bridge is capped at 300 message IDs;
- higher revision wins;
- the bridge is cleared immediately after ReactionManager adopts the history window.

This prevents a startup race without creating a room-wide reaction event cache.

## Reconnect/resume reconciliation

A WebSocket outage can miss reaction events because reactions are not messages and therefore are not replayed through the existing message-ID sync cursor.

Build 188.2 adds one bounded current-window reconciliation endpoint:

`POST /api/rooms/:publicId/reactions/summary`

Input:

- current device ID;
- at most 300 loaded message IDs.

Server-side:

- participant access is checked;
- deleted/system/hidden-for-self messages are filtered;
- one bulk summary query is used.

Client-side:

- only the currently open room is reconciled;
- current `RoomContext170` AbortSignal is used;
- late results from another room are rejected;
- no retry queue is created.

This runs as part of existing reconnect/resume synchronization for the active room only.

It does not run for every background chat.

## Message deletion lifecycle

Existing `message-actions.js` now informs ReactionManager when a message disappears locally.

For both:

- delete for self;
- delete for all;

the local reaction state is released and queued client reaction mutations are cancelled.

Server semantics remain unchanged:

- delete for self does not delete server reactions;
- delete for all destroys server reaction rows/state.

Editing a message still leaves reactions unchanged.

## Room lifecycle

Removing a room from the local list releases its reaction RAM state.

Permanent room deletion still clears the server reaction domain through the Build 188.1 hook.

## Explicitly not changed

Build 188.2 does not add:

- reaction pills;
- quick reaction strip;
- full picker;
- reaction tap;
- reaction long press;
- reaction right-click UI;
- Reaction Details;
- profile rows;
- server room-wide admission budget;
- reaction rate guard.

No changes are made to:

- media cache;
- voice;
- message encryption;
- scroll ownership;
- gesture ownership;
- unread/read ownership;
- `FPMessageStore172` content ownership.

## Regression

`npm run test:188.2`

runs:

1. Build 188.1 reaction foundation regression;
2. Build 188.2 history/state regression.

Build 188.2 regression checks:

- one bulk summary statement rather than N+1;
- history-only reaction SQL opt-in;
- newest-first two-person preview;
- no avatars for count >= 3;
- revision-only empty reaction state survives;
- history range controls reaction RAM lifetime;
- unloaded WS updates do not allocate reaction state;
- loaded WS updates keep viewer ownership;
- WS reactions do not touch unread/chat activity;
- startup bridge remains capped at 300;
- reconnect summary batch remains capped at 300;
- local message/room deletion releases reaction state.

Physical reaction UI acceptance is still not applicable because rendering starts in the next Build 188 step.
