'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const history=read('public/history174.js');
const styles=read('public/styles.css');

function functionSource(source,name){
  const wrapped='\n'+source;
  const match=new RegExp('\\n\\s*(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(wrapped);
  assert(match,'function missing: '+name);
  const start=Math.max(0,match.index-1);
  const rest=source.slice(start+1);
  const next=/\n\s*(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/g;
  next.lastIndex=1;
  const found=next.exec(rest);
  return found?rest.slice(0,found.index):rest;
}

const load=functionSource(history,'load');
const loadPending=functionSource(history,'loadPending');
const trim=functionSource(history,'trim');
const mounted=functionSource(history,'mounted');

// Critical conflict rule: network/decrypt/render complete before the visible anchor is captured.
const fetchIndex=load.indexOf("const data=await page(view,{[direction==='older'?'before':'after']:String(cursor)},task.signal);");
const renderIndex=load.indexOf('const scratch=await render(view,unique,history.deviceId,task.current);');
const anchorIndex=load.indexOf('const anchor=getFirstVisibleMessageAnchor(box),total=unread(box)+history.unloadedUnreadCount;');
const mountIndex=load.indexOf("if(direction==='older')box.insertBefore(fragment,box.querySelector('.bubble-wrap.msg'));",anchorIndex);
const restoreIndex=load.indexOf('finishMount(history,box,total);restoreAnchor(box,anchor);trim(direction);',mountIndex);
assert(fetchIndex>=0&&renderIndex>fetchIndex&&anchorIndex>renderIndex&&mountIndex>anchorIndex&&restoreIndex>mountIndex,
  'history anchor is no longer captured at the DOM mutation boundary');

// Local pending-history path follows the same capture -> mount -> restore rule.
const pendingAnchor=loadPending.indexOf('const anchor=getFirstVisibleMessageAnchor(box),total=unread(box)+history.unloadedUnreadCount;');
const pendingMount=loadPending.indexOf("if(direction==='older')box.insertBefore(fragment,nodes(box).find(n=>!Number.isSafeInteger(id(n)))||null);",pendingAnchor);
const pendingRestore=loadPending.indexOf('finishMount(history,box,total);restoreAnchor(box,anchor);trim(direction);return true;',pendingMount);
assert(pendingAnchor>=0&&pendingMount>pendingAnchor&&pendingRestore>pendingMount,
  'pending history no longer preserves the current user anchor around prepend');

// Bounded-DOM trim also preserves the current visible anchor.
const trimAnchor=trim.indexOf('const anchor=getFirstVisibleMessageAnchor(box);');
const trimLoop=trim.indexOf('while(mounted.length>LIMIT)',trimAnchor);
const trimRestore=trim.indexOf('rebuildDateSeparators(box);syncUnreadDivider(box);restoreAnchor(box,anchor);',trimLoop);
assert(trimAnchor>=0&&trimLoop>trimAnchor&&trimRestore>trimLoop,
  'bounded DOM trim can evict without restoring the current visible anchor');

// Native user scroll only triggers history loading; it does not save a stale pre-request anchor.
assert(mounted.includes("box.addEventListener('scroll',()=>{"),'history scroll observer missing');
assert(mounted.includes("if(scrollCoordinator.isOpening())return;"),'history scroll can run during opening');
assert(mounted.includes("if(box.scrollTop<=CHAT_HISTORY_LOAD_THRESHOLD_PX)void load('older');"),'older lazy-history trigger changed');
assert(!mounted.includes('getFirstVisibleMessageAnchor('),'scroll event started freezing an anchor before async history load');

// Browser anchoring must not compete with FPScroll173.
assert(mounted.includes("box.style.overflowAnchor='none';"),'FPHistory174 no longer disables browser scroll anchoring');
assert(styles.includes('.chat-view .messages{')&&styles.includes('overflow-anchor:none;'),
  'messages CSS no longer disables browser scroll anchoring');

// Media geometry exists before thumbnail completion.
assert(styles.includes('.media-tile{')&&styles.includes('aspect-ratio:1/1'),
  'message media tile lost its pre-load aspect ratio');
assert(styles.includes('.media-thumb{')&&styles.includes('width:100%;height:100%'),
  'thumbnail no longer fills reserved media geometry');

console.log('PASS 178.24 async older load captures the visible anchor only at the DOM mutation boundary');
console.log('PASS 178.24 pending-history and bounded trim preserve the then-current anchor');
console.log('PASS 178.24 native scroll does not freeze a stale pre-fetch anchor');
console.log('PASS 178.24 browser anchoring is disabled and media reserves 1:1 geometry before thumbnail load');
