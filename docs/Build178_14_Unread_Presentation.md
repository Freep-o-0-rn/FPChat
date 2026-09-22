# Build 178.14 — unread divider, badge and first-unread navigation

Base: Build 178.13 on build/178-development.

## Proven regression risk

appendMessage() previously dismissed the unread-divider session whenever an outgoing message was mounted with autoScroll=true:

mine && autoScroll → dismissUnreadDivider(box).

This made the outgoing DOM mount itself a presentation-state reset, even though sending an outgoing message is not an actual-read event for earlier incoming messages.

178.14 removes only that direct dismiss. Existing outgoing requestBottom() and History174 trim('newer') remain unchanged.

## Divider

History174 continues to call syncUnreadDivider() after trim and finishMount. History pages are rendered with autoScroll=false, so merely mounting older/newer history does not dismiss the divider.

The divider continues to anchor to the existing session anchor, first mounted incoming unread, or server firstUnreadMessageId. No new divider model is introduced.

## Badge and pill

updateUnreadIndicators() remains unchanged:

loaded unread + unloadedUnreadCount → visibleCount → divider + new-message pill + chat-list unread + app/title badge presentation.

## First unread

FPHistory174.goToUnread() remains unchanged.

When unread exists outside the mounted window, it asks the existing history endpoint for firstUnreadMessageId, resolves/jumps to that message and focuses it.

When unread is already mounted, it focuses the first .msg[data-read="0"][data-incoming="1"].

goToUnread() does not call markMessageRead(); actual read still occurs only through the existing read admissions when the target becomes genuinely visible/interacted with.

## Delivery and push are not read

Delivery still uses message:received / message:received:bulk and the server transition sent → delivered. The DOM read flag is changed only when normalized status is read.

sendPushForMessage() only sends a Web Push notification. It does not call markReadBulk, markMessageReceived or broadcast status=read. The service worker only displays/focuses/opens the notification target.

Regression: npm run test:178:unread-presentation
