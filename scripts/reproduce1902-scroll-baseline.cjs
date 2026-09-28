'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Database=require('better-sqlite3');
const {run}=require('./browser-harness174.cjs');

run(async({newClient,errors,temp,root})=>{
  const setup=await newClient();
  const fixtures=await setup.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const out=[];
    for(const name of ['late-put','reopen-before-save','direct-a','direct-b']){
      const secret='scroll1902-baseline-'+name;
      const key=await deriveKey(secret);
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const response=await fetch('/api/rooms',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({displayName:'ScrollBaseline',deviceId,roomSecret:secret,...recovery})
      });
      if(!response.ok)throw Error('fixture '+name+' '+response.status);
      const data=await response.json();
      const encrypted=[];
      for(let i=0;i<8;i++)encrypted.push(await encryptText('baseline '+name+' '+i+' '+('payload '.repeat((i%4)+1)),key));
      out.push({name,roomId:data.publicId,deviceId,secret,count:420,incoming:false,encrypted});
    }
    return out;
  });
  const seeded=JSON.parse(execFileSync(
    process.env.FPCHAT_TEST_NODE||process.execPath,
    [path.join(root,'scripts/seed-history174.cjs')],
    {input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures}),encoding:'utf8'}
  ));
  await setup.close();

  const db=new Database(path.join(temp,'test.sqlite'));
  db.pragma('busy_timeout = 5000');
  const info=name=>{
    const index=fixtures.findIndex(item=>item.name===name);
    const fixture=fixtures[index];
    const room=db.prepare('SELECT id FROM rooms WHERE public_id=?').get(fixture.roomId);
    const ids=db.prepare('SELECT id FROM messages WHERE room_id=? ORDER BY id ASC').all(room.id).map(row=>Number(row.id));
    return{...fixture,...seeded[index],dbRoomId:Number(room.id),ids};
  };
  const LATE=info('late-put'),REOPEN=info('reopen-before-save'),A=info('direct-a'),B=info('direct-b');

  const upsert=db.prepare(
    "INSERT INTO chat_view_state(room_id,device_id,anchor_message_id,anchor_offset_px,at_bottom,updated_at) VALUES(?,?,?,?,?,datetime('now')) "+
    "ON CONFLICT(room_id,device_id) DO UPDATE SET anchor_message_id=excluded.anchor_message_id,anchor_offset_px=excluded.anchor_offset_px,at_bottom=excluded.at_bottom,updated_at=datetime('now')"
  );
  upsert.run(LATE.dbRoomId,LATE.deviceId,null,0,1);
  REOPEN.oldAnchor=REOPEN.ids[180];
  upsert.run(REOPEN.dbRoomId,REOPEN.deviceId,REOPEN.oldAnchor,17,0);
  upsert.run(A.dbRoomId,A.deviceId,null,0,1);
  upsert.run(B.dbRoomId,B.deviceId,null,0,1);

  const page=await newClient(async p=>{
    await p.addInitScript(({deviceId})=>{
      localStorage.setItem('fpchat:device-id',deviceId);
      localStorage.setItem('fpchat:nick','ScrollBaseline');
    },{deviceId:LATE.deviceId});
  });
  await page.evaluate(states=>{
    for(const [roomId,value] of Object.entries(states))STORAGE.set(STORAGE.roomState(roomId),value);
  },Object.fromEntries([LATE,REOPEN,A,B].map(item=>[item.roomId,{deviceId:item.deviceId,secret:item.secret}])));

  const installHold=async roomId=>page.evaluate(roomId=>{
    const original=window.fetch.bind(window);
    let released=false,releaseResolve=null,seenResolve=null;
    const gate=new Promise(resolve=>{releaseResolve=resolve;});
    const seen=new Promise(resolve=>{seenResolve=resolve;});
    window.__baselineHold={roomId,body:null,seen,release:()=>{released=true;releaseResolve();}};
    window.fetch=(input,init={})=>{
      const raw=typeof input==='string'?input:input?.url;
      const url=new URL(raw,location.href);
      const method=String(init?.method||input?.method||'GET').toUpperCase();
      if(!window.__baselineHold.body&&method==='PUT'&&url.pathname===('/api/rooms/'+roomId+'/view-state')){
        try{window.__baselineHold.body=JSON.parse(String(init?.body||'{}'));}catch{window.__baselineHold.body={};}
        seenResolve();
        return gate.then(()=>original(input,init));
      }
      return original(input,init);
    };
    window.__baselineRestoreFetch=()=>{window.fetch=original;delete window.__baselineHold;delete window.__baselineRestoreFetch;};
  },roomId);

  const restoreFetch=()=>page.evaluate(()=>window.__baselineRestoreFetch?.());

  // A: first (old anchor) PUT is held in the page fetch layer. A newer bottom
  // save reaches the pre-fix server first. Releasing the old request afterward
  // deterministically demonstrates the missing server ordering guard.
  await page.evaluate(roomId=>openChat(roomId),LATE.roomId);
  const mid=LATE.ids[330];
  await page.evaluate(id=>{
    const node=findMessageElement(id); if(!node)throw Error('A anchor missing');
    FPScroll173.focus(node,'auto',23);
  },mid);
  await installHold(LATE.roomId);
  await page.evaluate(()=>{window.__baselineOldSave=saveViewStateNow();});
  await page.waitForFunction(()=>Boolean(window.__baselineHold?.body));
  const heldA=await page.evaluate(()=>window.__baselineHold.body);
  assert.equal(heldA.atBottom,false,JSON.stringify(heldA));
  await page.evaluate(()=>{
    const box=document.getElementById('messages');
    FPScroll173.write(box,box.scrollHeight,'auto');
  });
  await page.evaluate(()=>saveViewStateNow());
  let row=db.prepare('SELECT anchor_message_id,at_bottom FROM chat_view_state WHERE room_id=? AND device_id=?').get(LATE.dbRoomId,LATE.deviceId);
  assert.equal(Number(row.at_bottom),1,JSON.stringify(row));
  await page.evaluate(()=>window.__baselineHold.release());
  await page.evaluate(()=>window.__baselineOldSave);
  await page.waitForTimeout(60);
  row=db.prepare('SELECT anchor_message_id,at_bottom FROM chat_view_state WHERE room_id=? AND device_id=?').get(LATE.dbRoomId,LATE.deviceId);
  assert.equal(Number(row.at_bottom),0,JSON.stringify(row));
  assert.equal(Number(row.anchor_message_id),Number(heldA.anchorMessageId),JSON.stringify({row,heldA}));
  await restoreFetch();

  // B: hold the final leave PUT in window.fetch. Pre-fix leaveActiveChat does
  // not await it and there is no durable candidate in join, so immediate reopen
  // restores the older server anchor.
  await page.evaluate(roomId=>openChat(roomId),REOPEN.roomId);
  await page.evaluate(async()=>{
    const box=document.getElementById('messages');
    if(activeChatHistory?.hasNewer||activeChatHistory?.localNewer174)await FPHistory174.jump();
    FPScroll173.requestBottom(box);
  });
  await page.waitForFunction(()=>isMessagesAtBottom(document.getElementById('messages')));
  await installHold(REOPEN.roomId);
  await page.evaluate(()=>setView('chats'));
  await page.waitForFunction(()=>Boolean(window.__baselineHold?.body));
  const heldB=await page.evaluate(()=>window.__baselineHold.body);
  assert.equal(heldB.atBottom,true,JSON.stringify(heldB));
  await page.evaluate(roomId=>openChat(roomId),REOPEN.roomId);
  const stale=await page.evaluate(anchorId=>{
    const box=document.getElementById('messages');
    const node=findMessageElement(anchorId);
    return{
      atBottom:isMessagesAtBottom(box),
      oldAnchorMounted:Boolean(node),
      offset:node?Math.round(node.getBoundingClientRect().top-box.getBoundingClientRect().top):null
    };
  },REOPEN.oldAnchor);
  assert.equal(stale.atBottom,false,JSON.stringify(stale));
  assert.equal(stale.oldAnchorMounted,true,JSON.stringify(stale));
  assert.ok(Math.abs(stale.offset-17)<=3,JSON.stringify(stale));
  await page.evaluate(()=>window.__baselineHold.release());
  await page.waitForTimeout(60);
  await restoreFetch();

  // C: log view-state calls at the page fetch entry. A native A scroll schedules
  // the old 900ms timer, then direct A -> B occurs. Pre-fix timer reads current
  // state.roomId at fire time, so it emits B and never A.
  await page.evaluate(roomId=>openChat(roomId),A.roomId);
  await page.evaluate(()=>{
    const original=window.fetch.bind(window);
    window.__baselineWrites=[];
    window.__baselineRestoreFetch=()=>{window.fetch=original;delete window.__baselineRestoreFetch;};
    window.fetch=(input,init={})=>{
      const raw=typeof input==='string'?input:input?.url;
      const url=new URL(raw,location.href);
      const method=String(init?.method||input?.method||'GET').toUpperCase();
      if(method==='PUT'&&/\/api\/rooms\/[^/]+\/view-state$/.test(url.pathname)){
        let body={};try{body=JSON.parse(String(init?.body||'{}'));}catch{}
        window.__baselineWrites.push({roomId:url.pathname.split('/')[3],body});
      }
      return original(input,init);
    };
  });
  await page.evaluate(()=>{
    const box=document.getElementById('messages');
    const max=Math.max(0,box.scrollHeight-box.clientHeight);
    box.scrollTop=Math.max(0,max-700);
    box.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(40);
  await page.evaluate(roomId=>openChat(roomId),B.roomId);
  await page.waitForTimeout(1050);
  const writes=await page.evaluate(()=>window.__baselineWrites||[]);
  assert.equal(writes.filter(x=>x.roomId===A.roomId).length,0,JSON.stringify(writes));
  assert.ok(writes.some(x=>x.roomId===B.roomId),JSON.stringify(writes));
  await restoreFetch();

  assert.deepEqual(errors,[]);
  db.close();
  console.log('REPRODUCED A delayed old PUT overwrites newer bottom on pre-fix server');
  console.log('REPRODUCED B immediate reopen restores stale server anchor before held leave PUT');
  console.log('REPRODUCED C direct A->B loses A and old timer writes B');
  console.log('BASELINE_SCROLL1902_REPRO PASS');
}).catch(error=>{console.error(error);process.exitCode=1;});
