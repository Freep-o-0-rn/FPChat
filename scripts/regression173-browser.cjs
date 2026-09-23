'use strict';
// Local-only integration tests. Requires Playwright and Chromium; no production
// database, credentials, push subscriptions or external recipients are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright')); }
const root = path.resolve(__dirname, '..');
const failures = [];
let passed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`); }
}
async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpchat-regression173-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.env.FPCHAT_TEST_NODE || process.execPath,
    ['-r', './src/message-actions-bootstrap.js', 'server.js'], {
      cwd:root, env:{...process.env,APP_HOST:'127.0.0.1',APP_PORT:String(port),DATABASE_PATH:path.join(temp,'chat.sqlite'),VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:''},
      stdio:['ignore','pipe','pipe']
    });
  let browser;
  const errors=[];
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Test server did not start')),15000);
      server.stdout.on('data',chunk=>{if(chunk.toString().includes('FPChat listening')){clearTimeout(timer);resolve();}});
      server.stderr.on('data',chunk=>{if(!chunk.toString().includes('Push notifications disabled'))console.error(chunk.toString());});
      server.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited: ${code}`));});
    });
    browser=await playwright.chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
    const newClient=async(options={})=>{
      const page=await browser.newPage(options);
      page.on('pageerror',error=>errors.push(error.message));
      page.on('dialog',dialog=>dialog.dismiss());
      await page.addInitScript(()=>{
        const Native=window.WebSocket;window.auditSockets=[];
        window.WebSocket=class extends Native {constructor(...args){super(...args);auditSockets.push(this);}};
      });
      await page.goto(origin);
      await page.waitForFunction(()=>window.FPMediaSend170&&window.FPVoice&&window.FPViewport173&&!document.getElementById('bootHold152'));
      return page;
    };
    const page=await newClient();
    await check('169–173 boot owners and honest diagnostic coverage',async()=>{
      const result=await page.evaluate(()=>({owners:['FPRuntime','FPRoomContext170','FPLifecycle170','FPConnection170','FPNetwork171','FPMessageStore172','FPDOM173','FPLayer173','FPGesture135','FPScroll173','FPViewport173'].every(name=>!!window[name]),coverage:FPRuntime.snapshot().coverage,errors:FPBoot152.errors(),fetch:fetch===FPNetwork171.fetch,scroll:FPScroll173===scrollCoordinator}));
      assert.equal(result.owners,true);assert.equal(result.fetch,true);assert.equal(result.scroll,true);assert.deepEqual(result.errors,[]);assert.match(result.coverage.timers,/partial/);
    });
    await page.evaluate(async()=>{
      const deviceId=getOrCreateDeviceId();window.auditRooms=[];
      for(const label of ['A','B']){
        const secret='local-test-secret-'+label;
        const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
        const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})});
        const data=await response.json();if(!response.ok)throw Error('Fixture room creation failed');
        STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});upsertChat(data.publicId,{});
        auditRooms.push({id:data.publicId,secret,key:await deriveKey(secret),deviceId,participant:data.participant,inviteLink:data.inviteLink});
      }
      window.auditJoinData=(room,messages=[])=>({participant:room.participant,messages,participants:[],hasMore:false,unreadCount:0,viewState:{atBottom:true}});
    });
    await check('late render A cannot write into B or attach a second history loader',async()=>{
      const result=await page.evaluate(async()=>{
        const [a,b]=auditRooms,original=decryptText;let release,started;
        const gate=new Promise(resolve=>started=resolve);
        decryptText=(iv,c,...rest)=>c==='delayed-A'?(started(),new Promise(resolve=>release=()=>resolve('late A'))):original(iv,c,...rest);
        try {
          const message={id:900001,ciphertext:'delayed-A',iv:'',sender_device_id:a.deviceId,sender_name:'A',type:'text',status:'sent',created_at:new Date().toISOString()};
          const opening=openChatWithJoinData(a.id,a.secret,a.deviceId,auditJoinData(a,[message]),a.key);
          await gate;await openChatWithJoinData(b.id,b.secret,b.deviceId,auditJoinData(b),b.key);
          release();await opening;
          return {active:state.roomId===b.id,foreign:!!FPMessageStore172.get(b.id,900001),loaders:document.querySelectorAll('#historyLoader').length};
        }finally{decryptText=original;}
      });
      assert.deepEqual(result,{active:true,foreign:false,loaders:1});
    });
    await check('A → B → A invalidates the first A render generation',async()=>{
      const result=await page.evaluate(async()=>{
        const [a,b]=auditRooms,original=decryptText;let release,started;
        const gate=new Promise(resolve=>started=resolve);
        decryptText=(iv,c,...rest)=>c==='delayed-A2'?(started(),new Promise(resolve=>release=()=>resolve('old generation'))):original(iv,c,...rest);
        try{
          const message={id:900002,ciphertext:'delayed-A2',iv:'',sender_device_id:a.deviceId,sender_name:'A',type:'text',status:'sent',created_at:new Date().toISOString()};
          const opening=openChatWithJoinData(a.id,a.secret,a.deviceId,auditJoinData(a,[message]),a.key);
          await gate;await openChatWithJoinData(b.id,b.secret,b.deviceId,auditJoinData(b),b.key);
          await openChatWithJoinData(a.id,a.secret,a.deviceId,auditJoinData(a),a.key);
          release();await opening;
          return {stale:!!FPMessageStore172.get(a.id,900002),loaders:document.querySelectorAll('#historyLoader').length};
        }finally{decryptText=original;}
      });
      assert.deepEqual(result,{stale:false,loaders:1});
    });
    await check('leaving during anchor hydration cannot reopen the chat',async()=>{
      const result=await page.evaluate(async()=>{
        const a=auditRooms[0];let release,started;
        const gate=new Promise(resolve=>started=resolve);
        const off=FPNetwork171.use({id:'audit-hydration',priority:-1000,handler:({input,init,next})=>{
          if(String(input).includes('/messages?')&&/before=(10|2)(?:&|$)/.test(String(input))){started();return new Promise(resolve=>release=()=>resolve(new Response(JSON.stringify({messages:[],hasMore:false}))));}
          return next(input,init);
        }});
        try{
          const data={...auditJoinData(a),hasMore:true,nextCursor:10,firstUnreadMessageId:1,unreadCount:1};
          const opening=openChatWithJoinData(a.id,a.secret,a.deviceId,data,a.key);
          await gate;setView('chats');release();await opening;
          return {room:state.roomId,chat:!!document.querySelector('.chat-view'),active:FPRoomContext170.current()?.roomId||null};
        }finally{off();}
      });
      assert.deepEqual(result,{room:null,chat:false,active:null});
    });
    await check('late draft cannot overwrite a newer form or typed text',async()=>{
      const result=await page.evaluate(async()=>{
        const a=auditRooms[0];await openChat(a.id);let release,started;
        const gate=new Promise(resolve=>started=resolve);
        const off=FPNetwork171.use({id:'audit-draft',priority:-1000,handler:({input,init,next})=>{
          if(String(input).includes(`/rooms/${a.id}/draft?`)){started();return new Promise(resolve=>release=()=>resolve(new Response(JSON.stringify({draft:null}))));}
          return next(input,init);
        }});
        try{
          const task=loadDraftForCurrentRoom();await gate;
          const input=document.getElementById('msgInput');input.value='newly typed';input.dispatchEvent(new Event('input',{bubbles:true}));
          release();await task;return input.value;
        }finally{off();}
      });
      assert.equal(result,'newly typed');
    });
    await check('debounced draft for A uses A key while B is open',async()=>{
      const result=await page.evaluate(async()=>{
        const [a,b]=auditRooms;ensureDraftState(a.id).text='draft for A';
        await openChatWithJoinData(b.id,b.secret,b.deviceId,auditJoinData(b),b.key);
        await saveDraftNow(a.id);
        const data=await(await fetch(`/api/rooms/${a.id}/draft?deviceId=${a.deviceId}`)).json();
        return await decryptText(data.draft.iv,data.draft.ciphertext,a.key);
      });
      assert.equal(result,'draft for A');
    });
    await check('echo before ACK merges identity and reply dependencies',async()=>{
      const result=await page.evaluate(()=>{
        const s=FPMessageStore172,r='audit-store';
        s.upsert(r,{id:'client-collision',client_message_id:'client-collision',status:'sending',reply_to_message_id:99},{text:'optimistic'});
        s.upsert(r,{id:44,status:'read',reply_to_message_id:99},{text:'server'});
        s.upsert(r,{id:44,client_message_id:'client-collision',status:'sent',reply_to_message_id:99},{text:'echo'});
        s.promote(r,'client-collision',44,{status:'sent'});
        return {messages:s.roomSnapshot(r).messages,dependents:s.dependents(r,99),status:s.get(r,44).status};
      });
      assert.deepEqual(result,{messages:1,dependents:['44'],status:'read'});
    });
    await check('pins and attachment overlays block underlying chat gestures',async()=>{
      const result=await page.evaluate(async()=>{
        const layers=[];
        for(const cls of ['fp-pins114-screen','media-preview-overlay']){
          const node=document.createElement('div');node.className=cls;document.body.appendChild(node);
          await new Promise(resolve=>setTimeout(resolve,0));
          layers.push([FPLayer173.topLayer(),FPGesture135.canNavigate('chat',node)]);
          node.remove();await new Promise(resolve=>setTimeout(resolve,0));
        }
        return {layers,modals:FPLayer173.snapshot().mounted.modal};
      });
      assert.deepEqual(result,{layers:[['modal',false],['modal',false]],modals:0});
    });
    const network=await browser.newPage();
    await network.goto(origin+'/version.json');
    await network.addScriptTag({path:path.join(root,'public/network171.js')});
    await check('pre-aborted upload rejects without sending XHR',async()=>{
      const result=await network.evaluate(async()=>{
        const controller=new AbortController();controller.abort();
        const before=FPNetwork171.snapshot().xhr.sends;
        const name=await FPNetwork171.upload({url:'/audit-upload',body:'test',signal:controller.signal}).then(()=>'resolved',e=>e.name);
        return {name,sends:FPNetwork171.snapshot().xhr.sends-before};
      });
      assert.deepEqual(result,{name:'AbortError',sends:0});
    });
    await check('media concurrency remains bounded until response bodies finish',async()=>{
      await network.evaluate(()=>{
        window.bodyControllers=[];window.bodyStarted=0;
        window.offBudgetTest=FPNetwork171.use({id:'audit-body',priority:900,handler:()=>{
          bodyStarted++;return new Response(new ReadableStream({start(controller){bodyControllers.push(controller);}}));
        }});
        window.bodyTasks=Array.from({length:6},(_,i)=>FPNetwork171.fetch(`/api/media/budget-${i}/thumb`).then(r=>r.arrayBuffer()));
      });
      await network.waitForFunction(()=>bodyStarted>=4);
      assert.deepEqual(await network.evaluate(()=>({started:bodyStarted,active:FPNetwork171.snapshot().mediaBudget.active,queued:FPNetwork171.snapshot().mediaBudget.queued})),{started:4,active:4,queued:2});
      await network.evaluate(()=>{for(const c of bodyControllers.splice(0)){c.enqueue(new Uint8Array([1]));c.close();}});
      await network.waitForFunction(()=>bodyStarted===6);
      await network.evaluate(async()=>{for(const c of bodyControllers){c.enqueue(new Uint8Array([2]));c.close();}await Promise.all(bodyTasks);offBudgetTest();});
      assert.equal(await network.evaluate(()=>FPNetwork171.snapshot().mediaBudget.active),0);
    });
    await check('managed cache deduplicates writes and honors clear guard',async()=>{
      const result=await network.evaluate(async()=>{
        const cache=await caches.open('fpchat-media-v167'),url='/api/media/audit-cache/blob';
        await Promise.all([cache.put(url,new Response('cipher')),cache.put(url,new Response('cipher'))]);
        const snapshot=FPNetwork171.snapshot().mediaCache;
        window.FPStorage167ClearGuard={isClearing:()=>true};
        await cache.put('/api/media/blocked/blob',new Response('blocked'));
        const blocked=!!await cache.match('/api/media/blocked/blob');
        await cache.delete(url);return {writes:snapshot.writes,joined:snapshot.joinedWrites,blocked,keys:(await cache.keys()).length};
      });
      assert.deepEqual(result,{writes:1,joined:1,blocked:false,keys:0});
    });
    await check('in-flight text stays in A, duplicate submit is coalesced, B input survives',async()=>{
      const result=await page.evaluate(async()=>{
        const [a,b]=auditRooms;await openChat(a.id);await ensureWsConnected(a.deviceId);
        const original=ensureWsConnected;let release,started;
        const gate=new Promise(resolve=>started=resolve);
        ensureWsConnected=async device=>{started();await new Promise(resolve=>release=resolve);return original(device);};
        const input=document.getElementById('msgInput');input.value='send across navigation';input.dispatchEvent(new Event('input',{bubbles:true}));
        const form=document.getElementById('sendForm');
        const task=form.onsubmit({preventDefault(){},currentTarget:form});
        const duplicate=form.onsubmit({preventDefault(){},currentTarget:form});
        try{
          await gate;await openChatWithJoinData(b.id,b.secret,b.deviceId,auditJoinData(b),b.key);
          const next=document.getElementById('msgInput');next.value='keep B draft';next.dispatchEvent(new Event('input',{bubbles:true}));
          release();await task;await duplicate;
          const pending=[...pendingTextSends.values()];
          return {input:next.value,foreign:[...document.querySelectorAll('#messages .message-text')].some(n=>n.textContent==='send across navigation'),operations:FPRoomContext170.snapshot().operations.length};
        }finally{ensureWsConnected=original;}
      });
      assert.deepEqual(result,{input:'keep B draft',foreign:false,operations:0});
      await page.waitForFunction(async()=>{
        const a=auditRooms[0];const data=await(await fetch(`/api/rooms/${a.id}/messages?deviceId=${a.deviceId}`)).json();
        const texts=await Promise.all((data.messages||[]).filter(m=>m.type==='text').map(m=>decryptText(m.iv,m.ciphertext,a.key)));
        return texts.filter(t=>t==='send across navigation').length===1;
      });
    });
    await check('finishing media send for A does not close B preview',async()=>{
      const result=await page.evaluate(async()=>{
        const [a,b]=auditRooms;await openChat(a.id);await ensureWsConnected(a.deviceId);
        const originalConnect=ensureWsConnected,socket=state.ws,originalSend=socket.send;
        let release,started;const gate=new Promise(resolve=>started=resolve);const sent=[];
        ensureWsConnected=async device=>{started();await new Promise(resolve=>release=resolve);return originalConnect(device);};
        socket.send=function(raw){const data=JSON.parse(raw);if(data.type==='message:new')sent.push(data);else originalSend.call(this,raw);};
        mediaPreviewState={roomId:a.id,items:[{kind:'image',uploadedMedia:{id:777}}],caption:'media A',sending:false};
        const task=sendMediaFromPreview(document.getElementById('mediaPreviewRoot'));
        try{
          await gate;await openChatWithJoinData(b.id,b.secret,b.deviceId,auditJoinData(b),b.key);
          const next={roomId:b.id,items:[],caption:'keep B preview',sending:false};mediaPreviewState=next;
          release();await task;
          return {kept:mediaPreviewState===next,room:sent[0]?.roomId===a.id,text:sent[0]?await decryptText(sent[0].iv,sent[0].ciphertext,a.key):null};
        }finally{ensureWsConnected=originalConnect;socket.send=originalSend;mediaPreviewState=null;}
      });
      assert.deepEqual(result,{kept:true,room:true,text:'media A'});
    });
    await check('canonical invite preserves both block error messages',async()=>{
      const result=await page.evaluate(async()=>{
        const originalAlert=window.alert,messages=[];window.alert=message=>messages.push(message);
        let code='INVITE_BLOCKED_BY_CREATOR';
        const off=FPNetwork171.use({id:'audit-invite-block',priority:-1000,handler:({input,init,next})=>
          String(input).includes('/api/invites/')?Promise.resolve(new Response(JSON.stringify({code,error:'block-'+code}),{status:403})):next(input,init)});
        try{
          await joinByInviteText(auditRooms[0].inviteLink);
          code='INVITE_CREATOR_BLOCKED_BY_YOU';await joinByInviteText(auditRooms[0].inviteLink);
          return {messages,pending:!!FPRoomContext170.pending()};
        }finally{off();window.alert=originalAlert;}
      });
      assert.deepEqual(result,{messages:['block-INVITE_BLOCKED_BY_CREATOR','block-INVITE_CREATOR_BLOCKED_BY_YOU'],pending:false});
    });
    const delayedInvite=await newClient();
    const roomB=await page.evaluate(()=>({id:auditRooms[1].id,inviteLink:auditRooms[1].inviteLink}));
    await check('late successful invite saves access without reopening after navigation',async()=>{
      const result=await delayedInvite.evaluate(async fixture=>{
        let release,started;const gate=new Promise(resolve=>started=resolve);
        const off=FPNetwork171.use({id:'audit-invite',priority:-1000,handler:async({input,init,next})=>{
          const response=await next(input,init);
          if(String(input).includes('/api/invites/')&&String(input).endsWith('/join')){started();await new Promise(resolve=>release=resolve);}
          return response;
        }});
        try{
          const task=joinByInviteText(fixture.inviteLink);await gate;setView('settings');release();await task;
          const persisted=STORAGE.get(STORAGE.roomState(fixture.id));
          return {room:state.roomId,saved:!!persisted?.secret,recovery:!!persisted?.recoveryCode,modal:!!document.getElementById('joinRecoveryCode'),pending:!!FPRoomContext170.pending()};
        }finally{off();}
      },roomB);
      assert.deepEqual(result,{room:null,saved:true,recovery:true,modal:false,pending:false});
    });
    const peer=await newClient();
    const room=await page.evaluate(()=>({id:auditRooms[0].id,inviteLink:auditRooms[0].inviteLink}));
    await check('two clients: invite, text, ACK, reply, edit, delete and reconnect',async()=>{
      await page.evaluate(async()=>{await clearDraftOnServer(auditRooms[0].id);await openChat(auditRooms[0].id);});
      const joined=await peer.evaluate(async link=>{
        let ready=0;const listener=event=>{if(event.detail?.stage==='ready')ready++;};
        window.addEventListener('fpchat:room-open170',listener);
        try{return {ok:await joinByInviteText(link),ready};}
        finally{window.removeEventListener('fpchat:room-open170',listener);}
      },room.inviteLink);
      assert.deepEqual(joined,{ok:true,ready:1});
      await peer.locator('#joinRecDone').click();
      await Promise.all([page.waitForFunction(()=>state.ws?.readyState===1&&document.getElementById('sendForm')?.dataset.fpTextSend170),peer.waitForFunction(()=>state.ws?.readyState===1&&document.getElementById('sendForm')?.dataset.fpTextSend170)]);
      await page.locator('#msgInput').fill('integration original');
      await page.locator('#msgInput').press('Enter');
      await peer.getByText('integration original',{exact:true}).first().waitFor();
      await page.waitForFunction(()=>[...document.querySelectorAll('.bubble-wrap.mine')].some(n=>n.querySelector('.message-text')?.textContent==='integration original'&&Number(n.dataset.messageId)>0));
      const id=await page.evaluate(()=>Number([...document.querySelectorAll('.bubble-wrap.mine')].find(n=>n.querySelector('.message-text')?.textContent==='integration original').dataset.messageId));
      await peer.evaluate(id=>setSelectedReply(state.roomId,getMessageReplyMeta(id)),id);
      await peer.locator('#msgInput').fill('integration reply');await peer.locator('#msgInput').press('Enter');
      await page.getByText('integration reply',{exact:true}).first().waitFor();
      const editStatus=await page.evaluate(async id=>{
        const encrypted=await encryptText('integration edited');
        return (await fetch(`/api/rooms/${state.roomId}/messages/${id}/edit`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:activeChatDeviceId,...encrypted})})).status;
      },id);
      assert.equal(editStatus,200);
      await peer.waitForFunction(()=>document.querySelector('.reply-block-preview')?.textContent==='integration edited');
      const deleteStatus=await page.evaluate(async id=>(await fetch(`/api/rooms/${state.roomId}/messages/${id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:activeChatDeviceId,scope:'all'})})).status,id);
      assert.equal(deleteStatus,200);
      await peer.waitForFunction(id=>!findMessageElement(id)&&document.querySelector('.reply-block-preview')?.textContent==='Сообщение удалено',id);
      await peer.evaluate(()=>{window.oldSocket=state.ws;state.ws.close();});
      await peer.waitForFunction(()=>state.ws!==oldSocket&&state.ws?.readyState===1);
      const connection=await peer.evaluate(()=>({same:FPConnection170.current()===state.ws,active:auditSockets.filter(ws=>ws.readyState===0||ws.readyState===1).length}));
      assert.deepEqual(connection,{same:true,active:1});
    });
    await check('browser execution has no uncaught exceptions',async()=>assert.deepEqual(errors,[]));
    console.log(JSON.stringify({passed,failed:failures,environment:'headless Chromium on Linux; not real mobile-device acceptance'}));
    if(failures.length)process.exitCode=1;
  } finally {
    if(browser)await browser.close();
    if(server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
