# Build 179.3 — explicit message-actions installation

Selected minimal slice: **I1 `installMessageActionsServer`**.

179.2 froze I2 message pins, but I2 cannot safely be the first explicit installer because it depends on I1 creating/extending `messages.deleted_for_all` and `message_hidden`. Moving I2 before the still-injected I1 would change startup order and can fail schema preparation.

## Change

`server.js` now imports `installMessageActionsServer` explicitly and calls it once immediately before the existing cleanup/listen startup marker.

In the same commit, `src/message-actions-bootstrap.js` removes only the old injected I1 call. I2–I10 remain in the bootstrap install block.

Effective order remains:

`base server routes/listeners → explicit I1 → injected I2 → I3 → ... → I10 → cleanupExpiredSoloRooms() → cleanup interval → server.listen()`.

## Guard preservation

I1 historically has no `__fp...Installed` flag. 179.3 does not invent one. Its existing dependency assertion is unchanged.

Single-install safety is structural:

- exactly one I1 call exists in `server.js`;
- zero I1 calls remain in bootstrap;
- I2 remains the first injected installer;
- T1–T7 textual patches are unchanged;
- I2–I10 remain injected once and retain their previous relative order.

## Regression

`npm run test:179:explicit-message-actions` verifies the explicit import/call, exact dependency list, execution before the injection marker, zero bootstrap I1 calls, unchanged I1 dependency guard, unchanged T1–T7 guards, and exactly nine remaining injected installers.

`test:179:bootstrap-inventory` is adjusted only for this intentional ownership move; the historical inventory remains in the 179.1 document and git history.
