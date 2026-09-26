# Build 188.5 — Full Reaction Catalog Picker

## Scope

Build 188.5 continues:

`build/188-reactions-development`

Base: Build 188.4.

This step adds the expandable full reaction catalog to the existing Telegram-style message context.

The reaction persistence, FIFO arbitration, optimistic mutation projection, bounded history/RAM integration and compact reaction pills from 188.1–188.4 remain unchanged.

## Architecture

### Existing owners remain authoritative

- `FPReactionManager188` — reaction state, catalog and optimistic projection.
- `FPReactionArbiter188` — per-room/message FIFO mutation ordering.
- `FPReactionInteractionManager188` — reaction tap/long-press/right-click and selection semantics.
- `FPMessageRender178` + `FPReactionRenderer188` — message/reaction DOM.
- `message-context` — existing context overlay.
- `FPGesture135` — gesture arbitration.
- `FPLayer173` — layer arbitration.

### New worker

`FPReactionPicker188`

is a thin UI worker under:

`FPReactionInteractionManager188`

It owns only:

- the round expand/collapse control in the quick reaction strip;
- the full catalog panel DOM;
- category grouping;
- visual selection state inside the picker.

It does not own:

- network;
- mutation semantics;
- reaction state;
- gestures;
- history;
- scroll ownership;
- WebSocket;
- persistent cache;
- a new modal/layer.

The picker lives entirely inside the already-open `message-context` layer.

## UI behavior

The quick strip remains:

`😂 ❤️ 👍 👎 🔥 🥰 👏`

and now receives a round chevron button on the right.

Collapsed:

`😂 ❤️ 👍 👎 🔥 🥰 👏  ⌄`

Expanded:

- the quick strip stays visible;
- a full catalog panel opens immediately below it and above the selected message clone;
- the chevron rotates upward;
- all enabled catalog reactions are available.

Selecting any reaction from the full picker:

1. delegates to the existing `FPReactionInteractionManager188`;
2. uses the same `FPReactionManager188.toggleReaction()` path as a compact pill/quick reaction;
3. therefore produces explicit ADD or REMOVE;
4. enters the same per-message FIFO;
5. closes the existing message context.

No separate mutation path is created.

## Catalog source

The full picker does not contain a hard-coded reaction list.

Both quick and full lists come from the same versioned server catalog:

`public/reactions-catalog188.json -> /api/reactions/catalog -> FPReactionManager188`

The interaction owner asks for:

- `getQuickReactions()`;
- `getAvailableReactions()`.

Both use the same cached catalog promise/state, so opening the picker does not create one request per list.

The current catalog already contains reactions beyond the seven quick slots, so the full picker is useful immediately.

## Categories

The picker groups reactions by catalog `category` in catalog order.

Current presentation labels:

- faces → Эмоции;
- hearts → Сердца;
- gestures → Жесты;
- symbols → Символы;
- objects → Объекты;
- food → Еда;
- animals → Животные;
- seasonal → Праздничные;
- unknown categories → Другие.

The category is metadata only. Reaction identity remains the stable `reaction_id`.

Adding new emoji reactions later requires catalog changes, not picker code changes.

## Lazy DOM

The full grid is not created when message-context opens.

At attach time Build 188.5 creates only:

- one expand button;
- one empty hidden panel.

The reaction grid is built only on the first explicit expand action:

`if (open && !rendered) render(catalog)`

After that it is reused until the parent message-context closes.

Because message-context is transient, closing it releases the whole picker DOM naturally.

No MutationObserver, polling loop or persistent picker cache is added.

## Selected reactions

The picker reflects current personal reactions with the same accent state used by quick reactions.

Selection state is synchronized from:

`FPReactionManager188.get(roomId, messageId).myReactions`

When authoritative or optimistic reaction state changes:

`fpchat:reaction188-changed`

the existing InteractionManager updates:

1. quick reaction buttons;
2. the attached full picker through `FPReactionPicker188.syncSelection(...)`.

The picker does not keep a second reaction store.

## Maximum three reactions

The picker itself does not implement max-three logic.

Selection delegates to ReactionManager, so the accepted rule remains singular:

- maximum 3 different reactions per participant/message;
- adding a fourth removes the oldest current personal reaction;
- tapping an existing personal reaction removes it.

Both optimistic and authoritative behavior remain the Build 188.4 implementation.

## Mobile layout

The quick reaction buttons shrink slightly on narrow screens so seven quick reactions plus the catalog chevron remain visible without horizontal reaction-strip scrolling.

The full picker uses:

- maximum width about 336 px;
- bounded height relative to viewport;
- internal vertical scrolling;
- 7 columns normally;
- 6 columns on very narrow screens.

This internal picker scroll does not write the message-list scroll position.

## Fail-safe loading

Reaction feature load order becomes:

`FPReactionArbiter188`
→ `FPReactionManager188`
→ `FPReactionRenderer188`
→ `FPReactionPicker188`
→ `FPReactionInteractionManager188`

All remain post-`boot-ready`; stable Build 187 critical startup is not extended.

The picker is optional.

If `reaction-picker188.js` fails to load:

- `FPReactionInteractionManager188` still loads;
- Build 188.4 quick reactions still work;
- reaction pills still work;
- existing message-context still works.

Only the full expand button/catalog is absent.

## Stable Build 187 preservation

Build 188.5 does not modify:

- `FPGesture135`;
- `FPLayer173`;
- `FPNetwork171`;
- `FPMessageStore172`;
- `FPConnection170`;
- `FPRoomContext170`;
- send/media owners.

It also adds no new hooks to `appendMessage(...)` or `message-context.js` beyond those already accepted in 188.4.

The existing Build 187 compatibility regression remains part of `test:188.5`.

## Deferred

Still not part of Build 188.5:

- Reaction Details participant list;
- tabs `Все / ❤️ / 😂 / ...`;
- lazy participant pagination by 30;
- opening a participant profile from Reaction Details;
- room-wide reaction admission/rate budget.

Those remain subsequent Build 188 steps.

## Regression

`npm run test:188.5`

runs all previous 188 regressions plus the full picker contract.

The 188.5 regression checks:

- picker is a worker under ReactionInteractionManager;
- no new layer;
- no transport/WebSocket;
- no localStorage/IndexedDB;
- no observer/timer/polling;
- no message-scroll writes;
- lazy first-open rendering;
- catalog-driven reaction IDs;
- disabled reactions filtered;
- category metadata used;
- personal selection state exposed;
- quick and full catalog both come from ReactionManager;
- full selection delegates to the existing mutation path;
- optional-picker load failure preserves quick reactions;
- current accepted quick order remains unchanged;
- full catalog contains reactions beyond quick slots.
