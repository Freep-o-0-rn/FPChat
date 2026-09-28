# Follow-up plan item 11 — optional initial history window

Date: 2026-09-28

Status: **complete**.

This item adds server capability only. The client is not switched to it.

## Goal

Item 10 confirmed that a non-tail room open receives the latest 100 messages inside
`POST /api/rooms/:publicId/join`, then discards that page and fetches the real
window around first unread or a saved anchor.

Item 11 adds an opt-in, backward-compatible join mode that can return the required
initial window directly.

## API contract

Existing request, unchanged:

```json
{
  "displayName": "...",
  "deviceId": "..."
}
```

continues through the legacy branch and returns the latest history page with the
existing shape. It does not gain `initialWindow`, `hasNewer`, or
`newerCursor`.

New opt-in request:

```json
{
  "displayName": "...",
  "deviceId": "...",
  "initialWindow": true
}
```

asks the server to choose the initial history target.

An older server safely ignores the unknown request field, so the request itself is
backward-compatible. Client-side old-server detection/fallback belongs to item 12
and was not implemented here.

## Server target priority

The new mode resolves the target on the server after the normal room/device access
check:

1. first unread, when the existing unread queries return one;
2. saved view-state anchor when `atBottom=false`;
3. current tail when neither target is available.

Every selected numeric target is revalidated with the current
`q.findMessageInRoom`.

Therefore a stale/deleted-for-all saved anchor does not become an around-window
target.

## Window construction

No new DB schema, table, index, cache, history store, or owner was added.

The server reuses the existing history helpers:

- older side: `getMessageHistoryPage(... before=target+1 ...)`;
- newer side: `getMessageSyncPage(... after=target ...)`;
- page limit remains `HISTORY_PAGE_SIZE = 100` per side.

The result is deduplicated by message id and sorted ascending.

Maximum normal around-window size is therefore 200 messages, matching the current
client-side FPHistory174 around behavior.

For an around window the response includes:

- `messages`;
- older `hasMore` and `nextCursor`;
- newer `hasNewer` and `newerCursor`;
- merged reaction summaries;
- `initialWindow.version = 1`;
- `initialWindow.mode = "around"`;
- `initialWindow.source = "first-unread" | "saved-anchor"`;
- `initialWindow.targetMessageId`;
- one small `initialWindow.latestMessage` record so a future client switch can
  retain a real tail identity without reloading the latest 100.

When the requested mode has no valid target, the server falls back to the legacy
tail page and returns:

- `initialWindow.mode = "tail"`;
- `initialWindow.source = "tail"`;
- `targetMessageId = null`.

## Preserved access / unread / delete behavior

The existing join access check still runs before initial-window work.

Unknown/revoked devices still receive HTTP 403 with `ACCESS_REVOKED`.

Unread state continues to use the established:

- `q.countUnreadForParticipant`;
- `q.findFirstUnreadForParticipant`.

The deletion-aware unread queries therefore skip a deleted-for-all unread and
select the next visible unread.

Saved targets are revalidated through the current deletion-aware
`q.findMessageInRoom`; a deleted-for-all stale target falls back to tail.

No read status is mutated by selecting the initial window.

## Cursor behavior

Regression coverage verifies both directions from an around response:

- `GET /messages?before=<nextCursor>` continues strictly older;
- `GET /messages?after=<newerCursor>` continues strictly newer.

Existing ordering and page-size rules remain unchanged.

## Regression

New test:

`scripts/regression-next11-initial-window.cjs`

Package command:

`npm run test:next:11`

The test uses one isolated synthetic 500-message room and verifies:

- legacy join without the flag still returns latest 100 with the old shape;
- first unread wins over saved anchor;
- around window is bounded and ascending;
- target is included while remote tail is absent;
- older/newer cursors continue correctly;
- no saved anchor falls back to tail;
- deleted-for-all stale anchor falls back to tail;
- deleted unread is excluded and the next unread wins;
- access rejection remains 403.

## Final CI

Workflow run:

`36426325098` — **SUCCESS**.

Passed:

- `node --check server.js`;
- `npm run test:next:11`;
- `npm run test:178:history-page-owner`;
- `npm run test:178:history-saved-anchor`;
- `npm run test:178:unread-restore-bottom`;
- `npm run test:188.1`;
- `npm run test:180:single-owner-audit`.

## Existing stale/flaky checks observed

Two failures encountered during exploratory CI were not caused by item 11 and were
not changed here.

`test:179:history-read-owner` contains a stale exact-source fingerprint expecting:

`return fpHistoryRead179.readPage(...)`

while the pre-item-11 server already used:

`const page = fpHistoryRead179.readPage(...)`

to add reaction summaries.

`test:188.2` failed on reaction-key ordering
`heart,fire` vs `fire,heart`; the item-11 path was not invoked in that
assertion and the reaction foundation test passed.

Neither unrelated regression source was edited in item 11.

## Files changed

Runtime/server:

- `server.js` — optional server-side initial-window capability only.

Regression:

- `scripts/regression-next11-initial-window.cjs`;
- `package.json` — `test:next:11`.

Documentation:

- this report;
- `docs/performance-progress.md`.

No client `public/*` file, RoomContext, FPHistory174, FPScroll173, MessageStore,
WebSocket owner, database schema, Service Worker, updater, or build number changed.

## Rollback

Revert the item-11 changes in:

- `server.js`;
- `scripts/regression-next11-initial-window.cjs`;
- the `test:next:11` package script;
- item-11 documentation.

Because the new server path is opt-in and no client sends the flag yet, rollback
requires no data migration or client cleanup.

## Continuation

Item 11 is complete.

Do not start item 12 automatically.
