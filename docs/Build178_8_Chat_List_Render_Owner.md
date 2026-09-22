# Build 178.8 — FPChatList174 render entry ownership

Base: Build 178.7 on build/178-development.

## Proven bypass

FPChatList174 already owned the incremental row map and exposed idle()/snapshot(), but render callers still entered the scheduler directly through renderChats(). The manager therefore did not own the public render command.

## Minimal transfer

The existing renderChats implementation was renamed to renderChatList174 without changing its body.

FPChatList174 now exposes render: renderChatList174.

The legacy global entry remains for all existing callers, but is now a pure compatibility delegate:

renderChats() → FPChatList174.render().

## Preserved behavior

- chatRows174 remains keyed by roomId;
- an existing entry.row is reused and only its content/signature is updated;
- ordering moves the existing row object with insertBefore rather than replacing it;
- search still matches room name, roomId and lastMessage;
- the signature still includes room name, lastMessage, lastSender, unread, formatted time, mute, active room, nick, draft text and reply-draft presence;
- draft rendering, unread badge and last-message preview are unchanged;
- click, context-menu, touch/long-press and gesture handlers remain created only in createChatRow174().

Search filtering keeps its existing behavior, including removal/recreation when a row leaves and later re-enters the filtered result; 178.8 does not change that UX.

Regression: npm run test:178:chat-list-render-owner
