'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const update=read('update.bat');
const launcher=read('start_chat.bat');
const historical=read('docs/Build180_4_Windows_Script_Contract.md');
const pkg=JSON.parse(read('package.json'));

assert(update.includes('set "DST=C:\\_BOTS\\FPChat"'),'production destination default changed');
assert(update.includes('set "BACKUP_ROOT=C:\\_BOTS\\FPChat_backups"'),'production backup default changed');
assert(update.includes('if defined FPCHAT_UPDATE_DST'),'isolated destination override missing');
assert(update.includes('if defined FPCHAT_UPDATE_BACKUP_ROOT'),'isolated backup override missing');
assert(update.includes(`set "EXPECTED_BUILD=${JSON.parse(read('public/version.json')).build}"`),'current build gate differs from version.json');

assert(update.includes('robocopy "%SRC%" "%STAGE%" /E /XD "%SRC%\\data" "%SRC%\\node_modules" "%SRC%\\.git" /XF .env'),'staging exclusions changed');
assert(update.includes('call npm ci --omit=dev --no-audit --no-fund'),'staging locked install changed');
assert(update.includes('robocopy "%DST%" "%BACKUP%\\app" /E /XD "%DST%\\data" "%DST%\\node_modules" "%DST%\\.git" /XF .env'),'app backup changed');
assert(update.includes('robocopy "%DST%\\data" "%BACKUP%\\data" /E'),'data backup changed');
assert(update.includes('copy /Y "%DST%\\.env" "%BACKUP%\\.env"'),'env backup changed');
assert(update.includes('robocopy "%STAGE%" "%DST%" /E /XD "%STAGE%\\node_modules" "%STAGE%\\data" "%STAGE%\\.git" /XF .env'),'live protected-data exclusions changed');
assert(update.includes('robocopy "%STAGE%\\node_modules" "%DST%\\node_modules" /MIR'),'dependency mirror changed');

assert(!update.includes('start "FPChat Server"'),'updater still launches FPChat');
assert(!update.includes('call "%DST%\\start_chat.bat"'),'updater still invokes launcher');
assert(!update.includes('Restarting FPChat server'),'old successful restart path remains');
assert(!update.includes('Attempting to restart the previous FPChat server'),'old failure restart path remains');
assert(update.includes('FPChat was stopped for the update and remains stopped.'),'manual-success restart message missing');
assert(update.includes('FPChat was stopped by the updater and was not restarted.'),'manual-failure restart message missing');
assert(update.includes('call :rollback'),'post-touch automatic rollback missing');
assert(update.includes('robocopy "%BACKUP%\\app" "%DST%" /MIR /XD data node_modules .git /XF .env'),'application rollback mirror changed');
assert(update.includes('robocopy "%BACKUP%\\data" "%DST%\\data" /MIR'),'data rollback mirror changed');
assert(update.includes('copy /Y "%BACKUP%\\.env" "%DST%\\.env"'),'env rollback changed');
assert(update.includes('robocopy "%BACKUP%\\node_modules" "%DST%\\node_modules" /MIR'),'dependency rollback mirror changed');
assert(!update.includes('start "FPChat Server"'),'rollback/updater must not launch server');

assert((update.match(/FPCHAT_UPDATE_NONINTERACTIVE/g)||[]).length>=2,'noninteractive test gate missing');

assert(historical.includes('current updater **starts `start_chat.bat` itself**'),'180.4 historical successful-restart baseline was lost');
assert(historical.includes('does **not** automatically restore'),'180.4 historical rollback baseline was lost');

assert(launcher.includes('scripts\\start-fpchat180.ps1'),'180.6 launcher helper wiring missing');
assert(!launcher.includes('call npm install'),'old launcher full npm install path returned');
assert(!launcher.includes('call npm start'),'old launcher npm start wrapper returned');
assert.equal(pkg.scripts.start,'node server.js');

console.log('PASS 180.5 protected-data/staging/backup contract remains intact');
console.log('PASS 180.5 updater has no server-launch command on success or failure');
console.log('PASS 180.5 production path defaults remain while isolated Windows test roots are supported');
console.log('PASS 180.5 180.4 baseline remains available as historical documentation');
console.log('PASS 180.6 accumulated updater regression accepts the new dedicated launcher contract');
console.log('PASS 180.7 current updater contract includes complete rollback snapshot and automatic post-touch restore');
