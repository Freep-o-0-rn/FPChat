# Build 188.6 — Reaction Details

## Scope

Build 188.6 continues the same reactions branch:

`build/188-reactions-development`

Base: Build 188.5.

This step implements the detailed reactor list opened by long press / right click on an existing reaction pill.

The accepted behavior is:

`❤️ 115`
→ long press / right click
→ tabs `Все / ❤️ 115 / 😂 37 / 🔥 12 / ...`
→ lazy participant list, 30 rows per page.

## Existing owners remain authoritative

Build 188.6 does not replace the accepted owners from 187/188:

- `FPGesture135` — gesture arbitration;
- `FPLayer173` — overlay/layer arbitration;
- `FPNetwork171` — network transport;
- `FPRoomContext170` — room generation/cancellation;
- `FPReactionManager188` — canonical reaction state/catalog;
- `FPReactionArbiter188` — per-message mutation FIFO;
- `FPReactionInteractionManager188` — reaction tap/long-press/right-click semantics;
- `FPReactionRenderer188` — compact pills;
- `FPHistory174` — message history/lazy window;
- existing `username-search143` profile implementation — public profile modal.

Build 188.6 adds one read-only feature owner:

### `FPReactionDetails188`

It owns only:

- the Reaction Details modal;
- active Details tab;
- the 30-row lazy read cursor;
- Details read request cancellation;
- the stale-snapshot indicator.

It owns no reaction mutations and creates no second reaction state store.

## Open behavior

`FPReactionInteractionManager188` already has the accepted hook:

`FPReactionDetails188.open(...)`

Once Build 188.6 is loaded:

- mobile long press on a reaction pill opens Details;
- desktop right click on a reaction pill opens Details.

The message-context fallback from 188.4 remains intact if the Details asset fails to load.

The initial tab is the reaction that was pressed.

Example:

long press `❤️ 115`
→ `❤️` tab opens first.

## Modal/layer ownership

Reaction Details creates a dialog with:

`aria-modal="true"`

It therefore enters the existing `FPLayer173` modal contract through the existing DOM/layer lifecycle.

No change is made to `layer-manager173.js`.

The modal closes on:

- close button;
- backdrop click;
- Escape;
- room context cancellation;
- page/background lifecycle boundary.

## Lazy loading

Page size is fixed:

**30 participants**

The client does not fetch the full reactor set.

The list fetches the next page only when its own internal scroll reaches the lower threshold.

Reaction Details does not:

- change message-list scroll;
- request more message history;
- retain all reactors in global RAM;
- use IntersectionObserver;
- use polling.

The modal owns only the rows currently loaded inside that modal. Closing the modal releases them with the DOM.

## Server endpoint

Read endpoint:

`GET /api/rooms/:publicId/messages/:messageId/reactions/details`

Parameters:

- `deviceId`;
- `reactionId=all|<reaction_id>`;
- optional `cursor`;
- optional `revision` for subsequent pages.

The endpoint validates:

- room membership;
- message existence;
- not deleted-for-all;
- not system/service;
- not hidden-for-self for the requesting device.

Reading Details is allowed for an existing visible message even if the room is no longer open; only mutation routes require an open room.

## One participant = one row

### Tab `Все`

A participant with:

`❤️ 😂 🔥`

appears exactly once.

The row contains that participant's current active reactions.

The row timestamp is the timestamp of the **latest still-active reaction** for that participant.

Sorting:

1. latest active reaction time DESC;
2. latest active reaction row ID DESC;
3. participant ID DESC.

This implements the accepted deletion rule.

If a participant removes one of several reactions, the deletion itself does **not** become a new activity timestamp.

Example:

- ❤️ at 17:00
- 😂 at 17:10
- 🔥 at 17:20
- remove 🔥 at 18:00

After deletion the participant's Details ordering is based on 😂 at 17:10, not on the 18:00 deletion.

Existing remaining reaction timestamps are never rewritten.

### Specific reaction tab

For `❤️`:

the participant who most recently **added ❤️** is first.

Sorting:

1. ❤️ `created_at` DESC;
2. reaction row ID DESC;
3. participant ID DESC.

Deleting another reaction does not change the ❤️ timestamp.

## Stable keyset pagination

Build 188.6 does not use OFFSET pagination.

Each next-page cursor contains the last visible ordering tuple:

- timestamp;
- reaction row ID;
- participant ID.

This avoids normal OFFSET drift in large groups.

## Revision conflict guard

A more important race remains possible:

1. page 1 is loaded;
2. users add/remove reactions;
3. page 2 is requested against a changed set.

