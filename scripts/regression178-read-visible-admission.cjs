'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8').replace(/\r\n/g,'\n');

function fn(source,name){
  const match=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(source);
  assert(match,'function missing: '+name);
  const start=match.index;
  const brace=source.indexOf('{',start);
  assert(brace>=0,'function body missing: '+name);
  let depth=0;
  for(let i=brace;i<source.length;i+=1){
    if(source[i]==='{')depth+=1;
    else if(source[i]==='}'){
      depth-=1;
      if(depth===0)return source.slice(start,i+1);
    }
  }
  assert.fail('function end missing: '+name);
}

const admit=fn(app,'admitVisibleMessageRead178');
const markRead=fn(app,'markMessageRead');

assert(app.includes('window.FPReadState178=FPReadState178;'),'FPReadState178 facade missing');
assert(app.includes('entries.forEach((entry)=>FPReadState178.admitVisible(entry,box));'),'IntersectionObserver no longer delegates only admission to FPReadState178');
assert(app.includes('},{root:box,threshold:0.2});'),'existing IntersectionObserver root/threshold changed');

assert(admit.includes("if(initialMessagesScrollPending||document.visibilityState!=='visible'||!state.roomId||!activeChatDeviceId)return false;"),'visible admission lost opening/background/session guard');
assert(admit.includes("if(!entry?.isIntersecting||!el||document.getElementById('messages')!==box||!box.contains(el)||!el.isConnected)return false;"),'visible admission lost current-box/stale-node guard');
assert(admit.includes("if(el.dataset.incoming!=='1'||el.dataset.read==='1')return false;"),'visible admission lost incoming/unread guard');
assert(admit.includes('markMessageRead(el.dataset.messageId||el.dataset.id);'),'visible admission no longer delegates to old read handler');
assert(!admit.includes('rememberMessageStatus('),'admission created a second status writer');
assert(!admit.includes('markIncomingMessagesRead('),'admission created a second pending/flush path');

// Old handler remains authoritative for actual read side effects.
assert(markRead.includes("if(document.visibilityState!=='visible')return;"),'old read handler background guard changed');
assert(markRead.includes("if(msgEl.dataset.incoming!=='1')return;"),'old read handler incoming guard changed');
assert(markRead.includes("if(msgEl.dataset.read==='1')return;"),'old read handler already-read guard changed');
assert(markRead.includes("rememberMessageStatus(state.roomId,id,'read');"),'old read handler status write changed');
assert(markRead.includes('markIncomingMessagesRead(state.roomId,activeChatDeviceId,[id]);'),'old read handler pending queue path changed');

// Explicit pre-existing UX admissions remain outside this one wrapper.
assert(app.includes('function markReplyTargetRead(messageId){markMessageRead(messageId);}'),'reply-target read entry was moved');
assert(app.includes("if(w.dataset.incoming==='1'&&w.dataset.read!=='1')markMessageRead(m.id);"),'media click read entry was moved');
assert(app.includes('if(nearBottom){\n      markMessageRead(messageId);'),'near-bottom incoming read entry was moved');

// Execute the actual admission function with controlled visibility/current-node state.
const calls=[];
const currentBox={contains(node){return node===currentNode;}};
let currentNode={isConnected:true,dataset:{incoming:'1',read:'0',messageId:'42'}};
let initialMessagesScrollPending=false;
let state={roomId:'room'};
let activeChatDeviceId='device';
let visibilityState='visible';
const documentStub={get visibilityState(){return visibilityState;},getElementById(id){return id==='messages'?currentBox:null;}};
const unreadVisibleObserver={unobserve(node){calls.push(['unobserve',node.dataset.messageId]);}};
const markMessageRead=(id)=>calls.push(['read',String(id)]);
const factory=new Function('initialMessagesScrollPending','document','state','activeChatDeviceId','markMessageRead','unreadVisibleObserver',admit+'\nreturn admitVisibleMessageRead178;');
function run(entry,box=currentBox){return factory(initialMessagesScrollPending,documentStub,state,activeChatDeviceId,markMessageRead,unreadVisibleObserver)(entry,box);}

calls.length=0; visibilityState='hidden';
assert.equal(run({isIntersecting:true,target:currentNode}),false,'background entry was admitted');
assert.deepEqual(calls,[],'background entry reached read handler');

calls.length=0; visibilityState='visible'; initialMessagesScrollPending=true;
assert.equal(run({isIntersecting:true,target:currentNode}),false,'initial-positioning entry was admitted');
assert.deepEqual(calls,[],'not-yet-shown entry reached read handler');

calls.length=0; initialMessagesScrollPending=false;
assert.equal(run({isIntersecting:false,target:currentNode}),false,'non-intersecting entry was admitted');
assert.deepEqual(calls,[],'hidden entry reached read handler');

calls.length=0;
const staleNode={isConnected:false,dataset:{incoming:'1',read:'0',messageId:'42'}};
assert.equal(run({isIntersecting:true,target:staleNode}),false,'stale/removed node was admitted');
assert.deepEqual(calls,[],'stale node reached read handler');

calls.length=0;
assert.equal(run({isIntersecting:true,target:currentNode}),true,'visible current incoming unread node was rejected');
assert.deepEqual(calls,[['read','42'],['unobserve','42']],'visible admission did not delegate exactly once');

console.log('PASS 178.12 IntersectionObserver admission delegates through FPReadState178');
console.log('PASS hidden/background/initial-positioning/stale nodes do not reach markMessageRead');
console.log('PASS visible current incoming unread node reaches the old read handler exactly once');
console.log('PASS old read handler, pending queue/flush and explicit UX read entries are unchanged');
