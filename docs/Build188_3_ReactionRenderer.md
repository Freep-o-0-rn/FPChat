# Build 188.3 — Compact Reaction Pills

## Scope

Build 188.3 continues:

`build/188-reactions-development`

Base: Build 188.2.

This step adds only the compact visual representation of reactions under already rendered user messages.

No reaction input is enabled yet. Tap, long press, right click, quick reactions, full picker and Reaction Details remain deferred.

## Compatibility rule

Build 188 is an additive feature line over stable Build 187.

Build 188.3 therefore does not replace or redesign the working message renderer, gesture stack, layer stack, network owner, message store, connection owner, send owners or context-menu logic.

The only change inside the stable `appendMessage(...)` body is one additive hook after the existing message node has already been appended:

`FPReactionRenderer188.mount(...)`

A regression guard verifies that, after removing this single hook, the complete `appendMessage(...)` source is byte-equivalent to stable Build 187.

The same guard also locks selected stable Build 187 owner files by checksum.

## Owner boundary

### Existing owner

`FPMessageRender178`

remains the message render owner.

### New worker

`FPReactionRenderer188`

is a thin DOM worker under `FPMessageRender178`.

It may modify only:

`.fp-message-reactions188`

inside an existing message bubble.

It may not:

- rebuild or replace the message;
- touch media/voice/reply DOM;
- own history;
- write scroll;
- own gestures;
- attach message tap/long-press/right-click handlers;
- create WebSocket/fetch requests;
- create timers or observers.

## Gesture safety

Build 188.3 reaction pills are intentionally non-interactive.

The reaction lane and pills use:

`pointer-events: none`

Therefore the existing Build 187 behavior remains authoritative for:

- message tap;
- message long press;
- desktop right click;
- swipe reply;
- media interaction outside the reaction lane.

Interactive reaction ownership is introduced only in Build 188.4 through the agreed ReactionInteractionManager + FPGesture135 contract.

## Compact presentation

Canonical order is taken from the server reaction summary:

1. count descending;
2. first active appearance ascending;
3. reaction ID ascending.

The renderer does not invent a second sort order.

### Count = 1

Example:

`❤️ [В]`

One compact profile circle is shown.

### Count = 2

Example:

`❤️ [И][В]`

Two compact profile circles are shown in the canonical preview order returned by the server.

### Count >= 3

Example:

`❤️ 230`

No participant circles are created.

This avoids visual noise and prevents large groups from creating large per-message DOM.

## Own reaction

If the current participant has a reaction, only that pill receives the `is-mine` visual state.

Own reaction:

- accent border;
- accent-soft background;
- accent text state.

Foreign-only reaction:

- neutral pill.

The reaction emoji itself keeps its native emoji rendering.

## Profile circles

Reaction summaries contain only `participantId` references.

The renderer resolves presentation through the current participant/presence state.

The room participant presence DTO now exposes the existing database participant ID as an additive field:

`participantId`

Existing DTO fields and presence/privacy behavior are unchanged.

Current profile presentation:

- existing display name;
- same initial convention used by FPChat profile UI;
- accent profile circle.

Future avatar support is already allowed by the renderer presentation adapter: if the projected participant state later exposes an allowed avatar URL, the same reaction circle can display it without changing reaction persistence.

No profile lookup network request is performed by the reaction renderer.

## DOM patch model

A message with reactions receives one isolated lane inside its existing bubble, immediately before the existing message meta block.

Each reaction pill is keyed by:

`reactionId`

On a reaction update:

- unchanged pill signatures are left untouched;
- changed pills are patched;
- removed reaction IDs remove only their pill;
- canonical order is restored by moving existing pill nodes;
- the parent message is never remounted.

If a message has zero reactions, the reaction lane is removed completely.

System/service messages are excluded.

## History and WS integration

Build 188.2 remains the state source.

`FPReactionRenderer188` reads only:

`FPReactionManager188.get(roomId, messageId)`

It does not duplicate reaction state.

When `FPReactionManager188` emits:

`fpchat:reaction188-changed`

the renderer patches only the corresponding mounted message if it exists in the current room.

Unloaded messages are still ignored by the ReactionManager as defined in Build 188.2.

## Initial load race

Reaction owners remain outside the critical Build 187 startup path.

Loading order is now:

`FPReactionArbiter188 -> FPReactionManager188 -> FPReactionRenderer188`

When the renderer loads, it performs one bounded scan of the currently mounted message window.

No MutationObserver and no polling loop are added.

Future messages/history pages use the one additive `appendMessage` hook.

## Preserved Build 187 core

Build 188.3 adds a dedicated compatibility regression that verifies selected core files are still identical to Build 187, including:

- `gesture-manager135.js`;
- `layer-manager173.js`;
- `network171.js`;
- `message-store172.js`;
- `connection170.js`;
- `dom-lifecycle173.js`;
- `room-context170.js`;
- `work174.js`;
- `send-manager177.js`;
- `text-send170.js`;
- `media-send170.js`;
- `message-context.js`.

The message renderer itself is checked separately so that only the single reaction-render hook is permitted.

## Explicitly deferred

Not part of Build 188.3:

- tap reaction add/remove;
- reaction long press;
- reaction right click;
- quick reaction strip;
- full catalog picker;
- Reaction Details;
- profile opening from Reaction Details;
- server room admission/rate guard.

## Regression

`npm run test:188.3`

runs:

1. Build 188.1 foundation;
2. Build 188.2 history/state;
3. stable Build 187 compatibility guard;
4. Build 188.3 renderer contract.

The renderer regression verifies:

- no transport ownership;
- no scroll writes;
- no timers;
- no observers;
- no gesture ownership;
- `pointer-events:none`;
- 1–2 profile circle rule;
- 3+ numeric rule;
- own-reaction highlight;
- keyed pill patching;
- system-message exclusion;
- participant ID propagation;
- renderer load order after ReactionManager.
