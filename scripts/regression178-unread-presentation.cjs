'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8').replace(/\r\n/g,'\n');
const history=fs.readFileSync(path.join(root,'public/history174.js'),'utf8').replace(/\r\n/g,'\n');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8').replace(/\r\n/g,'\n');
const sw=fs.readFileSync(path.join(root,'public/sw.js'),'utf8').replace(/\r\n/g,'\n');

function exactFn(source,name){
  const m=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(source);
  assert(m,'function missing: '+name);
  const start=m.index;
  const paramsEnd=source.indexOf(')',start);
  assert(paramsEnd>=0,'function parameters missing: '+name);
  const brace=source.indexOf('{',paramsEnd);
  let depth=0;
  for(let i=brace;i<source.length;i+=1){
    if(source[i]==='{')depth+=1;
    else if(source[i]==='}'){depth-=1;if(depth===0)return source.slice(start,i+1);}
  }
  assert.fail('function end missing: '+name);
}

const append=exactFn(app,'appendMessage');
const syncDivider=exactFn(app,'syncUnreadDivider');
const updateUnread=exactFn(app,'updateUnreadIndicators');
const pill=exactFn(app,'renderNewMessagesPill');
const statusEl=exactFn(app,'updateMessageStatusElement');
const markReceived=exactFn(app,'markMessagesReceived');
const goUnread=exactFn(history,'goToUnread');
const trim=exactFn(history,'trim');
const finishMount=exactFn(history,'finishMount');

// Outgoing mount no longer dismisses the unread divider merely because it auto-scrolls.
assert(!append.includes('dismissUnreadDivider('),'appendMessage still dismisses unread divider on mount');
assert(append.includes("if(autoScroll){scrollCoordinator.requestBottom(box);window.FPHistory174?.trim('newer');}"),'existing outgoing auto-scroll/trim behavior changed');

// History mounting/eviction only re-syncs the divider; it does not dismiss the session.
assert(trim.includes('syncUnreadDivider(box);'),'history trim no longer restores/syncs unread divider');
assert(!trim.includes('dismissUnreadDivider('),'history trim dismisses unread divider');
assert(finishMount.includes('syncUnreadDivider(box);'),'history finishMount no longer syncs unread divider');
assert(!finishMount.includes('dismissUnreadDivider('),'history finishMount dismisses unread divider');
assert(history.includes('appendMessage(scratch,{...message,status:getEffectiveMessageStatus(view.roomId,message)},text,message.sender_device_id===deviceId,false);'),'history render no longer mounts with autoScroll=false');

// Divider anchor is existing first unread/server firstUnread, not outgoing/history insertion.
assert(syncDivider.includes('const firstUnread=getFirstUnreadMessageElement(box);'),'divider no longer anchors to mounted first unread');
assert(syncDivider.includes('const targetId=Number(activeChatHistory?.firstUnreadMessageId);'),'divider lost server firstUnread anchor');
assert(syncDivider.includes('target=firstUnread||serverTarget'),'divider anchor priority changed');

// Badge/pill remain derived from loaded + unloaded unread.
assert(updateUnread.includes('const count=loadedCount+unloadedCount;'),'badge unread total changed');
assert(updateUnread.includes('const visibleCount=unloadedCount>0?count:(atBottom?0:loadedCount);'),'visible unread rule changed');
assert(updateUnread.includes('syncUnreadDivider(box);'),'divider no longer updates with unread presentation');
assert(updateUnread.includes('renderNewMessagesPill(visibleCount);'),'new-message pill update changed');
assert(updateUnread.includes('upsertChat(state.roomId,{unread:visibleCount});'),'chat-list unread badge update changed');
assert(pill.includes("pill.textContent=unreadCount>0?formatUnreadLabel(unreadCount):'Вниз ↓';"),'pill label behavior changed');

// Go-to-unread finds server firstUnread when unread is outside the mounted window,
// otherwise uses the first mounted incoming unread. It focuses, but does not directly mark read.
assert(goUnread.includes('if(history.unloadedUnreadCount>0){'),'unloaded unread path missing');
assert(goUnread.includes("const data=await page(view,{limit:'1'},task.signal);"),'firstUnread server query path changed');
assert(goUnread.includes('first=Number(data.firstUnreadMessageId)||0;'),'server firstUnread identity changed');
assert(goUnread.includes('const target=first?findMessageElement(first)||await jump(first):null;'),'firstUnread jump path changed');
assert(goUnread.includes("const first=box.querySelector('.msg[data-read=\"0\"][data-incoming=\"1\"]');"),'mounted firstUnread query changed');
assert(goUnread.includes("scrollCoordinator.focus(first,'smooth',8)"),'mounted firstUnread focus changed');
assert(!goUnread.includes('markMessageRead('),'goToUnread directly marks read instead of relying on visibility admission');

// Delivery is not read: client queues received separately and DOM data-read flips only for status=read.
assert(markReceived.includes('queueReceivedMessageIds(roomId,deviceId,messageIds);'),'delivery queue path changed');
assert(markReceived.includes('flushPendingReceived(roomId,deviceId)'),'delivery flush path changed');
assert(!markReceived.includes('markIncomingMessagesRead('),'delivery path enters read queue');
assert(statusEl.includes("if(normalized==='read'&&el.dataset.incoming==='1'){el.dataset.read='1';"),'DOM read flag no longer requires read status');
assert(server.includes("markDelivered: db.prepare(`UPDATE messages SET status=CASE WHEN status='sent' THEN 'delivered' ELSE status END"),'server delivery transition changed');
assert(server.includes("status: 'delivered'"),'server delivered broadcast missing');

// Push is presentation-only: notification send/service worker never marks DB/client message read.
const pushFn=exactFn(server,'sendPushForMessage');
assert(pushFn.includes('webpush.sendNotification'),'push sender missing');
assert(!pushFn.includes('markReadBulk')&&!pushFn.includes("status: 'read'")&&!pushFn.includes('markMessageReceived'),'push sender mutates message read/delivery state');
assert(sw.includes("self.addEventListener('push'"),'service-worker push handler missing');
assert(!sw.includes('message:read:bulk')&&!sw.includes("status: 'read'"),'service worker push path marks read');

console.log('PASS 178.14 outgoing/history mount do not dismiss unread divider');
console.log('PASS divider/badge/pill still derive from first unread plus loaded/unloaded unread state');
console.log('PASS goToUnread focuses server/mounted first unread without directly marking it read');
console.log('PASS delivery and push remain separate from actual read');
