'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8').replace(/\r\n/g,'\n');
const actions=fs.readFileSync(path.join(root,'public/message-actions.js'),'utf8').replace(/\r\n/g,'\n');
const storeSource=fs.readFileSync(path.join(root,'public/message-store172.js'),'utf8').replace(/\r\n/g,'\n');

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

const canonicalize=fn(app,'canonicalizeIncomingMessageForMount178');
const processIncoming=fn(app,'processStableIncomingMessage');
const append=fn(app,'appendMessage');

assert(app.includes('window.FPMessageRender178=FPMessageRender178;'),'message render facade missing');
assert(app.includes("mountIncoming(box,roomId,message,text,autoScroll=true){\n    canonicalizeIncomingMessageForMount178(roomId,message,text);\n    return appendMessage(box,message,text,false,autoScroll);"),'mountIncoming no longer canonicalizes then delegates exactly once');
assert(canonicalize.includes("source:'ws'"),'incoming mount is not canonicalized with the existing WS priority');
assert(canonicalize.includes('window.FPMessageStore172?.upsert?.(roomId,message'),'incoming mount bypasses MessageStore172');
assert(!canonicalize.includes('appendChild(')&&!canonicalize.includes('innerHTML'),'canonicalization created a second DOM template/path');

assert(processIncoming.includes('FPMessageRender178.mountIncoming(box,roomId,message,text,nearBottom);'),'active incoming mount does not enter the render facade');
const branchStart=processIncoming.indexOf('}else if(inActiveChat){');
const branchEnd=processIncoming.indexOf('}else{',branchStart+1);
const activeIncoming=processIncoming.slice(branchStart,branchEnd);
assert(!activeIncoming.includes('appendMessage(box,message,text,false,nearBottom)'),'active incoming still directly appends outside the render entry');

assert(append.includes('const storeResult=window.FPMessageStore172?.upsert?.(state.roomId,m,{'),'existing renderer no longer reconciles with Store');
assert(append.includes("if(storeResult?.record&&typeof storeResult.record.text==='string'){"),'renderer no longer takes canonical text from Store record');
assert(append.includes('renderText=storeResult.record.text;'),'DOM content is no longer replaced by canonical Store text');
assert((app.match(/function appendMessage\s*\(/g)||[]).length===1,'a second message template function was introduced');

assert(actions.includes('const base = appendMessage;'),'message-actions no longer decorates the existing renderer');
assert(actions.includes('const result = base.apply(this, arguments);'),'message-actions wrapper no longer delegates to the same template');

// Real Store rule: a stronger edit remains canonical when stale WS/render data arrives.
const events=[];
const sandbox={console,Date,Map,Set,Object,String,Number,Boolean,Array,Math,CustomEvent:class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}}};
sandbox.window={addEventListener(){},dispatchEvent(e){events.push(e);return true;},FPRuntime:null};
vm.createContext(sandbox);
vm.runInContext(storeSource,sandbox,{filename:'message-store172.js'});
const store=sandbox.window.FPMessageStore172;
const room='room-178-9';
store.upsert(room,{id:9,type:'text',status:'sent',created_at:'2026-09-22T10:00:00.000Z'},{text:'old',preview:'old',source:'history'});
store.applyEdit(room,{id:9,type:'text',status:'sent',created_at:'2026-09-22T10:00:00.000Z',edited_at:'2026-09-22T10:05:00.000Z'},'edited',{preview:'edited'});
store.upsert(room,{id:9,type:'text',status:'sent',created_at:'2026-09-22T10:00:00.000Z'},{text:'stale ws',preview:'stale ws',source:'ws'});
const renderMerge=store.upsert(room,{id:9,type:'text',status:'sent',created_at:'2026-09-22T10:00:00.000Z'},{text:'stale render',preview:'stale render',source:'render'});
assert.equal(renderMerge.record.text,'edited','render path did not retain stronger canonical Store content');
assert.equal(renderMerge.record.preview,'edited','render preview did not retain stronger canonical Store content');

console.log('PASS 178.9 active incoming mount canonicalizes through MessageStore before DOM');
console.log('PASS existing appendMessage remains the only message template');
console.log('PASS appendMessage renders canonical Store text and message-actions still decorates it');
console.log('PASS stronger edit survives stale WS/render content');
