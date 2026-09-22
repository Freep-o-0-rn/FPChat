# Build 178.6 — reply and pin jump audit

Base: Build 178.5 on build/178-development.

Scope is only jump-to-message initiated by a reply and then by a pin. Saved-anchor opening was covered by 178.5; ordinary scrolling pages were covered by 178.4.

## Reply jump

Existing path:

findAndFocusReplyMessage(messageId)
→ check already mounted DOM
→ loadHistoryUntilMessage(messageId) when absent
→ FPHistory174.jump(Number(messageId))
→ jumpWindow(anchor)
→ transaction(history, view)
→ around(view, anchor, task.signal).

After the target is returned, the captured room view is revalidated before the existing scrollCoordinator.focus(target) behavior.

The long legacy loadHistoryUntilMessage loop remains only as compatibility fallback when FPHistory174 is absent. With the owner present, the function returns immediately to FPHistory174.jump().

## Pin jump

Both pin entry surfaces converge on jumpToMessage(messageId):

- pin-bar cycling: jumpToNextPinnedMessage() → jumpToMessage();
- pins screen item click → jumpToMessage().

jumpToMessage() closes the pins screen, waits one animation frame, and in the normal app path delegates to findAndFocusReplyMessage(messageId).

It contains no message-history fetch, no AbortController, no cursor, no history.loading and no second request/queue slot.

The direct scrollIntoView branch is only a defensive fallback if the app helper is unavailable; it does not load history and therefore cannot create a parallel history queue. Normal startup loads app.js before message-pins.js.

## Shared owner

Both reply and pin missing-target jumps use the existing FPHistory174.jumpWindow() transaction.

That transaction continues to:
- abort the previous history.request174;
- assign one new history.request174 controller;
- set the existing history.loading flag;
- bind cancellation to RoomContext;
- load with the existing around() primitive;
- reject stale results through task.current();
- release only its own transaction in finally.

No new history queue or jump-specific fetch path is introduced.

## Regression

npm run test:178:history-reply-pin-jump

It locks both entry paths and the common History174 transaction ownership. Runtime files are unchanged in 178.6.
