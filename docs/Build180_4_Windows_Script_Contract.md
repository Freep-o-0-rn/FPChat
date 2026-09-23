# Build 180.4 — factual Windows updater / launcher contract

Build 180.4 is audit-only. It records the behavior of the **current files in this branch**, not assumptions from older README/release notes.

Audited files:

- `update.bat`;
- `start_chat.bat`;
- `package.json` only to resolve what `npm start` currently executes.

Production runtime and batch files are not modified in this step.

## Current paths and source selection

`update.bat` currently hard-codes:

- destination: `C:\\_BOTS\\FPChat`;
- backup root: `C:\\_BOTS\\FPChat_backups`;
- default application port: `3010`;
- expected source build: `178.28.1`.

Source lookup order is:

1. directory containing `update.bat`, when it is not the live destination and contains `package.json`;
2. `FPChat` subdirectory beside the updater;
3. `D:\\FPChat`;
4. `FPChat` on drive letters D through Z.

The updater refuses source == destination.

Before any staging install it requires:

- `package.json`;
- `package-lock.json`;
- `server.js`;
- `public/version.json`;
- exact `version.json.build === EXPECTED_BUILD`;
- `node` and `npm` in PATH;
- Node.js major version exactly 22.

**Current limitation:** `EXPECTED_BUILD` is still `178.28.1`; this is factual current behavior and will need an explicit later update before this branch can be distributed through this updater.

## Protected live data: preserved in place

The live apply step deliberately excludes these from the source copy:

- `data/`;
- `.env`;
- `.git/`;
- staged `node_modules/` from the application-file robocopy.

Therefore the update does not intentionally overwrite live `data/` or `.env` when copying application files.

`data/` contains the SQLite database and uploads in the normal FPChat layout, so both are protected by the directory-level exclusion rather than by individual filename rules.

`.env` is also read before stopping the server to obtain `APP_PORT`; if missing or no `APP_PORT=` line exists, port 3010 is used.

After application/dependency copy, the updater creates live `data/` if it does not exist. It does not synthesize or replace `.env`.

## Staging and dependency behavior

The isolated staging copy excludes:

- source `data/`;
- source `node_modules/`;
- source `.git/`;
- source `.env`.

Dependencies are installed in staging with:

`npm ci --omit=dev --no-audit --no-fund`

This happens **before** the updater stops the live server or touches live application files.

After application files are copied, staged `node_modules` is copied to live using `robocopy /MIR`. Therefore live dependencies are replaced/mirrored from the locked staging install; they are not preserved as user data.

## Existing-server detection and stop behavior

The updater first checks whether `APP_PORT` currently has a listening TCP socket.

If the port is listening:

- `SERVER_WAS_RUNNING=1`;
- it runs `taskkill /FI "WINDOWTITLE eq FPChat Server Launcher" /T /F`;
- waits two seconds;
- checks the port again.

If the port remains busy, update is canceled before backup/live copy. At that point `SERVER_WAS_RUNNING` is reset to 0.

This is not PID/command-line ownership verification. Build 180.4 records it as current behavior; 180.6 must separately prove/fix the requirement that unrelated Node processes are not killed and only one FPChat instance is launched.

## Backup contents

Backup directory: `C:\\_BOTS\\FPChat_backups\\backup_<timestamp>`.

### `backup_<timestamp>\\app`

Copies the live application tree but excludes:

- `data/`;
- `node_modules/`;
- `.git/`;
- `.env`.

### `backup_<timestamp>\\data`

Copies the entire live `data/` tree recursively when it exists.

### `backup_<timestamp>\\.env`

Copies live `.env` separately when it exists.

### Not backed up

`node_modules/` is **not** included in the backup. The current strategy is to recreate dependencies from the source lockfile in staging.

The live `.git/` directory is also neither applied from source nor backed up by this updater.

## Live apply behavior

Immediately before the first live application copy:

`LIVE_FILES_TOUCHED=1`

is set.

Application files are copied staging → live with `robocopy /E`, excluding staging `node_modules`, `data`, `.git` and `.env`.

Important factual detail: application files use `/E`, **not `/MIR`**. Therefore files existing only in the old live application tree are not explicitly deleted by this copy step.

Dependencies are then copied staging `node_modules` → live `node_modules` with `/MIR`.

## Successful update behavior

After the copy, staging is deleted.

If a listener existed before update (`SERVER_WAS_RUNNING=1`), the current updater **starts `start_chat.bat` itself**:

`start "FPChat Server" /D "%DST%" cmd /c call "%DST%\\start_chat.bat"`

and waits three seconds.

Therefore current `update.bat` does **not** satisfy the future 180.5 target "updater does not start the server". That is a later behavioral change, not something to hide in this audit.

## Failure and restoration behavior

There are two materially different failure classes.

### Failure before live files are touched

When `SERVER_WAS_RUNNING=1` and `LIVE_FILES_TOUCHED=0`, `:fail` attempts to restart the previous server using live `start_chat.bat`.

Examples include failures during staging, `npm ci`, stop verification, or backup creation before the live apply step.

### Failure after live files are touched

When `LIVE_FILES_TOUCHED=1`, the updater does **not** automatically restore `backup\\app`, `backup\\data`, `.env` or the prior dependencies.

It prints that live files may be incomplete and tells the operator to use the backup before restarting.

It also does not automatically restart the server in this branch.

Therefore current rollback after partial live apply is **manual and incomplete as an automated contract**. Build 180.7 must test and, if required, implement an isolated-copy restoration path before any claim of automatic recovery.

## `start_chat.bat` factual behavior

The launcher:

1. sets console code page 65001;
2. changes the window title to `FPChat Server Launcher`;
3. requires `package.json` in the current working directory;
4. if `node_modules` does not exist, runs plain `npm install`;
5. if `node_modules` exists, performs no dependency install/check;
6. runs `npm start`;
7. pauses after `npm start` exits.

Current `package.json` defines:

`npm start` → `node server.js`.

`start_chat.bat` currently has no explicit singleton/PID/port ownership logic. It does not search for an existing FPChat process and does not stop one before starting another.

It also does not run a full `npm install` when `node_modules` already exists, but if that directory is absent it does run plain `npm install` rather than `npm ci`.

## Separation for 180.5–180.7

180.4 makes no corrections. It establishes the baseline to test/change later:

- **180.5:** isolated Windows updater test; preserve data/config/dependencies as required and ensure updater does not launch server;
- **180.6:** launcher singleton test; one FPChat instance, no unrelated Node termination, no unnecessary full install;
- **180.7:** failed-update restoration test; compatible code/data restored without touching real user data.

## Acceptance

`npm run test:180:windows-script-contract`

The regression parses the actual batch files and package script and freezes all factual behaviors listed above. It intentionally asserts current limitations (including automatic successful restart and lack of automatic post-touch rollback) so later Build 180 steps must change the regression explicitly when behavior changes.
