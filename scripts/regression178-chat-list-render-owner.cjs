'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');

function functionSource(source, name) {
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

const legacyEntry=functionSource(app,'renderChats');
const ownerRender=functionSource(app,'renderChatList174');
const flush=functionSource(app,'flushChatList174');
const createRow=functionSource(app,'createChatRow174');
const updateRow=functionSource(app,'updateChatRow174');

assert(legacyEntry.includes('return window.FPChatList174.render();'),'legacy renderChats is not a pure FPChatList174 delegate');
assert(!legacyEntry.includes('chatListRevision174++'),'legacy renderChats still owns render scheduling');
assert(app.includes('window.FPChatList174=Object.freeze({render:renderChatList174,'),'FPChatList174 does not own the render entry');

assert(ownerRender.includes('chatListRevision174++;'),'owner render lost revision scheduling');
assert(ownerRender.includes('requestAnimationFrame(resolve)'),'owner render lost existing frame batching');
assert(ownerRender.includes('.then(flushChatList174)'),'owner render no longer uses existing flush');

assert(flush.includes("const q=els.search.value?.toLowerCase()||'';"),'search query behavior changed');
assert(flush.includes("state.chats.filter(c=>[state.roomNames[c.roomId]||'',c.roomId,c.lastMessage||''].some(value=>value.toLowerCase().includes(q)))"),'search fields changed');
assert(flush.includes('const wanted=new Set(chats.map(c=>c.roomId));'),'row key set is no longer roomId');
assert(flush.includes('let entry=chatRows174.get(c.roomId);'),'existing row is no longer looked up by roomId');
assert(flush.includes('if(!entry){entry={row:createChatRow174(c),signature:null};chatRows174.set(c.roomId,entry);}'),'row identity/reuse contract changed');
assert(flush.includes('if(entry.signature!==signature){updateChatRow174(entry.row,c);entry.signature=signature;}'),'existing row update path changed');
assert(flush.includes('if(next!==entry.row)els.rows.insertBefore(entry.row,next||null);'),'existing row reorder no longer preserves the row object');

assert(flush.includes("JSON.stringify([state.roomNames[c.roomId],c.lastMessage,c.lastSender,c.unread,formatChatListTime(c.lastActivity),state.roomMute[c.roomId],c.roomId===state.roomId,state.nick,draft?.text,Boolean(draft?.replyTo)])"),'preview/draft/unread render signature changed');
assert(updateRow.includes('const draft=state.drafts[c.roomId];'),'draft rendering changed');
assert(updateRow.includes("c.unread>0?"),'unread badge rendering changed');
assert(updateRow.includes("displayLastMessage=safeText(c.lastMessage||'')"),'last-message preview rendering changed');

assert(createRow.includes('row.dataset.roomId=c.roomId;'),'row dataset key changed');
assert(createRow.includes('openChat(c.roomId);'),'row click handler changed');
assert(createRow.includes('showRoomMenu(c.roomId,e.clientX,e.clientY);'),'row context-menu handler changed');
assert(createRow.includes("showRoomMenu(c.roomId,startX,startY);navigator.vibrate?.(10);"),'row long-press handler changed');

assert(app.includes('els.search.oninput=renderChats;'),'search still enters through the compatibility render entry');

console.log('PASS 178.8 renderChats delegates to FPChatList174.render');
console.log('PASS roomId row keys and existing row object reuse are preserved');
console.log('PASS search, preview, draft/unread signature and row handlers are unchanged');
