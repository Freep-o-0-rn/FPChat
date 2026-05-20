# WebSocket events (`/realtime`)

## Client -> Server
- `chat:join` `{ chatId }`
- `typing:start` `{ chatId, userId }`
- `typing:stop` `{ chatId, userId }`

## Server -> Client
- `typing:update` `{ chatId, userId }`
- `message:new` `{ chatId, messageId, senderId, createdAt }` (planned in message pipeline)
- `message:delivery` `{ messageId, userId, status }` (planned)
- `presence:update` `{ userId, online, lastSeenAt }` (planned)