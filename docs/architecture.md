# FPChat Architecture (production-minded baseline)

## Monorepo domains
- `frontend/`: React PWA client, local encrypted cache, crypto layer, websocket client.
- `backend/`: NestJS API + gateway, Prisma(Postgres), Redis ephemeral states, secure media storage.
- `shared/`: common TS types/contracts.
- `docs/`: architecture, API and crypto flows.

## Security principles
1. Server stores only ciphertext for 1:1 messages.
2. Client-side media encryption before upload.
3. Refresh token rotation and revocable sessions.
4. Invite-only onboarding with activation limits.
5. DTO validation + throttling + upload limits.
6. No plaintext message/token/key logging.

## Backend layered modules
- auth, invites, users, chats, groups, messages, media, notifications, sessions.
- Each module has controllers/services/repositories/dto, plus gateway/crypto/storage where relevant.

## Realtime
- WebSocket namespace `/realtime`.
- Typing indicators and presence in Redis with TTL.
- Durable chat events persisted in Postgres, then emitted to socket rooms.

## Scale path
- Add outbox pattern + queue workers for notifications/media processing.
- Move encrypted object storage from local FS to S3-compatible storage abstraction.
- Introduce multi-device key bundles and group sender keys for group E2EE.