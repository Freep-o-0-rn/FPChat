# Build 188.8 — Reactions Release Candidate

## Scope

Build 188.8 is the final Build 188 reaction release candidate on:

`build/188-reactions-development`

Base: Build 188.7.

No new reaction behavior is introduced in this step.

Build 188.8 freezes the accumulated reaction-domain contract, adds one final cross-build release regression, and finalizes release metadata.

## Accepted reaction behavior frozen by 188.8

### Message support

Reactions remain allowed on:

- text;
- photo;
- multi-photo / album;
- video;
- voice;
- captioned media;
- reply messages;
- edited messages.

Reactions remain disallowed on:

- system/service messages;
- deleted-for-all messages.

Editing does not delete or rewrite reaction state.

### Personal reaction semantics

One participant may keep at most **3 different reactions** on one message.

Example:

`❤️ 😂 🔥 + 👍 -> 😂 🔥 👍`

Rules remain:

1. tap a reaction not owned by the user → ADD;
2. tap an existing own reaction → REMOVE;
3. other own reactions remain;
4. a fourth different reaction evicts the oldest own reaction;
5. protocol uses explicit ADD/REMOVE, never server-side TOGGLE.

### Compact display

Reaction groups are ordered by:

1. count DESC;
2. first active appearance ASC;
3. reaction_id ASC.

For one or two reactors the compact pill may show up to two profile/avatar circles.

For three or more reactors the pill shows the numeric count instead of avatar clutter.

Own reaction pills remain highlighted.

### Quick reactions and full catalog

Long press / right click on a message uses the existing message-context.

Quick strip:

`😂 ❤️ 👍 👎 🔥 🥰 👏`

The full catalog is expandable, versioned and catalog-driven.

The full picker is lazy-rendered only after explicit expansion.

### Reaction Details

Long press / right click on an existing reaction pill opens Reaction Details.

Details keeps:

- tabs `Все / ❤️ / 😂 / ...`;
- one participant = one row in `Все`;
- newest active reaction ordering;
- newest specific reaction ordering in a reaction tab;
- 30-row keyset pagination;
- `reactionRevision` stale-page protection;
- existing profile/privacy/block rules;
- no request storm on live reaction updates.

## Architecture freeze

Final Build 188 owner map:

`FPReactionManager188`
- canonical client reaction summary;
- own reactions;
- reaction revision;
- bounded RAM state;
- optimistic projection.

`FPReactionArbiter188`
- client per-message mutation FIFO;
- max 20 queued/in-flight operations per message;
- ordering only;
- no retry/persistence.

`FPReactionMutationArbiter188`
- authoritative server per-message FIFO;
- adaptive room admission;
- per-user burst protection.

`FPReactionInteractionManager188`
- reaction tap;
- reaction long press;
- desktop right click;
- quick-strip selection;
- picker selection delegation.

`FPReactionRenderer188`
- compact reaction pill DOM only.

`FPReactionPicker188`
- full catalog UI worker only.

`FPReactionDetails188`
- Details modal and 30-row lazy read state only.

Existing FPChat owners remain authoritative for:

- gestures: `FPGesture135`;
- layers: `FPLayer173`;
- transport: `FPNetwork171`;
- room cancellation: `FPRoomContext170`;
- message history: `FPHistory174`;
- message canonical store: `FPMessageStore172`;
- message render: `FPMessageRender178`;
- public profile UI: existing `username-search143` profile controller.

## Isolation guarantees

Reaction updates do not become message activity.

A `reaction:update` must not:

- increment unread;
- move a chat in the chat list;
- change last message;
- create message notifications;
- create reaction push notifications.

Reaction state remains separate from:

- media cache;
- persistent offline queue;
- localStorage reaction cache;
- IndexedDB reaction cache.

## Lazy-history / memory contract

Reaction state is stored only for the current bounded loaded history window.

WS updates for unloaded messages are ignored by ReactionManager and do not permanently occupy RAM.

