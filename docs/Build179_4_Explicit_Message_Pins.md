# Build 179.4 — explicit message-pins installation

Selected inventory item: **I2 `installMessagePinsServer`**.

I2's full HTTP/WS/SQLite behavior was frozen in Build 179.2. Build 179.3 made its prerequisite I1 message-actions explicit first.

## Change

`server.js` now imports `installMessagePinsServer` and calls it exactly once immediately after explicit `installMessageActionsServer`.

In the same commit, only the old injected I2 call is removed from `src/message-actions-bootstrap.js`.

Effective startup order:

`base server → explicit I1 message-actions → explicit I2 message-pins → injected I3 typing → I4 ... I10 → cleanup → listen`.

## Preserved contract

- I2 still has no installer-local `__fp...Installed` flag;
- its existing dependency assertion is unchanged;
- I1 still executes before I2, preserving `deleted_for_all` and `message_hidden` prerequisites;
- the four HTTP routes remain defined only by `src/message-pins-server.js`;
- the 179.2 HTTP status/body, `pins:changed` WS payload/scoping and `message_pins` DB contract are unchanged;
- T1–T7 textual guards are untouched;
- I3–I10 remain bootstrap-installed once and in prior relative order.

## Acceptance

`npm run test:179:explicit-message-pins` checks composition/ordering and duplicate-install prevention.

`npm run test:179:pins-contract` remains the behavioral acceptance for HTTP + WS + SQLite effects.

No other extension is migrated in this commit.
