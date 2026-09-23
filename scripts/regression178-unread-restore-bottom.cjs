'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const app=read('public/app.js');
const history=read('public/history174.js');

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

const initialTarget=functionSource(app,'getInitialScrollTargetId');
const atBottom=functionSource(app,'isMessagesAtBottom');
const pill=functionSource(app,'renderNewMessagesPill');
const goUnread=functionSource(history,'goToUnread');
const jump=functionSource(history,'jump');

// Hydration target keeps the established opening decision: unread -> saved anchor -> tail.
const unreadPick=initialTarget.indexOf('if(unreadCount>0&&Number.isSafeInteger(firstUnreadId)&&firstUnreadId>0)return firstUnreadId;');
const atBottomPick=initialTarget.indexOf('if(data?.viewState?.atBottom)return null;');
const restorePick=initialTarget.indexOf('const savedAnchorId=Number(data?.viewState?.anchorMessageId);');
assert(unreadPick>=0&&atBottomPick>unreadPick&&restorePick>atBottomPick,'initial hydrate target priority changed');

const applyStart=app.indexOf('  async applyInitial(viewState){');
const applyEnd=app.indexOf('\n  stop(){',applyStart);
assert(applyStart>=0&&applyEnd>applyStart,'scrollCoordinator.applyInitial missing');
const apply=app.slice(applyStart,applyEnd);
const unreadBranch=apply.indexOf('if(unreadTarget){');
const noUnreadBranch=apply.indexOf("}else if(!activeChatHistory?.unreadCount&&!activeChatHistory?.unloadedUnreadCount){");
const bottomBranch=apply.indexOf('if(viewState?.atBottom){');
const restoreBranch=apply.indexOf('const target=getViewStateMessageElement(box,viewState);');
assert(unreadBranch>=0&&noUnreadBranch>unreadBranch&&bottomBranch>noUnreadBranch&&restoreBranch>bottomBranch,
  'opening unread/restore/bottom branch order changed');
assert(apply.includes("this.write(box,box.scrollTop+rect.bottom-boxRect.top-box.clientHeight+8,'auto');"),
  'first-unread positioning formula changed');
assert(apply.includes("this.write(box,box.scrollTop+rect.top-boxRect.top-offset,'auto');"),
  'saved-position restore formula changed');
assert(apply.includes("this.write(box,box.scrollHeight,'auto');"),
  'opening bottom target changed');

// A bounded window with newer messages is never considered the real bottom.
assert(atBottom.includes('if(activeChatHistory?.hasNewer||activeChatHistory?.localNewer174)return false;'),
  'bounded history can now report bottom while newer messages are outside DOM');

// The down/new-messages control keeps its old route: History174 first, then unread or real tail.
assert(app.includes("document.getElementById('newMessagesPill').onclick=()=>{if(window.FPHistory174){void FPHistory174.goToUnread();return;}"),
  'new-messages pill no longer delegates to FPHistory174 when present');
assert(pill.includes("pill.textContent=unreadCount>0?formatUnreadLabel(unreadCount):'Вниз ↓';"),
  'down/new-message pill label rule changed');
assert(goUnread.includes('if(history.unloadedUnreadCount>0){'),'unloaded unread path missing');
assert(goUnread.includes("const first=box.querySelector('.msg[data-read=\"0\"][data-incoming=\"1\"]');"),
  'mounted first-unread lookup changed');
assert(goUnread.includes("if(first)scrollCoordinator.focus(first,'smooth',8);"),
  'mounted unread focus behavior changed');
assert(goUnread.includes('else scrollCoordinator.requestBottom(box);'),
  'no-unread down transition no longer requests the real bottom');

// requestBottom must load the actual tail when a bounded history window has newer content.
const bottomStart=app.indexOf('requestBottom(box=this.box)');
const bottomEnd=app.indexOf('focus(target',bottomStart);
assert(bottomStart>=0&&bottomEnd>bottomStart,'requestBottom missing');
const requestBottom=app.slice(bottomStart,bottomEnd);
assert(requestBottom.includes("if((activeChatHistory?.hasNewer||activeChatHistory?.localNewer174)&&this.phase!=='opening'&&window.FPHistory174){void FPHistory174.jump();return;}"),
  'bottom request no longer jumps to the actual history tail');
assert(jump.includes('if(history.tailJump174)return history.tailJump174;'),
  'tail jump deduplication changed');

console.log('PASS 178.25 opening keeps first-unread before saved restore and bottom');
console.log('PASS 178.25 saved anchor and explicit atBottom keep their existing formulas');
console.log('PASS 178.25 bounded history is not mistaken for the real bottom');
console.log('PASS 178.25 down/new-message transition uses unread focus or FPHistory174 tail jump under the old conditions');
