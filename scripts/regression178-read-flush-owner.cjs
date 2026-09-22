'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=process.env.FPCHAT_TEST_ROOT||path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8').replace(/\r\n/g,'\n');

function exactFn(source,name){
  const m=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(source);
  assert(m,'function missing: '+name);
  const start=m.index;
  const brace=source.indexOf('{',start);
  let depth=0;
  for(let i=brace;i<source.length;i+=1){
    if(source[i]==='{')depth+=1;
    else if(source[i]==='}'){depth-=1;if(depth===0)return source.slice(start,i+1);}
  }
  assert.fail('function end missing: '+name);
}

const queue=exactFn(app,'queueReadIds');
const worker=exactFn(app,'flushPendingReadsWorker178');
const compat=exactFn(app,'flushPendingReads');
const mark=exactFn(app,'markIncomingMessagesRead');
const ack=exactFn(app,'acknowledgeRead');

assert(app.includes('const pendingReadQueue=new Map();'),'existing pendingReadQueue missing');
assert((app.match(/pendingReadQueue=new Map\(\)/g)||[]).length===1,'a second pending read queue was introduced');
assert(app.includes('const FPReadState178=Object.freeze({admitVisible:admitVisibleMessageRead178,flushPending:flushPendingReadsWorker178});'),'FPReadState178 does not own flushPending');
assert(compat.includes('window.FPReadState178?.flushPending?.(roomId,deviceId)'),'legacy flushPendingReads is not a facade delegate');

assert(queue.includes('pendingReadQueue.set(roomId,{deviceId,ids:new Set(),sentAt:0,retryTimer:null})'),'pending queue shape changed');
assert(queue.includes('ids.forEach((id)=>entry.ids.add(id));'),'Set batching/dedupe changed');
assert(worker.includes('state.ws.readyState!==WebSocket.OPEN||wsDeviceId!==deviceId'),'WS/device admission changed');
assert(worker.includes('if(entry.sentAt&&Date.now()-entry.sentAt<1000)return true;'),'1000ms resend throttle changed');
assert(worker.includes("state.ws.send(JSON.stringify({type:'message:read:bulk',roomId,messageIds}))"),'message:read:bulk payload changed');
assert(worker.includes('entry.retryTimer=setTimeout(()=>{'),'retry timer removed');
assert(worker.includes('},1500);'),'1500ms retry changed');
assert(worker.includes('entry.sentAt=0;flushPendingReads(roomId,entry.deviceId);'),'retry no longer re-enters the single public flush command');
assert(worker.includes('catch{entry.sentAt=0;clearTimeout(entry.retryTimer);entry.retryTimer=null;return false;}'),'send failure semantics changed');

assert(mark.includes('queueReadIds(roomId,deviceId,ids);'),'read path no longer queues before flush');
assert(mark.includes('const flushed=flushPendingReads(roomId,deviceId);'),'read path no longer uses compatibility flush command');
assert(mark.includes('ensureWsConnected(deviceId).then(()=>{flushPendingReads(roomId,deviceId);})'),'reconnect retry no longer enters same flush command');
assert(ack.includes('entry.ids.delete(Number(messageId));'),'read ACK removal changed');
assert(ack.includes('entry.sentAt=0;flushPendingReads(roomId,entry.deviceId);'),'remaining ACK batch no longer re-enters same flush command');

// Semantic execution of the real queue + worker: two ids are one bulk payload.
const sent=[];
const timers=[];
const pendingReadQueue=new Map();
const state={roomId:'room',ws:{deviceId:'dev',readyState:1,send(raw){sent.push(JSON.parse(raw));}}};
const activeChatDeviceId='dev';
const WebSocket={OPEN:1};
let now=10000;
const DateStub={now:()=>now};
const clearTimeoutStub=()=>{};
const setTimeoutStub=(fn,ms)=>{timers.push({fn,ms});return timers.length;};
const factory=new Function('pendingReadQueue','state','activeChatDeviceId','WebSocket','Date','clearTimeout','setTimeout','window',
  queue+'\n'+worker+'\n'+compat+'\nreturn {queueReadIds,flushPendingReadsWorker178,flushPendingReads};');
const windowStub={FPReadState178:null};
const api=factory(pendingReadQueue,state,activeChatDeviceId,WebSocket,DateStub,clearTimeoutStub,setTimeoutStub,windowStub);
windowStub.FPReadState178={flushPending:api.flushPendingReadsWorker178};

api.queueReadIds('room','dev',[11,12,11]);
assert.equal(pendingReadQueue.size,1,'queue split into multiple room entries');
assert.deepEqual([...pendingReadQueue.get('room').ids],[11,12],'Set batching/dedupe changed');
assert.equal(api.flushPendingReads('room','dev'),true,'bulk flush failed');
assert.deepEqual(sent,[{type:'message:read:bulk',roomId:'room',messageIds:[11,12]}],'bulk payload changed');
assert.equal(timers.length,1,'flush scheduled unexpected retry count');
assert.equal(timers[0].ms,1500,'retry delay changed');

// A second call inside 1000ms must not send another batch.
now=10500;
assert.equal(api.flushPendingReads('room','dev'),true,'throttled flush should report handled');
assert.equal(sent.length,1,'1000ms throttle allowed duplicate send');

console.log('PASS 178.13 FPReadState178 owns flushPending while legacy flushPendingReads delegates');
console.log('PASS one pendingReadQueue remains; Set batching and message:read:bulk are unchanged');
console.log('PASS 1000ms throttle and 1500ms retry are preserved');
console.log('PASS reconnect/retry/ACK paths re-enter the same public flush command');
