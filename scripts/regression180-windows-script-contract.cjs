'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const update=read('update.bat');
const launcher=read('start_chat.bat');
const pkg=JSON.parse(read('package.json'));

// Fixed live/backup locations and current build gate.
assert(update.includes('set "DST=C:\\_BOTS\\FPChat"'),'destination changed');
assert(update.includes('set "BACKUP_ROOT=C:\\_BOTS\\FPChat_backups"'),'backup root changed');
assert(update.includes('set "APP_PORT=3010"'),'default APP_PORT changed');
assert(update.includes('set "EXPECTED_BUILD=178.28.1"'),'current expected-build baseline changed');
assert(update.includes('if not "%SOURCE_BUILD%"=="%EXPECTED_BUILD%"'),'source build verification removed');

// Tool/source prerequisites.
for(const token of [
  'if not exist "%SRC%\\package.json"',
  'if not exist "%SRC%\\package-lock.json"',
  'if not exist "%SRC%\\server.js"',
  'if not exist "%SRC%\\public\\version.json"',
  'where node >nul 2>&1',
  'where npm >nul 2>&1',
  'if not "%NODE_MAJOR%"=="22"'
]) assert(update.includes(token),'updater prerequisite changed: '+token);
assert(update.includes('if /I "%SRC%"=="%DST%"'),'source==destination protection changed');

// Live .env determines APP_PORT when available.
assert(update.includes('if exist "%DST%\\.env"'),'live .env APP_PORT read removed');
assert(update.includes('findstr /B /C:"APP_PORT=" "%DST%\\.env"'),'APP_PORT extraction changed');

// Staging excludes protected/runtime-local state and installs lockfile dependencies before live stop.
const stageCopy='robocopy "%SRC%" "%STAGE%" /E /XD "%SRC%\\data" "%SRC%\\node_modules" "%SRC%\\.git" /XF .env /R:2 /W:2';
assert(update.includes(stageCopy),'staging exclusions changed');
assert(update.includes('call npm ci --omit=dev --no-audit --no-fund'),'locked staging install changed');
assert(update.indexOf('call npm ci --omit=dev --no-audit --no-fund')<update.indexOf('[4/7] Stopping FPChat'),'dependencies no longer prepared before live stop');

// Current running detection/stop behavior.
assert(update.includes('Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen'),'port-listener detection changed');
assert(update.includes('taskkill /FI "WINDOWTITLE eq FPChat Server Launcher" /T /F'),'current window-title stop behavior changed');
assert(update.includes('echo [ERROR] Port %APP_PORT% is still busy.'),'post-stop port verification changed');

// Backup is three separate protection classes.
assert(update.includes('robocopy "%DST%" "%BACKUP%\\app" /E /XD "%DST%\\data" "%DST%\\node_modules" "%DST%\\.git" /XF .env'),'application backup exclusions changed');
assert(update.includes('robocopy "%DST%\\data" "%BACKUP%\\data" /E'),'data backup changed');
assert(update.includes('copy /Y "%DST%\\.env" "%BACKUP%\\.env"'),'env backup changed');
assert(!update.includes('"%BACKUP%\\node_modules"'),'node_modules unexpectedly became a backup payload');

// Live apply preserves data/.env, uses /E for app and /MIR only for dependencies.
assert(update.includes('set "LIVE_FILES_TOUCHED=1"'),'live-touch boundary changed');
const appApply='robocopy "%STAGE%" "%DST%" /E /XD "%STAGE%\\node_modules" "%STAGE%\\data" "%STAGE%\\.git" /XF .env';
assert(update.includes(appApply),'live application protected-data exclusions changed');
assert(!update.includes('robocopy "%STAGE%" "%DST%" /MIR'),'application copy unexpectedly became mirror');
assert(update.includes('robocopy "%STAGE%\\node_modules" "%DST%\\node_modules" /MIR'),'dependency mirror changed');
assert(update.includes('if not exist "%DST%\\data\\" mkdir "%DST%\\data"'),'live data-directory preservation/create step changed');

// Current successful updater DOES restart the server; 180.5 will intentionally change this later.
assert(update.includes('if "%SERVER_WAS_RUNNING%"=="1" (\n    echo Restarting FPChat server...'),'successful restart branch missing');
assert(update.includes('start "FPChat Server" /D "%DST%" cmd /c call "%DST%\\start_chat.bat"'),'successful updater restart command changed');
assert(update.includes('if "%SERVER_WAS_RUNNING%"=="1" echo Server restart command was issued.'),'restart reporting changed');

// Failure before live touch attempts old-server restart.
assert(update.includes('if "%SERVER_WAS_RUNNING%"=="1" if "%LIVE_FILES_TOUCHED%"=="0" ('),'pre-touch restart recovery condition changed');
assert(update.includes('echo Attempting to restart the previous FPChat server...'),'pre-touch recovery action changed');

// Failure after live touch has warning only, no automated backup restore.
assert(update.includes('if "%LIVE_FILES_TOUCHED%"=="1" echo Live files may be incomplete; use the backup shown above before restarting.'),'post-touch manual-restore warning changed');
for(const forbidden of [
  'robocopy "%BACKUP%\\app" "%DST%"',
  'robocopy "%BACKUP%\\data" "%DST%\\data"',
  'copy /Y "%BACKUP%\\.env" "%DST%\\.env"'
]) assert(!update.includes(forbidden),'automatic post-touch rollback appeared without 180.7 acceptance: '+forbidden);

// Launcher actual behavior.
assert(launcher.includes('title FPChat Server Launcher'),'launcher title changed');
assert(launcher.includes('if not exist package.json'),'launcher package guard changed');
assert(launcher.includes('if not exist node_modules'),'launcher dependency-presence guard changed');
assert(launcher.includes('call npm install'),'missing-node_modules install behavior changed');
assert(!launcher.includes('npm ci'),'launcher unexpectedly switched dependency strategy');
assert(launcher.includes('call npm start'),'launcher start command changed');
assert.equal(pkg.scripts.start,'node server.js','npm start target changed');

// Current launcher has no singleton/process ownership mechanism.
assert(!launcher.includes('Get-NetTCPConnection'),'launcher unexpectedly gained port ownership logic');
assert(!launcher.toLowerCase().includes('taskkill'),'launcher unexpectedly gained process termination logic');
assert(!launcher.includes('Get-CimInstance'),'launcher unexpectedly gained process identity logic');

console.log('PASS 180.4 update.bat factual source/staging/protected-data/backup/apply contract is frozen');
console.log('PASS 180.4 current successful updater restart and manual post-touch recovery are explicitly recorded');
console.log('PASS 180.4 start_chat.bat current install/start behavior and lack of singleton ownership are frozen');
console.log('PASS 180.4 audit derives from current batch files/package.json, not old documentation');
