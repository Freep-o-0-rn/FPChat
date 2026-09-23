# Build 180.6 — isolated Windows launcher acceptance

180.6 gives the launcher one explicit responsibility: start at most one instance of **this FPChat installation** without terminating other Node processes.

## Exact FPChat identity

`start_chat.bat` delegates process ownership checks to `scripts/start-fpchat180.ps1`.

The helper resolves the absolute current `server.js` path and reads `APP_PORT` from the current installation's `.env` (default 3010).

Before starting anything it reads Windows listening sockets on that port and resolves each listener PID through `Win32_Process`.

An already-running instance is accepted only when:

- there is exactly one listener owner;
- it is `node.exe`;
- its command line contains the absolute `server.js` path of this FPChat installation.

If the port is owned by anything else, launcher exits with an error. It does not stop or kill the owner.

## Startup identity

The launcher starts:

`node.exe <absolute-path-to-current-FPChat\\server.js>`

rather than hiding the child behind `npm start`. This makes the listener process identifiable as this exact installation.

`package.json#start` remains unchanged for other workflows.

## Dependency behavior

If `node_modules` exists, launcher performs **no npm command**.

If `node_modules` is missing, launcher requires `package-lock.json` and runs only:

`npm ci --omit=dev --no-audit --no-fund`

The former plain `npm install` path is removed.

## No process killing

Neither `start_chat.bat` nor `start-fpchat180.ps1` contains `taskkill`, `Stop-Process` or another process-termination path.

A port conflict is handled by refusal, not by killing the existing process.

## Windows integration

`scripts/test1806-launcher-isolated.ps1` runs on the isolated Windows copy and verifies:

1. dependencies are installed before the launcher test;
2. PATH is then prefixed with an `npm.cmd` sentinel that fails if launcher invokes npm;
3. an unrelated Node process is started and kept alive;
4. first launcher starts FPChat and APP_PORT is owned by a Node command line containing the exact absolute test-copy `server.js`;
5. second launcher exits successfully while the listener PID remains unchanged;
6. no npm sentinel was called;
7. the harness stops only its known FPChat fixture PID;
8. an unrelated Node process is then placed on the FPChat port;
9. launcher refuses the conflict with a non-zero exit;
10. the foreign Node listener remains alive and retains the port;
11. the unrelated Node process on another port/without a listener also remains alive.

The test harness may use `Stop-Process` only to clean up PIDs that the harness itself created; launcher production code never does.

## Acceptance

- `npm run test:180:launcher-contract`;
- `npm run test:180:launcher-isolated-windows`;
- `npm run test:180:1806`.

The Windows GitHub Actions workflow executes both 180.5 updater acceptance and 180.6 launcher acceptance on Node 22.
