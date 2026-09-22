'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8').replace(/\r\n/g,'\n');
const history=fs.readFileSync(path.join(root,'public/history174.js'),'utf8').replace(/\r\n/g,'\n');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8').replace(/\r\n/g,'\n');

function fn(source,name){
  const wrapped='\n'+source;
  const m=new RegExp('\\n\\s*(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(wrapped);
  assert(m,'function missing: '+name);
  const start=Math.max(0,m.index-1);
  const rest=source.slice(start+1);
  const next=/\n\s*(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/g;
  next.lastIndex=1;
  const n=next.exec(rest);
  return n?rest.slice(0,n.index):rest;
}

const queueRead=fn(app,'queueReadIds');
const flushRead=fn(app,'flushPendingReads');
const markRead=fn(app,'markMessageRead');
const markIncomingRead=fn(app,'markIncomingMessagesRead');
const markReceived=fn(app,'markMessagesReceived');
const flushReceived=fn(app,'flushPendingReceived');
const unread=fn(app,'updateUnreadIndicators');
const recompute=fn(app,'recomputePendingUnread');
const ackRead=fn(app,'acknowledgeRead');
const wsStatus=fn(app,'handleWsMessageStatus');
const defer=fn(history,'defer');

// Delivery is separate from actual read.
assert(markReceived.includes('queueReceivedMessageIds(roomId,deviceId,messageIds);'),'delivery no longer enters received queue');
assert(markReceived.includes('flushPendingReceived(roomId,deviceId)'),'delivery no longer uses received flush');
assert(flushReceived.includes("type:'message:received'"),'single delivery payload changed');
assert(flushReceived.includes("type:'message:received:bulk'"),'bulk delivery payload changed');
assert(!flushReceived.includes("message:read:bulk"),'delivery flush became a read flush');
assert(server.includes("payload.type === 'message:received' || (payload.type === 'message:received:bulk'"),'server received handler changed');
assert(server.includes('for (const id of ids) markMessageReceived(room, recipient.id, id);'),'server delivery transition changed');
assert(server.includes("status: 'delivered'"),'server delivered status broadcast missing');

// Actual read still has the old visibility/node/incoming/read guards.
assert(markRead.includes("if(document.visibilityState!=='visible')return;"),'background tab can now mark read');
assert(markRead.includes("const msgEl=box?.querySelector"),'read no longer requires a mounted message node');
assert(markRead.includes("if(msgEl.dataset.incoming!=='1')return;"),'outgoing message can now enter read handler');
assert(markRead.includes("if(msgEl.dataset.read==='1')return;"),'already-read guard changed');
assert(markRead.includes("rememberMessageStatus(state.roomId,id,'read');"),'local canonical read status update changed');
assert(markRead.includes('markIncomingMessagesRead(state.roomId,activeChatDeviceId,[id]);'),'actual read no longer enters existing pending-read queue');

// Intersection visibility remains one admission path, not a new status model.
assert(app.includes("unreadVisibleObserver=new IntersectionObserver((entries)=>{if(document.visibilityState!=='visible')return;"),'visible observer document guard changed');
assert(app.includes('if(!entry.isIntersecting)return;'),'intersection admission changed');
assert(app.includes("if(el.dataset.incoming!=='1')return;"),'observer incoming guard changed');
assert(app.includes("if(el.dataset.read==='1')return;"),'observer already-read guard changed');
assert(app.includes('markMessageRead(el.dataset.messageId||el.dataset.id);'),'observer no longer delegates to existing read handler');
assert(app.includes('},{root:box,threshold:0.2});'),'observer threshold changed');
assert(app.includes("function observeUnreadMessage(el){if(initialMessagesScrollPending||!el||!unreadVisibleObserver)return;"),'initial render can now observe/read too early');

// Existing explicit UX paths still delegate to the same handler.
assert(app.includes('function markReplyTargetRead(messageId){markMessageRead(messageId);}'),'reply-target read path changed');
assert(app.includes("if(w.dataset.incoming==='1'&&w.dataset.read!=='1')markMessageRead(m.id);"),'media click read path changed');
assert(app.includes('if(nearBottom){\n      markMessageRead(messageId);'),'near-bottom incoming read path changed');

// Pending read + flush contract stays the same.
assert(queueRead.includes('pendingReadQueue.set(roomId,{deviceId,ids:new Set(),sentAt:0,retryTimer:null})'),'pending read queue shape changed');
assert(queueRead.includes('ids.forEach((id)=>entry.ids.add(id));'),'pending read dedupe Set changed');
assert(markIncomingRead.includes('queueReadIds(roomId,deviceId,ids);'),'read no longer queues before flush');
assert(markIncomingRead.includes('const flushed=flushPendingReads(roomId,deviceId);'),'read flush call changed');
assert(flushRead.includes('state.ws.readyState!==WebSocket.OPEN||wsDeviceId!==deviceId'),'read flush WS/device guard changed');
assert(flushRead.includes('if(entry.sentAt&&Date.now()-entry.sentAt<1000)return true;'),'read resend throttle changed');
assert(flushRead.includes("type:'message:read:bulk'"),'read bulk payload changed');
assert(flushRead.includes('},1500);'),'read retry delay changed');
assert(wsStatus.includes("if(status==='read')acknowledgeRead(roomId,payload.messageId);"),'read status no longer acknowledges pending id');
assert(ackRead.includes('entry.ids.delete(Number(messageId));'),'read ACK no longer removes id');
assert(ackRead.includes('pendingReadQueue.delete(roomId);'),'empty read queue cleanup changed');
assert(server.includes("if (payload.type === 'message:read:bulk' && Array.isArray(payload.messageIds))"),'server bulk-read handler changed');
assert(server.includes("status: 'read'"),'server read status broadcast missing');

// Unread presentation is derived UI state, separate from delivery/read transport.
assert(recompute.includes("document.querySelectorAll('.bubble-wrap[data-incoming=\"1\"][data-read=\"0\"]')"),'mounted unread selector changed');
assert(unread.includes('const count=loadedCount+unloadedCount;'),'unread presentation no longer combines mounted + offscreen state');
assert(unread.includes('const visibleCount=unloadedCount>0?count:(atBottom?0:loadedCount);'),'unread badge/pill presentation rule changed');
assert(unread.includes('syncUnreadDivider(box);'),'unread divider is no longer presentation-only update path');
assert(unread.includes('renderNewMessagesPill(visibleCount);'),'new-message pill update changed');
assert(defer.includes("if(!mine&&!result.isDuplicate&&message.status!=='read')h.unloadedUnreadCount++;"),'offscreen unread accounting changed');

// Status model itself must remain the existing four-level model.
assert(app.includes("const MESSAGE_STATUS_RANK=Object.freeze({sending:0,sent:1,delivered:2,read:3});"),'message status model changed');

console.log('PASS 178.11 delivery remains message:received → delivered and is separate from read');
console.log('PASS actual read keeps visible-tab/mounted/incoming/unread admission and existing UX delegates');
console.log('PASS pending reads keep Set batching, message:read:bulk, retry and status ACK cleanup');
console.log('PASS unread divider/badge/pill remain presentation derived from mounted + unloaded unread');
