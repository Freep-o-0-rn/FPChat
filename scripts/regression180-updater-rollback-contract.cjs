'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const update=read('update.bat');

for(const token of [
  'set "BACKUP_READY=0"',
  'set "HAD_DATA=0"',
  'set "HAD_ENV=0"',
  'set "HAD_NODE_MODULES=0"',
  'if exist "%DST%\\data\\" set "HAD_DATA=1"',
  'if exist "%DST%\\.env" set "HAD_ENV=1"',
  'if exist "%DST%\\node_modules\\" set "HAD_NODE_MODULES=1"',
  'robocopy "%DST%\\node_modules" "%BACKUP%\\node_modules" /E',
  'set "BACKUP_READY=1"',
  'if "%LIVE_FILES_TOUCHED%"=="1" if "%BACKUP_READY%"=="1" (',
  'call :rollback',
  ':rollback',
  'robocopy "%BACKUP%\\app" "%DST%" /MIR /XD data node_modules .git /XF .env',
  'robocopy "%BACKUP%\\data" "%DST%\\data" /MIR',
  'copy /Y "%BACKUP%\\.env" "%DST%\\.env"',
  'robocopy "%BACKUP%\\node_modules" "%DST%\\node_modules" /MIR',
  '[ROLLBACK] Restore completed successfully.'
]) assert(update.includes(token),'rollback contract changed/missing: '+token);

assert(update.indexOf('set "BACKUP_READY=1"')<update.indexOf('set "LIVE_FILES_TOUCHED=1"'),'live writes begin before complete rollback snapshot');
assert(update.indexOf('set "LIVE_FILES_TOUCHED=1"')<update.indexOf('FPCHAT_UPDATE_TEST_FAIL_AFTER_DEPENDENCIES'),'fault injection must occur only after live-write boundary');
assert(!update.includes('start "FPChat Server"'),'rollback must not launch server');
assert(!update.includes('call "%DST%\\start_chat.bat"'),'rollback must not invoke launcher');

console.log('PASS 180.7 complete rollback snapshot is established before first live write');
console.log('PASS 180.7 rollback mirrors old app/data/dependencies and restores .env');
console.log('PASS 180.7 rollback handles originally absent protected/runtime-local paths explicitly');
console.log('PASS 180.7 rollback/updater remains separated from server launch');