Reconnect/current-window reconciliation remains bounded.

Reaction Details keeps only its currently loaded rows and releases them when the modal closes.

## Delete contract

### Delete for self

The local message is hidden for that device.

Server reaction rows remain intact.

Pending client reaction mutations for the locally removed message are cancelled/released on that client.

### Delete for all

The message reaction domain is destroyed:

- pending server reaction work for that message is cancelled where not yet executing;
- reaction rows are deleted;
- reaction revision state is deleted;
- client reaction state is released.

### Edit

Editing text leaves reactions untouched.

## Group / load protection contract

Adaptive server admission remains:

- window: 5 seconds;
- per-user burst: 20 mutations / 5 seconds / room;
- room budget: `clamp(onlineParticipants × 1, 40, 250)`;
- extra RAM queue: one additional room budget;
- room saturation: `503 REACTION_BUSY`;
- user burst: `429 REACTION_RATE_LIMITED`;
- no automatic client retry.

Only actually online room participants contribute to adaptive room capacity.

Offline registered participants do not inflate the budget.

## Stable Build 187 compatibility

Build 188 remains additive over the stable Build 187 architecture.

The accumulated compatibility tests preserve the original Build 187 contracts for the core managers and normalize only the narrow, documented reaction hooks in:

- `appendMessage(...)`;
- `message-context.js`;
- public profile opener adapter.

Build 188.8 itself adds no new hook to those areas.

## Final automated release regression

New command:

`npm run test:188.8`

Alias:

`npm run test:188`

The final command runs every previous Build 188 regression and then:

`scripts/regression1888-reactions-release.cjs`

The final release regression checks the cross-build invariants that individual build tests intentionally cover separately:

- owner map;
- no persistent reaction queue/cache;
- no media cache ownership leak;
- lazy-history bounded RAM;
- reaction WS does not touch unread/chat ordering/notifications;
- compact avatar/count behavior;
- own-reaction highlight;
- 450 ms / 12 px gesture contract;
- canonical quick/full catalog;
- lazy full picker;
- Details page size/profile/network/layer contracts;
- SQLite uniqueness/max-three/popularity ordering;
- adaptive admission guards;
- delete-for-self vs delete-for-all semantics;
- edit preserves reactions;
- post-boot optional reaction load chain;
- release metadata identity;
- real SQLite acceptance for supported/unsupported messages, max-three, no-op revisions, popularity ordering, avatar preview and delete-for-all cleanup.

## Release metadata

Final Build 188 identity:

- version: `1.0.0`;
- build: `188.8`;
- updater expected build: `188.8`;
- UI build labels/cache-bust: `188.8`.

Build 188.8 remains on the development branch. It does not merge to `main` and does not deploy itself.

## Physical acceptance still required

Automated/static acceptance does not replace real-device UI validation.

Recommended final physical matrix:

1. two real clients open the same chat;
2. long press / PC right click message → quick strip;
3. choose quick reaction → instant optimistic pill;
4. tap own pill → remove;
5. use three own reactions, then add a fourth → oldest disappears;
6. second participant adds same reaction → two profile circles;
7. third participant adds same reaction → circles replaced by count;
8. open full catalog and add/remove a non-quick reaction;
9. long press / PC right click reaction pill → Reaction Details;
10. switch `Все / reaction` tabs;
11. verify newest-first ordering;
12. with >30 test reactors, scroll to lazy second page;
13. change a reaction while Details is open → stale/refresh behavior;
14. edit a reacted message → reactions remain;
15. delete-for-self → peer/server reactions remain;
16. delete-for-all → reaction pill/domain disappears;
17. verify system messages have no reaction entry point;
18. check swipe reply, message long press, scrolling, media viewer and voice still behave normally;
19. reconnect/reload → reactions restore only with loaded message history;
20. verify a reaction does not change unread count or reorder the chat list.

Physical results should be recorded separately as PASS/FAIL; Build 188.8 does not claim them automatically.
