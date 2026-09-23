'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const scriptsDir=path.join(root,'scripts');
const probe=process.argv.includes('--probe');
const timeoutMs=Number(process.env.FPCHAT_18012_TEST_TIMEOUT_MS||120000);

const expectedFailures=Object.freeze({
  'regression178-release.cjs': 'Historical Build 178.28.1 release gate freezes the pre-180 updater/launcher contract; superseded by Build 180.4-180.7 Windows contract/isolated acceptance.'
});

const checks=[
  'check-build169.js',
  'check-build170.js',
  'check-build171.js',
  'check-build172.js',
  'check-build173.js',
  'check-build174.js',
  'check-build176.js'
];

const regressions=fs.readdirSync(scriptsDir)
  .filter(name=>/^regression\d+.*\.cjs$/i.test(name))
  .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));

const files=[...checks,...regressions];
const missing=files.filter(name=>!fs.existsSync(path.join(scriptsDir,name)));
if(missing.length)throw new Error('Missing cumulative regression files: '+missing.join(', '));

const results=[];
for(const file of files){
  const started=Date.now();
  process.stdout.write('\n===== 180.12 '+file+' =====\n');
  const child=spawnSync(process.execPath,[path.join(scriptsDir,file)],{
    cwd:root,
    env:{...process.env,FPCHAT_TEST_ROOT:root},
    stdio:'inherit',
    timeout:timeoutMs
  });
  const timedOut=child.error?.code==='ETIMEDOUT'||child.signal==='SIGTERM';
  const failed=Boolean(child.error)||child.status!==0;
  const expectedReason=expectedFailures[file]||null;
  let status='PASS';
  if(timedOut) status='TIMEOUT';
  else if(expectedReason&&failed) status='EXPECTED_FAIL';
  else if(expectedReason&&!failed) status='XPASS';
  else if(failed) status='FAIL';
  const result={
    file,
    status,
    expectedReason,
    exitCode:child.status,
    signal:child.signal||null,
    durationMs:Date.now()-started
  };
  results.push(result);
  process.stdout.write('FP18012_RESULT '+JSON.stringify(result)+'\n');
}

const counts=results.reduce((acc,item)=>{
  acc[item.status]=(acc[item.status]||0)+1;
  return acc;
},{PASS:0,FAIL:0,TIMEOUT:0,EXPECTED_FAIL:0,XPASS:0});

process.stdout.write('\n===== 180.12 cumulative summary =====\n');
process.stdout.write(JSON.stringify({total:results.length,counts,results},null,2)+'\n');

if(!probe&&(counts.FAIL||counts.TIMEOUT||counts.XPASS))process.exitCode=1;
