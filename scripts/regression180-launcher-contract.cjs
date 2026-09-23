'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const bat=read('start_chat.bat');
const helper=read('scripts/start-fpchat180.ps1');
const update=read('update.bat');

assert(bat.includes('title FPChat Server Launcher'),'launcher title changed');
assert(bat.includes('scripts\\start-fpchat180.ps1'),'launcher helper missing');
assert(!bat.toLowerCase().includes('taskkill'),'launcher must not kill processes');
assert(!bat.includes('call npm install'),'old unconditional/full npm install path remains in batch');
assert(!bat.includes('call npm start'),'launcher should not hide process identity behind npm start');
assert(bat.includes('FPCHAT_LAUNCH_NONINTERACTIVE'),'noninteractive acceptance gate missing');

assert(helper.includes("Get-NetTCPConnection -LocalPort $Port -State Listen"),'listener ownership check missing');
assert(helper.includes('Get-CimInstance Win32_Process'),'listener process identity check missing');
assert(helper.includes("Name -notmatch '^node(?:\\.exe)?$'"),'exact node-process guard missing');
assert(helper.includes("IndexOf($expected, [StringComparison]::OrdinalIgnoreCase)"),'exact server.js path comparison missing');
assert(helper.includes('No process was stopped.'),'foreign-owner refusal contract missing');
assert(!helper.toLowerCase().includes('stop-process'),'launcher helper must not terminate processes');
assert(!helper.toLowerCase().includes('taskkill'),'launcher helper must not terminate processes');
assert(!helper.toLowerCase().includes('kill('),'launcher helper must not terminate processes');

assert(helper.includes("if (-not (Test-Path -LiteralPath $nodeModules -PathType Container))"),'dependency presence gate missing');
assert(helper.includes('& npm.cmd ci --omit=dev --no-audit --no-fund'),'missing dependency install must be locked npm ci');
assert(!helper.includes('npm.cmd install')&&!helper.includes('& npm install'),'launcher helper must not invoke full npm install');
assert(helper.includes("Dependencies are already installed; dependency install is skipped."),'existing dependency skip path missing');

assert(helper.includes('& node.exe $serverJs'),'launcher does not start exact absolute server.js');
assert(!helper.includes('npm.cmd start'),'npm wrapper would hide exact FPChat process identity');

assert(!update.includes('start "FPChat Server"'),'updater must remain separated from launcher after 180.5');

console.log('PASS 180.6 launcher identifies an existing instance by listener PID + exact FPChat server.js path');
console.log('PASS 180.6 launcher has no process-termination primitive and refuses foreign port ownership');
console.log('PASS 180.6 existing node_modules skips npm; missing dependencies use locked production npm ci only');
console.log('PASS 180.6 launcher starts node with the absolute FPChat server.js path');
