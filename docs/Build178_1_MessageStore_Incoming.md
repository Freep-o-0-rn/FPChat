# Build 178.1 — MessageStore incoming-source audit

Base: `177.26+hotfix` at `a494c5985cea6ce7d21f5ced4db2567417d27739`.

Scope is intentionally one writer only: the normal incoming WebSocket message path. No merge rule, status rank, tombstone rule, timestamp arbitration, render path or runtime behavior is changed in this step.

## Audited path

`handleStableWsPayload(message:new)`
→ `processStableIncomingMessage(roomId, message, deviceId)`
→ `upsertRoomMessage(roomId, message, patch)`
→ `FPMessageStore172.upsert(roomId, message, { source: 'ws', ... })`
→ one canonical room/message record.

The incoming path may call `upsertRoomMessage` more than once while calculating unread presentation, but identical message identity resolves back to the same Store record. This step does not change that behavior.

## Legacy cache result

`messageCache` is created from `FPMessageStore172.legacyCacheAdapter(...)`, not from an independent `Map` when the Store is available.

The adapter:

- reads canonical records through `Store.get`;
- writes preview metadata back into the same Store record;
- cannot let low-priority legacy metadata overwrite stronger WS content;
- deliberately refuses `delete()`;
- treats `clear()` as a compatibility no-op for canonical data.

Therefore, for the audited incoming source there is no second legacy message truth to migrate in 178.1.

The source still contains a defensive `|| new Map()` fallback, but Build 174 startup explicitly lists `message-store172.js` as an `app.js` dependency and preloads it before `app.js`. The regression locks this ordering so the fallback cannot silently become the normal runtime owner.

## Regression

`npm run test:178:message-store-incoming`

The regression verifies the actual incoming call path statically and executes the real `message-store172.js` in an isolated browser-like context. It asserts that repeated incoming updates preserve record object identity, room message count remains one, and the legacy adapter cannot create, replace, clear or delete independent state.

## Result

178.1 finds no proven Store bypass for the audited incoming writer. Runtime files are unchanged. Any different writer (history, ACK/echo, edit/delete, etc.) must be audited separately before 178.2 changes it.
