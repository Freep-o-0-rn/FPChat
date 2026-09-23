'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const history = fs.readFileSync(path.join(root, 'public/history174.js'), 'utf8').replace(/\r\n/g, '\n');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');
const selection = fs.readFileSync(path.join(root, 'public/message-selection.js'), 'utf8').replace(/\r\n/g, '\n');
const storeSource = fs.readFileSync(path.join(root, 'public/message-store172.js'), 'utf8').replace(/\r\n/g, '\n');
const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8').replace(/\r\n/g, '\n');

assert(history.includes('const LIMIT=300, PAGE=100;'), 'bounded DOM limit/page changed');
assert(history.includes('while(mounted.length>LIMIT)'), 'trim no longer bounds mounted DOM');
assert(history.includes('const total=unread(box)+history.unloadedUnreadCount;'), 'trim no longer preserves total unread');
assert(history.includes('history.unloadedUnreadCount=Math.max(0,total-unread(box));'), 'evicted unread is no longer retained offscreen');
assert(history.includes("if(!mine&&!result.isDuplicate&&message.status!=='read')h.unloadedUnreadCount++;"), 'deferred incoming unread changed');
assert(app.includes('const count=loadedCount+unloadedCount;'), 'unread UI no longer combines mounted + unloaded unread');

assert(selection.includes("window.FPDOM173.on('message', 'unmounted', ({ node }) => {"), 'selection is no longer bound to FPDOM173 unmount');
assert(selection.includes("if (node.dataset.fpEvicted174) return; // Window eviction keeps the selection's ids."), 'selection ids are lost on bounded eviction');
assert(indexHtml.includes("'app.js':['room-context170.js','lifecycle170.js','network171.js','message-store172.js','dom-lifecycle173.js'"), 'FPDOM173 startup ownership changed');

assert(history.includes("const pending=roomId=>window.FPMessageStore172?.pending(roomId)||[];"), 'History174 pending source changed');
assert(history.includes('appendMessage(scratch,{...record.raw,id:record.id||record.clientMessageId,status:record.status},record.text,true,false);'), 'pending remount no longer uses Store record');
assert(storeSource.includes('if (record.clientMessageId && !record.id) continue; // keep optimistic sends until ack/reload'), 'Store can prune unacked optimistic record');
assert(storeSource.includes('.filter(record => !record.id && record.clientMessageId && !record.deleted)'), 'Store pending() contract changed');
assert(app.includes('pendingTextSends.set(clientMessageId,pending);'), 'retry state is no longer independent from DOM');

const promoteStart = app.indexOf('function promoteMessageElement');
const promoteEnd = app.indexOf('function acknowledgeRead', promoteStart);
assert(promoteStart >= 0 && promoteEnd > promoteStart, 'promoteMessageElement missing');
const promote = app.slice(promoteStart, promoteEnd);
assert(promote.includes('window.FPMessageStore172?.promote?.(roomId,clientMessageId,messageId,{status,createdAt})'), 'ACK promotion no longer updates Store');
assert(promote.indexOf('window.FPMessageStore172?.promote?.') < promote.indexOf('const el=findMessageElement'), 'ACK looks for DOM before canonical promotion');
assert(promote.includes('if(!el)return false;'), 'offscreen ACK no longer tolerates missing DOM');

const events=[];
const sandbox={console,Date,Map,Set,Object,String,Number,Boolean,Array,Math,CustomEvent:class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}}};
sandbox.window={addEventListener(){},dispatchEvent(e){events.push(e);return true;},FPRuntime:null};
vm.createContext(sandbox);
vm.runInContext(storeSource,sandbox,{filename:'message-store172.js'});
const store=sandbox.window.FPMessageStore172;
assert(store,'FPMessageStore172 did not initialize');

const room='room-178-7';
const optimistic=store.upsert(room,{id:'client-pending-1787',client_message_id:'client-pending-1787',type:'text',status:'sending',created_at:'2026-09-22T14:00:00.000Z'},{text:'pending',preview:'pending',source:'optimistic'}).record;
for(let i=1;i<=2100;i++){store.upsert(room,{id:i,type:'text',status:'sent',created_at:'2026-09-22T14:00:01.000Z'},{text:'m'+i,preview:'m'+i,source:'history'});}
assert.strictEqual(store.get(room,'client-pending-1787'),optimistic,'Store pruning evicted unacked optimistic record');
assert(store.pending(room).some(r=>r===optimistic),'optimistic record disappeared from pending()');
store.updateStatus(room,3001,'delivered','client-pending-1787');
const promoted=store.promote(room,'client-pending-1787',3001,{status:'delivered'});
assert.strictEqual(promoted,optimistic,'ACK replaced pending canonical record');
assert.equal(promoted.id,3001,'ACK did not attach numeric id');
assert.equal(promoted.status,'delivered','ACK lost delivered status');
assert.strictEqual(store.get(room,3001),promoted,'numeric lookup failed after ACK');
assert(!store.pending(room).includes(promoted),'ACKed record remains optimistic pending');

console.log('PASS 178.7 bounded DOM remains LIMIT=300 / PAGE=100');
console.log('PASS evicted/deferred unread is preserved outside the mounted window');
console.log('PASS FPDOM173 eviction preserves selection ids');
console.log('PASS optimistic Store/retry state survives DOM eviction and ACK without a node');