Mixing those pages could duplicate or omit users.

Therefore the first page returns:

`reactionRevision`

Every later page sends that revision back.

If the message reaction revision changed, server returns:

`409 REACTION_DETAILS_STALE`

and does not return a mixed page.

The client keeps the existing snapshot and exposes:

`Обновить`

instead of silently combining different revisions.

This is intentionally conservative for high-activity groups.

## High-volume group behavior

Reaction WS updates while Details is open do **not** cause one HTTP request per reaction.

For the same message:

`fpchat:reaction188-changed`

only marks the open Details snapshot stale and shows the refresh control.

This avoids request storms in a room with hundreds of active participants.

The user may explicitly refresh, or a stale next-page boundary will request refresh.

## Query cost

A Details page is bounded and set-based.

For a page of at most 30 participants the server uses a fixed number of SQL statements:

1. tab counts;
2. unique participant count;
3. one keyset page query;
4. one bulk query for active reactions of the selected 30 participant IDs.

There is no reaction N+1 query per participant.

Profile block visibility is also projected in the page SQL with a join to the existing block table, avoiding per-row block queries.

## Tabs

The server returns:

- unique participant count for `Все`;
- reaction counts per reaction group;
- reaction descriptors from the canonical catalog.

Reaction tab ordering follows the canonical message reaction order already accepted:

1. count DESC;
2. first active appearance ASC;
3. reaction ID ASC.

## Row presentation

Each row shows:

- profile/avatar circle;
- room display name;
- reaction emoji(s);
- localized time.

Examples:

`❤️ сегодня в 17:31`

`😂 🔥 вчера в 23:04`

Current avatar behavior:

- future avatar URL if the profile projection later provides one;
- otherwise existing FPChat-style initials/profile circle.

No new avatar store is introduced in 188.6.

## Public profile opening and privacy

A reactor row opens the existing FPChat public-profile modal only when that public profile is allowed to be exposed.

Build 188.6 does not create a second profile UI.

It adds one additive public adapter to the existing `username-search143` controller:

`FPUsernameSearch143.openProfile(...)`

The original profile implementation remains unchanged.

Server-side profile projection respects the existing profile/search privacy setting:

`allow_username_search`

For another participant:

- username exists + profile visibility allowed → row may open profile;
- public profile hidden → no username/profile object is sent to Details;
- participant blocked the viewer → no profile object is sent.

The room display name remains visible because it was already visible to room participants.

For the current user, their own profile remains openable to themselves even if public search visibility is disabled.

## Stable Build 187 protection

No Build 188.6 changes are made to:

- `gesture-manager135.js`;
- `layer-manager173.js`;
- `network171.js`;
- `message-store172.js`;
- `connection170.js`;
- `room-context170.js`;
- send/media owners;
- `appendMessage(...)`;
- message-context reaction hooks accepted in 188.4.

`username-search143.js` receives only the small exported adapter for its already-existing `openProfile()` controller.

The Build 187 compatibility regression removes that exact adapter and verifies the original 187 file hash.

## Feature loading

Post-boot reaction chain becomes:

`FPReactionArbiter188`
→ `FPReactionManager188`
→ `FPReactionRenderer188`
→ `FPReactionPicker188`
→ `FPReactionDetails188`
→ `FPReactionInteractionManager188`

Details is optional.

If `reaction-details188.js` fails:

- interaction manager still loads;
- compact reaction pills still work;
- quick reactions still work;
- full picker still works;
- long press/right click on a reaction uses the safe 188.4 message-context fallback.

Stable Build 187 startup remains outside this chain.

## Explicitly deferred

Build 188.6 does not add:

- reaction notifications;
- automatic Details refresh storms;
- server room-wide reaction admission/rate budget;
- group member management;
- group role/permission semantics.

The group-scaled admission/rate protection remains the next independent reaction hardening step.

## Regression

`npm run test:188.6`

runs all previous Build 188 regressions plus the Reaction Details regression.

It checks:

- 30-row page size;
- one participant = one row in `Все`;
- keyset pagination without duplicates;
- per-reaction newest-first ordering contract;
- revision mismatch → `REACTION_DETAILS_STALE`;
- max 30 rows per page;
- profile privacy;
- self-profile exception;
- peer-block profile hiding;
- no per-row block query;
- deletion does not fabricate a new reaction timestamp;
- remaining reaction timestamp is unchanged;
- Details uses `FPNetwork171`;
- Details uses existing modal/layer contract;
- RoomContext cancellation;
- no new WebSocket, persistent cache, observers, timers or polling.
