# Follow-up plan item 13 — same-session MessageStore reuse

Date: 2026-09-28

Status: **complete**.

## Scope

Only this scenario was optimized:

`chat -> list -> the same chat`

inside the same browser page/session.

No persistent message cache was added.

## Access remains mandatory

Every reopen still goes through the existing:

`POST /api/rooms/:publicId/join`

before any RAM state can be reused.

A 403/404 therefore stops the open before cached messages render.

The item does not infer access from MessageStore.

## Reuse contract

`FPMessageStore172` gained two small in-memory capabilities:

- `markRendered(roomId)`;
- `reuseWindow(roomId, serverMessages)`.

A room becomes eligible only after one successful render in the current page
session.

The new reuse path does **not** choose the history window.

The server join response from item 12 still chooses the authoritative current
window, unread state, saved view state and cursors.

MessageStore only supplies canonical already-decrypted records for those exact
server-selected message ids.

The whole window is reused only if every input message has a safe canonical
record.

Safe means one of:

- encrypted/content metadata matches the server message;
- canonical edit/delete state has stronger precedence and is at least as new.

If one record is missing or unsafe, `reuseWindow()` returns `null` and the
existing decrypt/render path is used for the whole window.

This avoids constructing a second history/window owner in MessageStore.

## Render path

On a fully reusable window, `renderChatView()` uses the canonical plaintext
already held by MessageStore instead of decrypting the same ciphertext again.

`appendMessage()` remains the rendering merge boundary, so existing status,
edit and delete precedence is preserved.

After a successful render the room is marked reusable for later same-session
reopens.

## Edit synchronization

Regression flow:

1. open room and populate MessageStore;
2. return to chat list;
3. edit a message through the existing server edit API;
4. let the existing WebSocket/message-actions synchronization update MessageStore;
5. reopen the same chat.

No test writes the edit directly into MessageStore.

Verified:

- MessageStore receives the edit while the room is not active;
- canonical source remains `edit`;
- reopen renders edited text;
- the fully matching repeat window performs **0 message decrypts**.

If the WS event is delayed, the regression uses the existing lifecycle foreground
event, which invokes the already-existing message-actions synchronization.

No new sync loop was added.

## Delete synchronization

A message is deleted-for-all while on the list through the existing API.

Verified:

- current message-actions/WS sync writes the canonical tombstone;
- the deleted message does not reappear on reopen;
- the canonical MessageStore record remains deleted.

The first exploratory regression assumed deletion must always force a decrypt
fallback. That assumption was wrong: current sync had already loaded the adjacent
message that entered the new tail page, so the complete post-delete window was
still safely available in RAM.

The regression was corrected to test the actual contract instead:

- safe complete windows may still be reused after deletion;
- an artificial window containing one unknown id is rejected;
- the first open confirms the legacy decrypt path remains active when reuse is
  unavailable.

Historical failed workflow:

`36433728539`

This was a test-assumption failure, not a product failure.

## Revoked access

A room is first opened and stored in RAM, then its participant access is revoked
in the isolated SQLite fixture.

On reopen:

- one normal join request is still sent;
- the server returns the access rejection;
- no MessageStore window is rendered;
- no message decrypt is performed;
- active room remains null;
- existing local broken-room cleanup runs.

Therefore RAM reuse cannot bypass authorization.

## Unread state

Unread metadata is never sourced from MessageStore reuse.

The reopen uses the fresh join response for:

- `unreadCount`;
- `firstUnreadMessageId`;
- selected initial window.

Regression verifies the current first-unread target is respected on reopen and a
larger stale unread count is not reused from RAM.

Existing unread regressions remain green.

## Reading position

Saved reading position remains server/view-state + FPScroll173 owned.

Regression:

1. opens a saved-position room;
2. moves the current reading position using FPScroll173;
3. saves the existing view-state;
4. returns to the list;
5. reopens;
6. verifies the saved anchor is mounted and restored to the stored pixel offset.

No scroll write was added outside FPScroll173.

## Benchmark

Five independent room pairs were used.

Each pair:

1. fresh page;
2. same 300-message synthetic room;
3. first tail open;
4. chat -> list;
5. repeat open of that same room.

Both first and repeat open still execute the normal join access request.

Environment:

- isolated Linux headless Chromium;
- local SQLite;
- no network throttling;
- 100 initial tail messages;
- 5 pairs.

### First open

Raw:

`183.5, 183.9, 184.0, 184.6, 198.1 ms`

Median:

**184.0 ms**

Range:

**183.5–198.1 ms**

Message decrypts:

**100 median**

### Repeat open

Raw:

`136.0, 136.0, 136.5, 138.2, 152.8 ms`

Median:

**136.5 ms**

Range:

**136.0–152.8 ms**

Message decrypts:

**0**

### Delta

Median:

**-47.5 ms**

Relative:

**-25.82%**

Repeated message decrypt work:

**100 -> 0**

This is a local CPU/render benchmark, not a physical-device or production-network
prediction.

Only five pairs were measured, so no p95 is reported.

## Final CI

Workflow:

`36434066515` — **SUCCESS**

Artifact:

- id `10974732044`;
- digest `sha256:ea1052f8d00068c85fa60e1e21df3eed614a8a12d2e10a2daec25f37cbdfa4a4`.

Runtime measured:

`43d05dbffe20f2bff779f9683aaf194b3f4e0cd2`

Build:

**190.2**

Passed:

- `test:next:7`;
- `test:next:13`;
- `test:next:12`;
- `check:170`;
- `test:178:message-store-incoming`;
- `test:178:message-store-ack`;
- `test:179:explicit-message-actions`;
- `test:178:history-saved-anchor`;
- `test:178:unread-restore-bottom`;
- `test:180:single-owner-audit`;
- `bench:next:13`.

## Files changed

Runtime:

- `public/message-store172.js`;
- `public/app.js`;
- `public/version.json` only to keep the existing app.js content-revision
  contract valid.

Regression/benchmark:

- `scripts/regression-next13-session-reuse.cjs`;
- `scripts/benchmark-next13-session-reuse.cjs`;
- `package.json`.

Documentation:

- this report;
- `docs/performance-next13-session-reuse-summary.json`;
- `docs/performance-progress.md`.

No server API, DB/schema, persistent message cache, Service Worker, updater,
RoomContext owner, FPHistory owner, FPScroll owner, send queue or WebSocket owner
was added or replaced.

## Rollback

Revert the item-13 MessageStore/app changes, restore the previous appRevision and
remove the item-13 tests/docs.

No data migration or persistent cache cleanup is required.

## Continuation

Item 13 is complete.

Do not start item 14 automatically.
