# Build 178.7 — bounded DOM with new and pending messages

Base: Build 178.6 on build/178-development.

No runtime defect was found in the normal owner path, so runtime files are unchanged.

FPHistory174 remains LIMIT=300 and PAGE=100. trim() evicts DOM only.

Unread is preserved by computing mounted unread + unloadedUnreadCount before eviction and recalculating unloadedUnreadCount after eviction. Deferred new incoming messages increment unloadedUnreadCount only when they are not duplicate and not already read.

Selection is preserved on the normal FPDOM173 path because History174 marks evicted nodes with fpEvicted174 before removal, and message-selection.js ignores that unmount for selection identity. Canonical deletion remains separate and can remove an offscreen selected id through the MessageStore event.

Pending optimistic text messages are not DOM-owned. FPMessageStore172 retains records that have clientMessageId but no numeric id, History174.pending() reads them from Store, and pendingTextSends owns retry state.

On ACK, promoteMessageElement() updates FPMessageStore172 before it looks for an optional DOM node. Therefore eviction of the optimistic node does not lose clientMessageId → numeric id promotion or stronger status.

Regression: npm run test:178:bounded-dom
