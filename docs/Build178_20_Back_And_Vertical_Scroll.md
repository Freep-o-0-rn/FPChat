# Build 178.20 — chat/settings back and native vertical scroll

Base: Build 178.19 on `build/178-development`.

178.20 is a regression/acceptance step. Runtime is unchanged.

## Chat back versus message gestures

`swipe-fix.js` starts chat navigation only from the existing 32px left edge. After the existing 10px direction lock identifies positive horizontal movement, it claims `navigate:chat` through `FPGesture135`.

That claim cancels both message candidates introduced in 178.19: `message-long-press` and `message-reply-swipe`. The navigation owner then stops lower propagation. Therefore a chat-back gesture that begins over a message cannot also create reply/context.

## Settings back

Modern settings use the same `swipe-fix.js` navigation path with the existing 70px threshold. The old `installBackSwipe()` helper in `settings-ui131.js` is not mounted by `mount()`; it is not a second active settings recognizer.

## Vertical scrolling

On a message, reply swipe stops tracking when `abs(dy) > abs(dx)` and does not call `preventDefault`. Message long press cancels once total movement exceeds the existing 12px threshold; it only calls `preventDefault` after the context has already opened and owns the touch.

`swipe-fix.js` likewise marks navigation vertical/cancelled before `claimAction` and before horizontal-move `preventDefault`.

The intentional exception is the pre-existing 32px left-edge zone: touchstart there is immediately prevented so Safari cannot take the native browser Back gesture before FPChat decides whether the gesture belongs to chat/settings/drawer. 178.20 does not change that established behavior.

## Regression

`npm run test:178:back-scroll` runs a static contract guard and a browser-harness sequence covering:

- chat back initiated on a message: no false reply/context;
- modern settings back;
- vertical message drag away from edge: no reply/context and no JS preventDefault;
- vertical settings drag away from edge: no JS preventDefault.

Synthetic Chromium cannot prove actual native iOS scroll physics or Safari edge-back behavior. Those remain physical acceptance items.
