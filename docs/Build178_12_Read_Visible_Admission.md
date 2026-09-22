# Build 178.12 — visible-message admission wrapper

Base: Build 178.11 on build/178-development.

Scope is only the IntersectionObserver admission into the existing markMessageRead() handler.

## Before

The observer callback directly repeated visibility/intersection/incoming/read checks and then called markMessageRead().

## After

The observer keeps the same root (#messages) and threshold (0.2), but each entry delegates to:

FPReadState178.admitVisible(entry, box).

The wrapper admits a read only when:

- initialMessagesScrollPending is false;
- document.visibilityState is visible;
- room/device read context exists;
- IntersectionObserver reports the entry as intersecting;
- entry.target still belongs to the current #messages box;
- entry.target is still connected;
- the node is incoming;
- the node is not already read.

Only then does it call the unchanged markMessageRead(messageId).

## Why the extra current-node guards

IntersectionObserver callbacks may arrive after disconnect/remount. The wrapper rejects an old target that is no longer in the current messages box, preventing a stale observer callback from marking a replacement/current message read by shared ID.

initialMessagesScrollPending explicitly protects the initial render/positioning period so a node is not admitted before the existing initial-scroll logic has declared the chat ready for unread observation.

## Explicit existing read paths

178.12 intentionally does not move:

- markReplyTargetRead();
- incoming media click;
- active incoming near-bottom read;
- markMessageRead() itself;
- pendingReadQueue;
- flushPendingReads();
- message:read:bulk.

Those remain exactly as documented in 178.11.

Regression: npm run test:178:read-visible-admission
