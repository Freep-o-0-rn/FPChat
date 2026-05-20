# REST API (v1)

## Auth
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

## Invites
- `POST /api/v1/invites`

## Users
- `GET /api/v1/users/me`
- `GET /api/v1/users/search?nickname=@ni`

## Chats / Groups
- `GET /api/v1/chats`
- `POST /api/v1/chats/direct`
- `POST /api/v1/groups`

## Messages
- `POST /api/v1/messages`
- `GET /api/v1/messages?chatId={chatId}&cursor={messageId}`

## Media
- `POST /api/v1/media/upload` (multipart, encrypted blob)

## Sessions
- `GET /api/v1/sessions`
- `DELETE /api/v1/sessions/:id`