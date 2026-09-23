# Build 183.8 — Chat back animation acceptance

Base: Build 183.7.

## Static acceptance

The Build 183 static acceptance verifies:

- `FPLayer173` still identifies `.chat-view` as the `chat` layer.
- `FPGesture135` still admits `navigate:chat` only from the chat layer.
- `swipe-fix.js` claims the existing `navigate:chat` action.
- drag writes only visual transforms;
- cancel returns the existing content pane without leaving the room;
- commit waits for transition completion before the existing `showChatsList()` path;
- the legacy `setupChatBackSwipe()` fallback still yields whenever `FPGesture135` is loaded;
- the Back button and system Back share the same existing swipe executor;
- no new manager/arbiter was added.

## Race guard

- Each new interactive drag invalidates cleanup callbacks from an older cancel animation.
- Once the room-exit commit animation starts, a late cancel/new touch cannot revert the committed transition.
- A timeout remains as fallback if WebKit does not deliver `transitionend`.

## Physical matrix

### Swipe commit
1. Open a room on iPhone PWA/Safari.
2. Start from the left edge and drag right.
3. The whole room (header/messages/composer) follows the finger.
4. The existing chat list is visible underneath.
5. Release after the threshold.
6. Room finishes moving right, then the normal chat list becomes active.

Expected: no flash to an empty background and no premature room teardown.

### Swipe cancel
1. Open a room and remember the visible message/scroll position.
2. Drag right but release before the threshold.
3. Room returns to x=0.

Expected:
- same room remains active;
- same scroll position;
- same unread/reply/composer state;
- no reconnect;
- no message rerender caused by the gesture.

### Competing owners
Repeat an edge gesture while each of the following owns the UI:
- media viewer;
- modal/media preview;
- message context menu;
- message selection;
- active voice recording/preview.

Expected: the higher-priority existing layer/gesture owner wins; room navigation must not steal the gesture.

### Back button
Tap the room header Back button.

Expected: same visual commit as swipe, followed by the same existing `showChatsList()` path.

### Android/system Back
With a room open, trigger system Back.

Expected: same visual commit when the executor is available; old immediate fallback remains if it is unavailable.

### Scroll/viewport regression
Check:
- unread opening;
- saved-position restore;
- bottom/new-message pill;
- lazy prepend;
- keyboard open/close;
- orientation change if available.

Expected: Build 183 does not write message scroll or viewport geometry.

### Voice/reply/media regression
Check:
- start/cancel/send voice;
- reply gesture;
- photo/video preview;
- media viewer.

Expected: their existing owners and gestures retain priority and behavior.
