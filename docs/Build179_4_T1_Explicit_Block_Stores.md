# Build 179.4 — T1 explicit block stores

The bootstrap T1 source patch is removed. `server.js` now explicitly creates the same single `fpUserBlocks165` and `fpBlockedInviteEvents165` instances immediately after `createDb(DATABASE_PATH)`.

No guard using those stores is moved in this commit. T2–T7 therefore continue to receive the same identifiers when the bootstrap compiles `server.js`.

Acceptance: `npm run test:179:explicit-block-stores`.
