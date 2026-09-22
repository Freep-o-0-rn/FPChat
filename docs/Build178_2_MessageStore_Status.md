# Build 178.2 — remove the independent legacy message-status truth

Base: Build 178.1 on `build/178-development`.

## Proven bypass

`app.js` still contained `messageStatusByKey = new Map()` plus `messageStatusKey()`. This was a second status store outside `FPMessageStore172`.

The normal Build 174 startup already guarantees `message-store172.js` before `app.js`, so this fallback is not required as the normal owner. Keeping it nevertheless leaves a latent independent truth that can diverge from the canonical Store if the fallback path is ever entered.

178.2 removes only that independent status map and its key helper.

## Preserved path and arguments

No MessageStore merge logic is changed.

`rememberMessageStatus(roomId, messageId, status, clientMessageId)` still normalizes status and calls:

`FPMessageStore172.updateStatus(roomId, messageId, normalized, clientMessageId)`.

`handleWsMessageAck()` still calls the same status helper and then:

`promoteMessageElement(roomId, messageId, clientMessageId, status, createdAt)`

which still delegates identity promotion to:

`FPMessageStore172.promote(roomId, clientMessageId, messageId, { status, createdAt })`.

When the Store is unexpectedly unavailable, the functions now return the normalized payload status instead of creating a second mutable status database. The normal supported startup path is unchanged because the Store is loaded first.

## Explicitly unchanged

- `STATUS_RANK` in `FPMessageStore172`;
- `SOURCE_PRIORITY`;
- `strongerStatus()`;
- content clocks/timestamps;
- tombstone behavior;
- edit/delete merge rules;
- ACK retry/pending queue;
- DOM status rendering;
- `liveMessageKeys` dedupe (it is not message content/status truth).

## Regression

`npm run test:178:message-store-ack`

It covers the required cases:

- optimistic → ACK → numeric ID;
- echo before ACK;
- numeric ID after remount without duplicate canonical record;
- weaker late status cannot beat stronger status;
- stale history cannot overwrite edit;
- stale history cannot resurrect delete.

Only `app.js` status fallback ownership changes in this step. `message-store172.js` remains byte-for-byte unchanged.
