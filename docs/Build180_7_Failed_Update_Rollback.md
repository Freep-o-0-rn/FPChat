# Build 180.7 — failed-update rollback acceptance

180.7 adds automatic rollback for failures that happen **after live application files have been touched**.

## Complete rollback snapshot

Before `LIVE_FILES_TOUCHED=1`, updater now records whether the old installation had:

- `data/`;
- `.env`;
- `node_modules/`.

It then completes a rollback snapshot:

- `backup/app`;
- `backup/data` when data existed;
- `backup/.env` when config existed;
- `backup/node_modules` when dependencies existed.

Only after all required snapshot parts succeed is `BACKUP_READY=1` set.

The dependency snapshot is intentional: after a failed dependency mirror, restoring only old code could leave new/partial dependencies beside old code.

## Automatic restore after live-touch failure

When both `LIVE_FILES_TOUCHED=1` and `BACKUP_READY=1`, `:fail` calls `:rollback`.

Rollback:

1. mirror-restores `backup/app -> live`, excluding `data`, `node_modules`, `.git`, `.env`; mirror semantics remove files that existed only in the failed new build;
2. mirror-restores old `data` when it previously existed, otherwise removes a newly-created data directory;
3. restores old `.env` when it previously existed, otherwise removes a newly-created one;
4. mirror-restores old `node_modules` when it previously existed, otherwise removes dependencies introduced by the failed update;
5. reports explicit success/failure.

Neither failure nor rollback launches FPChat. The server remains stopped for operator verification.

If no complete rollback snapshot exists, updater does not pretend restoration succeeded.

## Isolated fault injection

For the Windows acceptance only, `FPCHAT_UPDATE_TEST_FAIL_AFTER_DEPENDENCIES=1` injects a failure after new application files and staged dependencies have already been written to the isolated live copy.

The harness creates distinguishable old/new application states. In particular:

- old live `server.js` receives an old-code marker;
- new source `server.js` receives a new-code marker;
- old live has an app-only marker;
- source has a new-only app marker;
- live data and `.env` have SHA-256 baselines;
- old `node_modules` has a marker that the new dependency mirror removes.

After the injected failure, acceptance requires:

- updater exits non-zero;
- rollback reports success and no rollback error;
- old `server.js` hash is exactly restored;
- old app marker exists;
- new-only app marker is removed;
- SQLite, upload and `.env` hashes equal the pre-update values;
- old dependency marker is restored;
- `express`, `better-sqlite3` and `ws` load from the restored live tree;
- backup app/data/config/dependencies match the old state;
- staging is removed;
- APP_PORT has no listener;
- test target is not `C:\_BOTS\FPChat`.

Real user data is not used by this acceptance; all files live under the ephemeral Windows runner temp directory.

## Acceptance

- `npm run test:180:rollback-contract`;
- `npm run test:180:rollback-isolated-windows`;
- `npm run test:180:1807`.

The Windows workflow executes the successful update, launcher singleton tests, and the fault-injected rollback test independently.
