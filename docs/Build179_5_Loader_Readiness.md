# Build 179.5 readiness gate — loader removal is not ready

179.5 requires loader interception to be removed **only after the last bootstrap dependency has been migrated explicitly**.

Current state after Build 179.4 is not ready.

## Already explicit

- I1 `installMessageActionsServer`
- I2 `installMessagePinsServer`

## Still bootstrap-installed

1. I3 `installTypingServer`
2. I4 `installUsernameServer`
3. I5 `installSystemEventsServer`
4. I6 `installStorageStats168`
5. I7 `installUserBlocks165Server`
6. I8 `installUserBlockEventActions165`
7. I9 `installChatRequestsServer`
8. I10 `installVoiceServer`

## Still source-patched

- T1 database user-block / blocked-invite-event initialization
- T2 participant presence DTO at two sites
- T3 presence broadcaster
- T4 `message:send` block guard
- T5 `message:new` block guard
- T6 encrypted media upload block guard
- T7 invite/join block guard + blocked-invite event

Therefore the current production entry must remain:

`node -r ./src/message-actions-bootstrap.js server.js`

and `Module._extensions['.js']` interception must remain active.

Removing either now would silently remove live server features/guards and violate 179.5.

## Gate

`npm run test:179:loader-readiness` freezes this precondition. It must be intentionally updated as 179.4 migrates each remaining item. Actual 179.5 loader removal is allowed only when both sets become empty.

No runtime file is changed by this readiness step.
