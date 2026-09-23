# Build 183.1 — Chat back animation ownership

Base: Build 182.6.

## Goal

Add Telegram-like room -> chat list back animation without creating a new manager, arbiter, store, coordinator or navigation owner.

## Existing owners

- **FPLayer173 / LayerManager** — owns current UI layer. A room back gesture is valid only while the effective layer is `chat`; viewer/modal/context/selection/voice remain higher-priority owners.
- **FPGesture135 / GestureArbiter** — owns gesture admission and action arbitration. The room back gesture must claim the existing action `navigate:chat`.
- **public/swipe-fix.js** — existing feature executor for the admitted mobile back gesture. It may write temporary visual transforms for the room-back transition, but it does not own room state.
- **FPScroll173 / ScrollArbiter** — remains the only owner of message scroll. Build 183 must not write `scrollTop`, change anchors or trigger scroll restoration during drag.
- **ViewportManager173** — keeps viewport/keyboard ownership. Build 183 does not resize the chat or take keyboard geometry ownership.
- **RoomContext170 / RoomSessionManager** — keeps room/generation ownership. The active room must not change during drag or cancel.
- **ConnectionManager170** — keeps WebSocket ownership. The visual transition must not connect/disconnect sockets.
- **MessageStore172** — keeps canonical message state. No message mutations are allowed during animation.
- **Render/History 174** — keeps message/history DOM ownership. The room DOM is not rebuilt during drag/cancel.
- **FPRuntime169** — observer only.

## Transition contract

### Begin
1. `FPLayer173` reports effective layer `chat`.
2. `FPGesture135.canNavigate('chat')` permits the gesture.
3. Existing `swipe-fix.js` claims `navigate:chat`.
4. Existing chat list pane is exposed underneath the existing content pane.
5. No room/application state is changed.

### Drag
Only temporary visual properties may change:
- content pane horizontal transform;
- underlying chat-list parallax transform;
- transition helper classes.

The following remain unchanged:
- `state.roomId`;
- RoomContext generation;
- WebSocket;
- MessageStore;
- message DOM;
- composer state;
- unread state;
- scroll position.

### Cancel
The content pane animates back to x=0. Temporary classes/transforms are removed. No room leave occurs.

### Commit
The content pane animates out to the right. Only after visual completion the existing `showChatsList()` path runs, which in turn invokes the existing room-leave/save behavior.

### Back button / system Back
They may request the same existing visual executor. They do not become new navigation owners. If the visual executor is unavailable, the existing immediate `showChatsList()` fallback remains.

## Non-goals

- no new ChatTransitionManager;
- no new NavigationManager;
- no new SwipeManager;
- no new arbiter;
- no second global touch gesture implementation;
- no scroll/viewport ownership changes;
- no RoomContext/WS/store rewrites.
