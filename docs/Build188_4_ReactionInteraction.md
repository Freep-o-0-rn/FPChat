# Build 188.4 — Reaction Interaction

## Scope

Build 188.4 continues the same reactions branch:

`build/188-reactions-development`

Base: Build 188.3.

This step enables interaction with existing reaction pills and adds the Telegram-style quick reaction strip to the existing message context.

Full reaction picker and Reaction Details remain separate later steps.

## Compatibility principle

Build 188 remains additive over stable Build 187.

Working Build 187 owners are not replaced:

- `FPGesture135` remains the only gesture arbiter;
- `FPLayer173` remains the only layer arbiter;
- `FPMessageRender178` remains the message render owner;
- `FPNetwork171` remains the network transport owner;
- `FPHistory174` remains the history/window owner;
- existing message-context remains the context owner;
- existing reply swipe remains the reply swipe implementation.

Build 188.4 adds only narrow hooks/guards where reaction input must be separated from existing input.

The compatibility regression normalizes those exact additive lines and verifies the remaining Build 187 source contract.

## New owner

### `FPReactionInteractionManager188`

Owns only:

- tap/click on reaction pills;
- reaction long press;
- reaction right click on desktop;
- quick reaction strip inside the existing message context.

It does not own:

- gesture arbitration;
- overlay/layer ordering;
- message rendering;
- transport;
- history;
- scroll;
- persistent storage.

Gesture admission is delegated to `FPGesture135`.

Mutation state is delegated to:

`FPReactionManager188 + FPReactionArbiter188`

## Gesture contract

Reaction long press uses the same values as the existing message long press:

- hold: **450 ms**;
- movement cancellation: **12 px**.

This keeps the interaction timing consistent for the user.

### Reaction pill

Mobile:

- tap → toggle this reaction;
- long press → request Reaction Details;
- movement >12 px before claim → reaction long press cancels and normal scroll remains available.

Desktop:

- left click → toggle this reaction;
- right click → request Reaction Details.

### Ownership isolation

When the initial target is `.fp-reaction-pill188`:

- message long press does not start;
- reply swipe does not start;
- message-context right-click handler does not claim the original event;
- `FPReactionInteractionManager188` is the feature recognizer;
- `FPGesture135` decides whether reaction long press may claim the gesture.

No general `stopPropagation()` patch is scattered through unrelated code.

Only the specific reaction target is guarded.

## Safe pre-Details fallback

Build 188.6 owns the full Reaction Details UI.

Until that owner exists, Build 188.4 does not leave reaction long press/right click as a dead gesture.

The interaction manager first asks:

`FPReactionDetails188.open(...)`

or emits:

`fpchat:reaction188-details-request`

If no Details owner handles the request yet, the interaction falls back to the existing message context for that same message.

Therefore Build 188.4 remains usable while the later Details step is still absent.

Once Build 188.6 installs `FPReactionDetails188`, no gesture-owner rewrite is required.

## Tap semantics

A pill tap reads the current projected reaction state.

If the current participant already has the reaction:

`REMOVE`

If not:

`ADD`

The client never sends server-side TOGGLE.

This preserves deterministic conflict handling.

## Optimistic state

`FPReactionManager188` now owns an optimistic projection over the last authoritative reaction state.

The authoritative state and pending client operations remain separate.

This is required for rapid input.

Example:

1. user taps ❤️;
2. optimistic ADD is visible immediately;
3. before the server response arrives the user taps ❤️ again;
4. the projected state immediately removes ❤️;
5. FIFO sends explicit ADD first and explicit REMOVE second;
6. the first server response cannot visually undo the already queued second action.

Pending operations are projected in FIFO order over the latest authoritative base.

## Three-reaction rule during optimistic input

The same accepted max-three rule is projected client-side.

Example:

`❤️ 😂 🔥 + 👍 -> 😂 🔥 👍`

The fourth optimistic ADD removes the oldest current personal reaction from the projected state.

The server remains authoritative and applies the same rule transactionally.

## Per-message queue

`FPReactionArbiter188` remains unchanged:

