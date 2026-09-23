# Build 178.19 — message long press / reply swipe arbitration

Base: Build 178.18 on `build/178-development`.

## Proven conflict

Both message long press and reply swipe previously consulted `FPGesture135.currentLayer()`, but neither registered with `watchAction/claimAction`. They could therefore progress independently inside the same touch session.

## Preserved recognizers

Message long press keeps:

- `LONG_PRESS_MS = 450`;
- `MOVE_CANCEL_PX = 12`;
- existing timer and `openContext()` executor.

Reply swipe keeps:

- `SWIPE_REPLY_THRESHOLD = 52`;
- existing left-swipe geometry and `currentDx` cap;
- existing final-threshold rule on touchend;
- existing `setSelectedReply()` executor.

## Arbitration

On the same touchstart:

- message context registers `watchAction('message-long-press')`;
- reply swipe registers `watchAction('message-reply-swipe')`.

Long press claims only when its existing 450ms timer fires. Reply claims only when its existing movement reaches 52px during touchmove.

`FPGesture135.claimAction()` already supports only one `session.action` and calls `cancelActions(..., 'claimed', winner)`. Therefore whichever existing recognizer reaches its own old condition first cancels the competing recognizer.

Reply must claim on touchmove rather than touchend because `FPGesture135` ends the touch session in the window capture phase before the message node receives its bubbling touchend.

If reply crosses 52px and then returns below 52px before release, the final old threshold still prevents `setSelectedReply()`. The long press remains cancelled and cannot revive after losing the gesture session.

## Ownership boundaries

`FPGesture135` contains no 450ms/12px/52px feature logic. It only arbitrates ownership.

`message-context.js` still owns long-press recognition and context opening. `app.js` still owns reply-swipe geometry and reply selection.

Regression: `npm run test:178:message-gesture-arbitration`.

Команда сначала выполняет статический contract guard, затем browser-harness со сценариями: long press wins, reply swipe wins, reply crossed threshold then returned below threshold without reviving long press.

Browser-harness использует synthetic Chromium touch. Physical touch/native browser gesture behavior still requires device acceptance.
