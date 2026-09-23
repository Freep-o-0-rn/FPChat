'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const transferSha='294cf56bd5b4eaee7e8331d9586cdded4b9fd699';
const transferPath='public/room-context170.js';
const targetRegression='scripts/regression180-init-coordination.cjs';
const expectedRollbackFailure='Lifecycle170 fallback failure is not connected to FPStartup174.fail';

function run(bin,args,{cwd=root,allowFailure=false,env=process.env}={}){
  const result=spawnSync(bin,args,{
    cwd,
    env,
    encoding:'utf8',
    maxBuffer:16*1024*1024
  });
  if(!allowFailure && (result.error||result.status!==0)){
    const details=[result.stdout,result.stderr].filter(Boolean).join('\n');
    throw new Error(bin+' '+args.join(' ')+' failed with '+String(result.status)+'\n'+details);
  }
  return result;
}

function git(args,options={}){
  return run('git',args,options);
}

function ownerLoaderBody(source,marker){
  const markerAt=source.indexOf(marker);
  assert(markerAt>=0,'owner loader marker missing: '+marker);
  const functionAt=source.lastIndexOf('function ',markerAt);
  assert(functionAt>=0,'owner loader function missing for: '+marker);
  const nextFunction=source.indexOf('\n  function ',markerAt);
  return source.slice(functionAt,nextFunction>=0?nextFunction:source.length);
}


const sourceHead=git(['rev-parse','HEAD']).stdout.trim();
assert(sourceHead,'source HEAD missing');

const transferInfo=git(['show','--format=%H%n%P%n%s','--no-renames',transferSha,'--',transferPath]).stdout;
assert(transferInfo.includes(transferSha),'180.10 transfer commit is not available in git history');
assert(transferInfo.includes('Build 180.10: connect lifecycle fallback failure to startup readiness'),'unexpected transfer commit identity');

const transferFiles=git(['diff-tree','--no-commit-id','--name-only','-r',transferSha]).stdout.trim().split(/\r?\n/).filter(Boolean);
assert.deepEqual(transferFiles,[transferPath],'180.10 transfer commit no longer contains exactly one runtime file');

const tmpBase=fs.mkdtempSync(path.join(os.tmpdir(),'fpchat-18013-'));
const worktree=path.join(tmpBase,'worktree');
let added=false;

try{
  git(['worktree','add','--detach',worktree,sourceHead]);
  added=true;

  const rollback=git([
    '-C',worktree,
    '-c','user.name=FPChat 180.13',
    '-c','user.email=fpchat-18013@example.invalid',
    'revert','--no-edit',transferSha
  ]);
  assert.equal(rollback.status,0,'rollback commit failed');

  const rollbackHead=git(['-C',worktree,'rev-parse','HEAD']).stdout.trim();
  assert.notEqual(rollbackHead,sourceHead,'rollback did not create a separate commit');

  const rollbackFiles=git(['-C',worktree,'diff','--name-only',sourceHead,rollbackHead]).stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.deepEqual(rollbackFiles,[transferPath],'rollback changed neighboring fixes/files');

  const rolledSource=fs.readFileSync(path.join(worktree,transferPath),'utf8');
  const rolledLifecycleLoader=ownerLoaderBody(rolledSource,'lifecycle170.js');
  assert(!rolledLifecycleLoader.includes('script.onerror = () => window.FPStartup174?.fail();'),'rollback did not remove the 180.10 Lifecycle170 failure connection');
  assert(rolledLifecycleLoader.includes('script.onload = loadConnectionOwner;'),'rollback damaged the pre-existing Lifecycle170 success transition');

  const rolledScenario=run(process.execPath,[targetRegression],{
    cwd:worktree,
    allowFailure:true,
    env:{...process.env,FPCHAT_TEST_ROOT:worktree}
  });
  const rolledOutput=String(rolledScenario.stdout||'')+'\n'+String(rolledScenario.stderr||'');
  assert.notEqual(rolledScenario.status,0,'target scenario unexpectedly passed after the transfer was rolled back');
  assert(rolledOutput.includes(expectedRollbackFailure),'rollback failure did not occur at the expected 180.10 boundary');

  const restore=git([
    '-C',worktree,
    '-c','user.name=FPChat 180.13',
    '-c','user.email=fpchat-18013@example.invalid',
    'revert','--no-edit',rollbackHead
  ]);
  assert.equal(restore.status,0,'restore commit failed');

  const restoredHead=git(['-C',worktree,'rev-parse','HEAD']).stdout.trim();
  assert.notEqual(restoredHead,rollbackHead,'restore did not create a separate commit');

  const restoredDiff=git(['-C',worktree,'diff','--name-only',sourceHead,restoredHead]).stdout.trim();
  assert.equal(restoredDiff,'','restored test-copy tree does not match the source HEAD');

  const restoredSource=fs.readFileSync(path.join(worktree,transferPath),'utf8');
  const restoredLifecycleLoader=ownerLoaderBody(restoredSource,'lifecycle170.js');
  assert(restoredLifecycleLoader.includes('script.onerror = () => window.FPStartup174?.fail();'),'restore did not return the 180.10 Lifecycle170 failure connection');

  const restoredScenario=run(process.execPath,[targetRegression],{
    cwd:worktree,
    allowFailure:true,
    env:{...process.env,FPCHAT_TEST_ROOT:worktree}
  });
  const restoredOutput=String(restoredScenario.stdout||'')+'\n'+String(restoredScenario.stderr||'');
  assert.equal(restoredScenario.status,0,'target scenario did not pass after restoration\n'+restoredOutput);
  assert(restoredOutput.includes('PASS 180.10 Lifecycle170 fallback failure now reports through the same FPStartup174.fail API'),'restored scenario did not prove the target boundary');

  console.log('PASS 180.13 isolated worktree reverted the exact 180.10 transfer commit');
  console.log('PASS 180.13 rollback changed only public/room-context170.js; neighboring fixes remained intact');
  console.log('PASS 180.13 target init-coordination scenario failed at the expected boundary after rollback');
  console.log('PASS 180.13 revert-of-revert restored a tree identical to the source HEAD');
  console.log('PASS 180.13 target init-coordination scenario passed again after restoration');
} finally {
  if(added){
    git(['worktree','remove','--force',worktree],{allowFailure:true});
  }
  fs.rmSync(tmpBase,{recursive:true,force:true});
}