- one FIFO lane per `roomId + messageId`;
- maximum 20 in-flight + queued operations per message;
- no coalescing;
- no persistence;
- no retry.

Different messages keep independent lanes.

## Network failure

Reaction mutations are sent once.

There is:

- no offline reaction queue;
- no automatic resend;
- no delayed retry.

If the request fails:

1. the failed pending operation is removed;
2. the optimistic state is recomputed from the latest authoritative base plus any remaining pending operations;
3. the visual state rolls back accordingly.

A failure emits the local event:

`fpchat:reaction188-error`

The event does not create unread/chat activity.

## RoomContext binding

Every reaction mutation captures the current `FPRoomContext170` when the user acts.

The network operation later uses that captured context, not whichever room happens to be current when the FIFO lane eventually reaches the operation.

If the captured room context ends:

- the operation's fetch is aborted;
- queued operations from the previous reaction room are cancelled by reaction lifecycle cleanup;
- no late result may mutate the new room UI.

This preserves the existing architecture rule:

> a late result from room A must never mutate room B.

## Delete semantics on client

Existing Build 188.2 message deletion hooks remain in force.

Delete for self or all:

- aborts/cancels pending client reaction mutations for that message;
- releases local reaction state.

Server semantics remain unchanged:

- delete for self keeps server reaction rows;
- delete for all destroys the reaction domain for the message.

## Quick reaction strip

The strip is part of the existing `message-context`, not a separate overlay.

Current quick reactions come from the versioned catalog:

`😂 ❤️ 👍 👎 🔥 🥰 👏`

The strip:

- is inserted immediately above the selected message clone;
- follows incoming/outgoing alignment;
- highlights reactions currently owned by the user;
- uses the same `FPReactionManager188.toggleReaction()` path as a pill tap;
- closes the existing message context immediately after selection.

No full picker button is added in 188.4. The expanded catalog is Build 188.5.

## Message-context preservation

The working Build 187 message-context implementation is not rewritten.

Build 188.4 adds only:

1. a right-click target guard for reaction pills;
2. a touch long-press target guard for reaction pills;
3. one optional `FPReactionInteractionManager188.decorateContext(...)` hook.

The compatibility regression strips those exact additions and verifies the original Build 187 file hash.

## Reply swipe preservation

The working Build 187 reply swipe is not rewritten.

One early target guard is added:

`if target is a reaction pill -> do not start reply swipe`

The rest of `appendMessage(...)` remains the stable Build 187 implementation plus the previously accepted 188.3 renderer hook.

The compatibility regression strips both additive reaction lines and verifies the stable Build 187 `appendMessage` hash.

## Reaction renderer activation

In 188.3 reaction pills were inert.

In 188.4 they remain `pointer-events:none` until the interaction owner has loaded successfully.

Only then the root receives:

`fp-reaction-interaction188-ready`

and reaction pills become interactive.

If the optional interaction asset fails to load, pills remain inert and existing Build 187 message gestures continue to receive input.

## Load order

Reaction feature chain remains outside the critical Build 187 startup path:

`FPReactionArbiter188`
→ `FPReactionManager188`
→ `FPReactionRenderer188`
→ `FPReactionInteractionManager188`

The interaction owner loads only after the renderer.

## Explicitly deferred

Not part of Build 188.4:

- full reaction catalog picker;
- picker modal lifecycle;
- Reaction Details modal;
- Details tabs `Все / ❤️ / 😂 / ...`;
- Details lazy pagination by 30;
- profile opening from Details;
- server room-wide admission/rate budget.

## Regression

`npm run test:188.4`

runs all earlier Build 188 regressions plus:

- stable Build 187 compatibility guard;
- interaction/gesture ownership checks;
- rapid ADD→REMOVE optimistic projection;
- per-message FIFO order;
- explicit PUT/DELETE protocol;
- max-three optimistic FIFO eviction;
- network failure rollback;
- proof that a failed reaction is not automatically retried;
- captured RoomContext contract;
- quick-strip integration contract.

Physical mobile/desktop UI acceptance is still required for gesture feel and layout.
