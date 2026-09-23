# Build 179.5 — loader interception removed

Build 179.4 completed all migrations first: T1–T7 are direct server code and I1–I10 are explicit installer calls in the historical order.

179.5 then removes the loader mechanism itself.

- production entry is now `node server.js`;
- `src/message-actions-bootstrap.js` remains only as a no-op compatibility shim for the old preload command;
- it no longer touches `Module._extensions`, reads/rewrites `server.js`, or calls `module._compile`;
- `server.js` contains one `server.listen()` site and one cleanup startup interval;
- old manual entry `node -r ./src/message-actions-bootstrap.js server.js` loads the no-op shim and then the same explicit `server.js`, so it does not create a second startup path.

Acceptance:
- `npm run test:179:1794` — item-by-item explicit composition checks;
- `npm run test:179:loader-readiness` — zero interception/one startup static gate;
- `npm run test:179:1795` — final composition plus spawned direct-vs-legacy entry smoke comparison.
