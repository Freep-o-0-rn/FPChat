'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');

const version=JSON.parse(read('public/version.json'));
const settings=read('public/settings-ui131.js');
const bridge=read('public/build165-ui.js');
const updater=read('update.bat');
const start=read('start_chat.bat');

assert.equal(version.version,'1.0.0');
assert.equal(version.build,178.28,'server/client version metadata is not Build 178.28');
assert(settings.includes('const BUILD = 178.28;'),'settings fallback build is stale');
assert(bridge.includes("const BUILD_LABEL = 'Build 178.28';"),'presentation bridge build label is stale');
assert(bridge.includes("'?v=178.28'"),'presentation bridge fallback cache suffix is stale');
assert(bridge.includes('/^Build\\s+\\d+(?:\\.\\d+)?$/i'),'build label matcher does not support dotted build numbers');
assert(bridge.includes('/Build\\s+\\d+(?:\\.\\d+)?/i'),'about label matcher does not support dotted build numbers');

assert(updater.includes('set "EXPECTED_BUILD=178.28"'),'updater expected build is stale');
assert(updater.includes('Source build verified: %SOURCE_BUILD%'),'updater does not verify source version');
assert(updater.includes('ConvertFrom-Json).build'),'updater source build check does not read version.json');
const verify=updater.indexOf('Source build verified: %SOURCE_BUILD%');
const stage=updater.indexOf('echo [2/7] Building isolated staging copy...');
const stop=updater.indexOf('echo [4/7] Stopping FPChat before touching SQLite and files...');
const live=updater.indexOf('set "LIVE_FILES_TOUCHED=1"');
assert(verify>=0&&stage>verify&&stop>stage&&live>stop,'build verification no longer occurs before staging/server stop/live writes');

assert(updater.includes('call npm ci --omit=dev --no-audit --no-fund'),'updater lost deterministic dependency install');
assert(updater.includes('/XD "%SRC%\\data" "%SRC%\\node_modules" "%SRC%\\.git" /XF .env'),'staging copy exclusions changed');
assert(updater.includes('/XD "%STAGE%\\node_modules" "%STAGE%\\data" "%STAGE%\\.git" /XF .env'),'live copy can overwrite protected data/.env');
assert(updater.includes('robocopy "%STAGE%\\node_modules" "%DST%\\node_modules" /MIR'),'locked staging dependencies are not deployed');
assert(updater.includes('if exist "%DST%\\data\\"'),'data backup path missing');
assert(updater.includes('if exist "%DST%\\.env"'),'env backup path missing');
assert(updater.includes('if "%SERVER_WAS_RUNNING%"=="1" ('),'updater restart condition changed');

assert(start.includes('if not exist node_modules ('),'launcher dependency fallback missing');
assert(start.includes('call npm start'),'launcher no longer starts through package script');

console.log('PASS Build 178.28 metadata is consistent across version/settings/presentation bridge');
console.log('PASS updater rejects a wrong source build before stopping or changing the live server');
console.log('PASS updater still stages npm ci and preserves data/.env with backup-before-apply');
console.log('PASS existing launcher/restart behavior remains intact');
