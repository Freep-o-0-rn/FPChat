# Build 180.5 — isolated Windows updater acceptance

180.5 intentionally changes one updater behavior established by the 180.4 audit: `update.bat` is no longer allowed to start FPChat itself.

## Production behavior change

`update.bat` no longer invokes `start_chat.bat` after a successful update and no longer invokes it from the failure path. If FPChat was stopped by the updater, the operator is told to start it manually after checking the result.

## Test-only isolation controls

The production defaults remain:

- `C:\_BOTS\FPChat`;
- `C:\_BOTS\FPChat_backups`.

For isolated acceptance only, the batch file now honors explicitly supplied:

- `FPCHAT_UPDATE_DST`;
- `FPCHAT_UPDATE_BACKUP_ROOT`;
- `FPCHAT_UPDATE_NONINTERACTIVE=1`.

Without those environment variables, normal production paths and interactive pause behavior remain.

## Windows integration harness

`scripts/test1805-update-isolated.ps1` creates a temporary `source/live/backups` tree under the Windows runner temp directory. It does not use the real FPChat installation.

The live copy receives binary sentinels under `data/`, an `.env` sentinel, an old application marker and an installed production dependency tree. The source receives a new application marker and a launcher sentinel that would create `SERVER_WAS_LAUNCHED.txt` if updater invoked it.

Acceptance requires:

- new application files are applied;
- SHA-256 of live SQLite sentinel is unchanged;
- SHA-256 of live upload sentinel is unchanged;
- SHA-256 of live `.env` is unchanged;
- backup app contains the pre-update application marker;
- backup data/config hashes equal pre-update hashes;
- live `node_modules` remains present and required runtime modules load after update;
- staging is removed;
- launcher sentinel is never created;
- configured APP_PORT has no listener after update.

`node_modules` is not byte-for-byte preserved. The accepted strategy remains locked `npm ci` in staging followed by `/MIR` into live; 180.5 verifies that installed runtime dependencies remain present and usable.

## Windows execution

`.github/workflows/build180-windows-update.yml` runs the harness on `windows-latest` with Node 22.

Commands:

- `npm run test:180:windows-script-contract`;
- `npm run test:180:update-isolated-windows`;
- `npm run test:180:1805`.
