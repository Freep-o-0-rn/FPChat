# Build 179.8 — read-only history DB diagnostics

Selected hot DB path: `getMessageHistoryPage(roomId, beforeCursor, limit)` used by room open/join history and `GET /api/rooms/:publicId/messages` when `after` is not supplied.

179.8 is diagnostics-only. `server.js` and `src/db.js` are unchanged.

## Current SQL

Base projection:

`SELECT m.id, m.type, m.client_message_id, m.ciphertext, m.iv, m.reply_to_message_id, m.status, m.event_type, m.event_actor_name, m.created_at, m.delivered_at, m.read_at, p.display_name as sender_name, p.device_id as sender_device_id FROM messages m JOIN participants p ON p.id = m.sender_id`

Latest page:

`... WHERE m.room_id=? ORDER BY m.id DESC LIMIT ?`

Parameters: `[roomId, safeLimit + 1]`.

Before-cursor page:

`... WHERE m.room_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?`

Parameters: `[roomId, beforeCursor, safeLimit + 1]`.

`safeLimit` defaults to 100 and is clamped to 1..100. The extra row is used only to derive `hasMore`.

## Execution order

1. normalize limit;
2. execute exactly one latest/before page SELECT;
3. `hasMore = rows.length > safeLimit`;
4. `rows.slice(0, safeLimit).reverse()` so response returns ascending message order;
5. `serializeMessages(pageRows)`;
6. `hydrateMessages` performs `listMediaByMessageId(messageId)` once for every returned message whose `type === 'media'`;
7. timestamps are normalized by `serializeMessages`.

Media hydration SQL:

`SELECT id, public_id, mime_type, media_kind, size_bytes, encrypted_size_bytes, width, height, duration_seconds, file_order FROM media WHERE message_id=? ORDER BY file_order ASC, id ASC`

Parameters: `[messageId]`, once per media message. This is the currently observed N+1 shape; 179.8 does not optimize it.

## Transaction boundary

`getMessageHistoryPage`, `serializeMessages` and `hydrateMessages` are not wrapped by `db.transaction()`. The current application code therefore has no explicit multi-query transaction around page SELECT + media hydration. Each prepared SELECT executes under normal SQLite read/autocommit behavior.

The diagnostic command records `db.inTransaction` before the page query, after it and after media hydration. It does not introduce a transaction.

## Existing schema/index state

Relevant current explicit message indexes are the unique partial indexes for `(room_id, sender_id, client_message_id)` and system-event uniqueness. There is currently no dedicated index introduced by 179.8 for `(room_id,id)` history pagination or `media(message_id,...)` hydration.

No schema/index change is made in this step.

## Safe diagnostic command

`npm run diag:179:history-db`

Required environment:

- `FPCHAT_DIAG_DB` — existing SQLite path;
- `FPCHAT_DIAG_ROOM_ID` — numeric internal room id;
- optional `FPCHAT_DIAG_BEFORE`;
- optional `FPCHAT_DIAG_LIMIT`.

The script opens SQLite with `readonly:true`, `fileMustExist:true`, enables `query_only`, and runs only SELECT/EXPLAIN QUERY PLAN. It reports SQL, bound parameter values, order, timings, query plans, result counts and transaction state.

Regression: `npm run test:179:history-db-read-path`.
