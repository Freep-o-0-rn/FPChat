# Build 178.4 — ordinary HistoryManager page-load owner

Base: Build 178.3 on `build/178-development`.

Scope is only the ordinary older/newer page-loading path. Saved-anchor loading and reply/pin jumps remain out of scope for 178.5 and 178.6.

## Audit result

No runtime ownership bypass was found in the normal supported startup path, so runtime files are unchanged.

The normal UI entry is:

`FPHistory174.mounted(box)`
→ scroll threshold
→ `FPHistory174.load('older' | 'newer')`
→ `transaction(history, view)`
→ `page(view, { before | after: cursor }, task.signal)`.

`app.js::loadOlderMessages()` remains a compatibility fallback, but when `FPHistory174` exists its first action is an immediate return to `FPHistory174.load('older')`. Build 174 startup declares `history174.js` as an `app.js` dependency and executes it before `app.js` on the successful normal path.

## Preserved rules

### Cursor

Older pages continue to use `history.nextCursor` with `before=<cursor>`.
Newer pages continue to use `history.newerCursor` with `after=<cursor>`.

The existing `data.nextCursor || cursor` fallback is unchanged.

### Order

The page response is filtered only for already-mounted message IDs. The ordinary path does not sort or reverse `data.messages` before `render()`.

Older fragments are inserted before the first mounted message; newer fragments are appended.

### Cancellation

`page()` checks the captured RoomContext/view before and after network work.
`transaction()` binds its AbortController to the captured RoomContext signal.
A new transaction aborts the previous `history.request174`.
Results are mounted only while `task.current()` still matches the same active history, request controller and non-aborted room context.

### One active load

The existing `history.loading` guard rejects another ordinary load while one is active.
`history.request174` remains the single active request slot.
`task.finish()` clears loading/request only when it still owns that exact controller.

No second history queue, request slot, cursor model or retry mechanism is introduced.

## Regression

`npm run test:178:history-page-owner`

The test locks the normal entry, cursor arguments, response ordering, stale-room cancellation and single-request ownership without changing runtime behavior.
