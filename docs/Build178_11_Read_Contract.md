# Build 178.11 — existing delivery/read/unread contract

Base: Build 178.10 on build/178-development.

This step documents and locks the current behavior. It does not introduce ReadStateManager behavior yet and does not change the status model.

## 1. Delivery

Delivery means the recipient client has received a server-backed message; it does not mean the user has read or even viewed it.

Existing client path:

markMessagesReceived(roomId, deviceId, ids)
→ queueReceivedMessageIds()
→ flushPendingReceived()
→ message:received or message:received:bulk.

The server validates the recipient and calls markMessageReceived(). When the DB transition succeeds it broadcasts message:status with status=delivered.

Incoming messages with status=sent are acknowledged as received from the existing initial/history/incoming paths. This is independent of IntersectionObserver visibility.

## 2. Actual read admission

The canonical client handler remains markMessageRead(messageId). It returns without changing read state unless all of these are true:

- messageId is a valid positive number;
- there is an active room and activeChatDeviceId;
- document.visibilityState is visible;
- the current #messages box contains that exact message node;
- the node is incoming;
- the node is not already read.

When admitted, the existing handler:

- records the local unread event;
- sets the DOM node data-read=1;
- updates canonical MessageStore status to read;
- removes IntersectionObserver tracking;
- removes the id from pendingIncomingReadIds;
- delegates transport to markIncomingMessagesRead();
- recomputes unread presentation.

### Existing visibility/user-entry paths

IntersectionObserver is one normal admission path. It is rooted at #messages with threshold 0.2 and only delegates intersecting incoming unread nodes while the document is visible.

Observation is suspended during initial positioning through initialMessagesScrollPending, then resumed after initial scroll/layout is settled.

There are also existing explicit paths that deliberately call the same markMessageRead() handler:

- reply target interaction through markReplyTargetRead();
- clicking incoming media;
- a newly appended incoming message when the chat was already near bottom.

These are existing Build 168/172–174 semantics. 178.11 does not reinterpret them as a new visibility rule.

## 3. Read pending and flush

pendingReadQueue is per room and stores:

- deviceId;
- Set of message ids;
- sentAt;
- retryTimer.

queueReadIds() deduplicates IDs in the existing Set and resets the pending send timestamp/timer.

flushPendingReads() sends only when:

- roomId/deviceId exist;
- the room has pending IDs;
- WebSocket is OPEN;
- WebSocket deviceId matches the read queue deviceId.

The current resend behavior is preserved:

- a send made less than 1000 ms ago is not duplicated;
- transport is message:read:bulk;
- retry timer is 1500 ms;
- failed send leaves the queue pending.

The server validates each ID, ignores messages authored by the reader, marks read in DB, broadcasts message:status status=read, then sends the updated unread state to the reading device.

When the client receives status=read, handleWsMessageStatus() calls acknowledgeRead(). That removes the ID from the existing pendingReadQueue; if IDs remain, the queue is made sendable again, otherwise its timer and room entry are removed.

## 4. Unread presentation

Unread presentation is not a delivery/read transport state.

Mounted unread is recomputed from DOM nodes matching incoming=1 and read=0. Offscreen/bounded-window unread remains in activeChatHistory.unloadedUnreadCount.

updateUnreadIndicators() combines mounted + unloaded unread and then updates:

- unread divider;
- new-messages pill;
- chat-list unread count;
- title/app badge through the existing presentation flow.

History defer increments unloadedUnreadCount for a new, non-duplicate incoming message whose status is not already read.

Push receipt, message delivery and history mount do not create a new read state in this model.

## Status model

The existing status order remains exactly:

sending < sent < delivered < read.

No additional status, visibility state, pending queue or timestamp rule is introduced in 178.11.

Regression: npm run test:178:read-contract

No runtime file is changed in 178.11.
