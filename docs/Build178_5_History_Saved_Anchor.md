# Build 178.5 — saved anchor window and pixel-offset audit

Base: Build 178.4 on `build/178-development`.

Scope is only opening a chat around the previously saved view-state anchor. Reply and pin jumps are intentionally left for 178.6.

## Audit result

No runtime defect or independent owner was found, so runtime files are unchanged.

### Target selection

The existing opening priority remains:

1. first unread message, when unread exists;
2. otherwise a saved `viewState.anchorMessageId`, unless `atBottom` was saved;
3. otherwise the bottom of the conversation.

Thus 178.5 does not change the established “first unread / saved position / bottom” behavior.

### Loading around a missing saved anchor

`openChatWithJoinData()`
→ `hydrateHistoryForInitialPosition()`
→ `FPHistory174.hydrate(view, data)`.

If the selected anchor is not in the initial seed, `hydrate()` calls:

`around(view, anchor, view.context.signal)`.

The existing around-loader requests:

- older: `before = anchor + 1`, which includes the anchor itself under the existing integer-ID API;
- newer: `after = anchor`.

The two halves are deduplicated by numeric ID and sorted ascending before becoming the initial window. The captured RoomContext is checked before the result is applied.

### Pixel offset

Saving uses:

`anchorOffsetPx = round(message.top - messagesBox.top)`.

The server stores `anchor_message_id` and `anchor_offset_px` and returns them as `anchorMessageId` / `anchorOffsetPx`.

After the initial messages are rendered, the existing scroll owner waits for media/thumb layout stabilization and restores with:

`scrollTop + message.top - box.top - anchorOffsetPx`.

This returns the saved anchor to the same visible pixel offset even if preceding content changed height while the room was opening.

All scroll writing remains inside `FPScroll173.write()`.

## Regression

`npm run test:178:history-saved-anchor`

The guard locks:

- unread priority over saved anchor;
- saved anchor selection;
- `FPHistory174.around()` arguments and ascending order;
- stale-room cancellation;
- exact anchor-node lookup;
- server pixel-offset round trip;
- layout wait before geometry;
- save/restore coordinate symmetry;
- use of `FPScroll173.write()` rather than a second scroll writer.

No history queue, jump behavior, cursor model or viewport implementation is changed in 178.5.
