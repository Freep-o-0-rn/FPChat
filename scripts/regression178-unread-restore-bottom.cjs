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

// Current opening contract: an authoritative initialWindow target wins; for
// legacy/no-initialWindow payloads, a real saved old-history anchor wins over
// unread, while a saved true-tail state falls through to first unread.
const initialWindowTail=initialTarget.indexOf("if(initialWindow?.mode==='tail')return null;");
const initialWindowAround=initialTarget.indexOf("if(initialWindow?.mode==='around'&&Number.isSafeInteger(serverTargetId)&&serverTargetId>0)return serverTargetId;");
const savedGate=initialTarget.indexOf("if(!data?.viewState?.atBottom){");
const restorePick=initialTarget.indexOf('const savedAnchorId=Number(data?.viewState?.anchorMessageId);');
const unreadPick=initialTarget.indexOf('if(unreadCount>0&&Number.isSafeInteger(firstUnreadId)&&firstUnreadId>0)return firstUnreadId;');
assert(initialWindowTail>=0&&initialWindowAround>initialWindowTail&&savedGate>initialWindowAround&&restorePick>savedGate&&unreadPick>restorePick,
  'initial hydrate target no longer preserves initialWindow -> saved old history -> unread/tail contract');

const applyStart=app.indexOf('  async applyInitial(viewState){');
const applyEnd=app.indexOf('\n  stop(){',applyStart);
assert(applyStart>=0&&applyEnd>applyStart,'scrollCoordinator.applyInitial missing');
const apply=app.slice(applyStart,applyEnd);
const explicitFocus=apply.indexOf("if(intent?.type==='focus'){");
const explicitBottom=apply.indexOf("if(intent?.type==='bottom'){");
const savedTarget=apply.indexOf("const savedTarget=!viewState?.atBottom?getViewStateMessageElement(box,viewState):null;");
const savedBranch=apply.indexOf('if(savedTarget){');
const unreadBranch=apply.indexOf('}else if(unreadTarget){');
const finalBottom=apply.indexOf('}else{',unreadBranch);
assert(explicitFocus>=0&&explicitBottom>explicitFocus&&savedTarget>explicitBottom&&savedBranch>savedTarget&&unreadBranch>savedBranch&&finalBottom>unreadBranch,
  'opening explicit/saved/unread/bottom priority changed');
assert(apply.includes("this.write(box,box.scrollTop+rect.bottom-boxRect.top-box.clientHeight+8,'auto');"),
  'first-unread positioning formula changed');
assert(apply.includes("this.write(box,box.scrollTop+rect.top-boxRect.top-offset,'auto');"),
  'saved-position restore formula changed');
assert(apply.includes("this.write(box,box.scrollHeight,'auto');"),
  'opening bottom target changed');

// A bounded window with newer messages is never considered the real bottom.
assert(atBottom.includes('if(activeChatHistory?.hasNewer||activeChatHistory?.localNewer174)return false;'),
  'bounded history can now report bottom while newer messages are outside DOM');

// The down/new-messages control remains an explicit user intent and routes
// through History174 before local unread/tail fallbacks.
assert(app.includes("document.getElementById('newMessagesPill').onclick=()=>{scrollCoordinator.noteUserIntent(document.getElementById('messages'));if(window.FPHistory174){void FPHistory174.goToUnread();return;}"),
  'new-messages pill no longer records explicit intent and delegates to FPHistory174');
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
assert(requestBottom.includes("if(this.phase==='opening'){this.pendingIntent={type:'bottom'};return;}"),
  'opening explicit-bottom intent is no longer deferred through FPScroll173');
assert(requestBottom.includes("if((activeChatHistory?.hasNewer||activeChatHistory?.localNewer174)&&window.FPHistory174){void FPHistory174.jump();return;}"),
  'bottom request no longer jumps to the actual history tail');
assert(jump.includes('if(history.tailJump174)return history.tailJump174;'),
  'tail jump deduplication changed');

console.log('PASS 178.25 opening keeps initialWindow and saved old-history ahead of unread, while true-tail falls through to unread');
console.log('PASS 178.25 explicit focus/bottom intents outrank background restore and keep existing formulas');
console.log('PASS 178.25 bounded history is not mistaken for the real bottom');
console.log('PASS 178.25 down/new-message transition uses unread focus or FPHistory174 tail jump under the old conditions');
