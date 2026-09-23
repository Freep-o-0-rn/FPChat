# Build 179.9 — explicit history SQL owner

179.8 showed that a history page consists of one latest/before message SELECT plus one media SELECT for every returned media message, previously without a common explicit transaction.

A thin `FPHistoryRead179` adapter is now used because this path benefits from a single consistent read snapshot.

## Ownership

`src/history-read179.js` receives the already-prepared `q.listMessagesLatest` and `q.listMessagesBefore` statements. It does **not** call `db.prepare`, duplicate SQL strings, open another database connection, create a pool, cache rows or modify schema.

For each `readPage` call it executes exactly one `db.transaction(...)`:

1. call the same latest or before prepared statement with `safeLimit + 1`;
2. calculate `hasMore`;
3. `slice(0, safeLimit).reverse()`;
4. invoke the existing `serializeMessages(pageRows)` inside the same transaction;
5. existing `hydrateMessages` therefore performs the same `q.listMediaByMessageId.all(messageId)` N+1 queries inside that transaction;
6. return the same `{messages, hasMore, nextCursor}` shape.

## Unchanged

- exact MESSAGE_SELECT projection;
- latest SQL and bind order `[roomId, safeLimit + 1]`;
- before SQL and bind order `[roomId, beforeCursor, safeLimit + 1]`;
- media hydration SQL and `[messageId]` parameter;
- page order and nextCursor semantics;
- N+1 query count;
- sync/`after` path;
- schema and indexes.

## Explicitly not added

- ORM;
- second SQLite connection/pool;
- cache;
- new prepared statement;
- new index/schema.

The 179.8 readonly diagnostic is updated to mirror the new single read transaction while remaining `readonly + query_only`.

Acceptance: `npm run test:179:history-read-owner` or `npm run test:179:1799`.
