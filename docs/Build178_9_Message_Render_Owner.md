# Build 178.9 — one active incoming message render entry

Base: Build 178.8 on build/178-development.

## Proven ordering bypass

For an active incoming message that was not already mounted, processStableIncomingMessage() previously called appendMessage() before the later upsertRoomMessage(... source: ws) side-effect path.

appendMessage() already consulted FPMessageStore172, but its own source is render. Therefore the DOM template could be prepared before the stronger canonical WS content merge.

## Minimal transfer

Only that active incoming mount now enters FPMessageRender178.mountIncoming().

The entry performs:

1. canonicalizeIncomingMessageForMount178(roomId, message, text) using FPMessageStore172.upsert(... source: ws);
2. one call to the existing appendMessage(box, message, text, false, autoScroll).

The later upsertRoomMessage() calls remain in their old positions because they also own existing chat-list/unread side effects. This step does not move those effects.

## Content and template

appendMessage() remains the only message DOM template. It still performs its existing Store reconciliation and, when a canonical record exists, replaces renderText with storeResult.record.text before building the DOM.

message-actions.js still dynamically wraps appendMessage(), so tombstone/edit-label behavior is not bypassed.

No second HTML template, no second append and no new message queue were introduced.

Regression: npm run test:178:message-render-owner
