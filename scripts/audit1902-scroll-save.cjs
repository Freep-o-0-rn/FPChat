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
      const secret='scroll1902-'+name;
      const key=await deriveKey(secret);
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const response=await fetch('/api/rooms',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({displayName:'Scroll1902',deviceId,roomSecret:secret,...recovery})
      });
      if(!response.ok)throw new Error('fixture '+name+' '+response.status);
      const data=await response.json();
      const encrypted=[];
      for(let i=0;i<8;i++)encrypted.push(await encryptText('scroll1902 '+name+' '+i+' '+('payload '.repeat((i%4)+1)),key));
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
  function info(name){
    const index=fixtures.findIndex(item=>item.name===name);
    const fixture=fixtures[index];
    const room=db.prepare('SELECT id FROM rooms WHERE public_id=?').get(fixture.roomId);
    const ids=db.prepare('SELECT id FROM messages WHERE room_id=? ORDER BY id ASC').all(room.id).map(row=>Number(row.id));
    return{...fixture,...seeded[index],dbRoomId:Number(room.id),ids};
  }
  const LATE=info('late-put'),REOPEN=info('reopen-before-save'),A=info('direct-a'),B=info('direct-b');
  const upsertView=db.prepare(
    "INSERT INTO chat_view_state(room_id,device_id,anchor_message_id,anchor_offset_px,at_bottom,updated_at) VALUES(?,?,?,?,?,datetime('now')) "+
    "ON CONFLICT(room_id,device_id) DO UPDATE SET anchor_message_id=excluded.anchor_message_id,anchor_offset_px=excluded.anchor_offset_px,at_bottom=excluded.at_bottom,updated_at=datetime('now')"
  );
  upsertView.run(LATE.dbRoomId,LATE.deviceId,null,0,1);
  REOPEN.oldAnchor=REOPEN.ids[180];
  upsertView.run(REOPEN.dbRoomId,REOPEN.deviceId,REOPEN.oldAnchor,17,0);
  upsertView.run(A.dbRoomId,A.deviceId,null,0,1);
  upsertView.run(B.dbRoomId,B.deviceId,null,0,1);

  const page=await newClient(async p=>{
    await p.addInitScript(({deviceId})=>{
      localStorage.setItem('fpchat:device-id',deviceId);
      localStorage.setItem('fpchat:nick','Scroll1902');
    },{deviceId:LATE.deviceId});
  });
  await page.evaluate(states=>{
    for(const [roomId,value] of Object.entries(states))STORAGE.set(STORAGE.roomState(roomId),value);
  },Object.fromEntries([LATE,REOPEN,A,B].map(item=>[item.roomId,{deviceId:item.deviceId,secret:item.secret}])));

  const visible=()=>page.evaluate(()=>{
    const box=document.getElementById('messages');
    const anchor=getFirstVisibleMessageAnchor(box);
    return{
      roomId:state.roomId,
      atBottom:isMessagesAtBottom(box),
      anchor,
      scrollTop:box?.scrollTop||0,
      max:box?Math.max(0,box.scrollHeight-box.clientHeight):0
    };
  });

  // A. Older delayed anchor PUT arrives after the newer atBottom=true PUT and wins.
  await page.evaluate(roomId=>openChat(roomId),LATE.roomId);
  const midId=LATE.ids[330];
  await page.evaluate(id=>{
    const node=findMessageElement(id);
    if(!node)throw new Error('late-put mid node missing');
    FPScroll173.focus(node,'auto',23);
  },midId);
  await page.waitForTimeout(40);

  let releaseLate;
  const lateGate=new Promise(resolve=>{releaseLate=resolve;});
  let firstSeenResolve;
  const firstSeen=new Promise(resolve=>{firstSeenResolve=resolve;});
  const lateWrites=[];
  let lateCount=0;
  await page.route('**/api/rooms/'+LATE.roomId+'/view-state',async route=>{
    if(route.request().method()!=='PUT'){await route.continue();return;}
    const body=JSON.parse(route.request().postData()||'{}');
    lateWrites.push(body);
    lateCount++;
    if(lateCount===1){
      firstSeenResolve();
      await lateGate;
    }
    await route.continue();
  });
  await page.evaluate(()=>{window.__scroll1902FirstSave=saveViewStateNow();});
  await firstSeen;
  await page.evaluate(()=>{
    const box=document.getElementById('messages');
    FPScroll173.write(box,box.scrollHeight,'auto');
  });
  await page.waitForTimeout(20);
  await page.evaluate(()=>saveViewStateNow());
  releaseLate();
  await page.evaluate(()=>window.__scroll1902FirstSave);
  await page.waitForTimeout(80);
  const lateRow=db.prepare('SELECT anchor_message_id,anchor_offset_px,at_bottom FROM chat_view_state WHERE room_id=? AND device_id=?').get(LATE.dbRoomId,LATE.deviceId);
  assert.equal(lateWrites.length,2,'expected exactly two controlled view-state PUTs');
  assert.equal(lateWrites[0].atBottom,false,'first controlled save was not the old anchor');
  assert.equal(lateWrites[1].atBottom,true,'second controlled save was not bottom');
  assert.equal(Number(lateRow.at_bottom),0,'defect A did not reproduce: late old PUT did not overwrite newer bottom');
  assert.equal(Number(lateRow.anchor_message_id),Number(lateWrites[0].anchorMessageId),'defect A final row is not the late old anchor');
  await page.unroute('**/api/rooms/'+LATE.roomId+'/view-state');

  // B. leaveActiveChat fires the save without awaiting it, so immediate reopen joins on stale server state.
  await page.evaluate(roomId=>openChat(roomId),REOPEN.roomId);
  await page.evaluate(()=>{
    const box=document.getElementById('messages');
    FPScroll173.requestBottom(box);
  });
  await page.waitForFunction(()=>isMessagesAtBottom(document.getElementById('messages')));

  let releaseLeave;
  const leaveGate=new Promise(resolve=>{releaseLeave=resolve;});
  let leaveSeenResolve;
  const leaveSeen=new Promise(resolve=>{leaveSeenResolve=resolve;});
  let leavePutBody=null;
  await page.route('**/api/rooms/'+REOPEN.roomId+'/view-state',async route=>{
    if(route.request().method()!=='PUT'){await route.continue();return;}
    leavePutBody=JSON.parse(route.request().postData()||'{}');
    leaveSeenResolve();
    await leaveGate;
    await route.continue();
  });
  await page.evaluate(()=>setView('chats'));
  await leaveSeen;
  const reopenPromise=page.evaluate(roomId=>openChat(roomId),REOPEN.roomId);
  await reopenPromise;
  const staleReopen=await visible();
  assert.equal(leavePutBody?.atBottom,true,'leave save was not bottom');
  assert.equal(staleReopen.roomId,REOPEN.roomId);
  assert.equal(staleReopen.atBottom,false,'defect B did not reproduce: reopen somehow saw delayed bottom save');
  assert.equal(Number(staleReopen.anchor?.anchorMessageId),REOPEN.oldAnchor,'reopen did not restore the stale server anchor');
  releaseLeave();
  await page.waitForTimeout(120);
  await page.unroute('**/api/rooms/'+REOPEN.roomId+'/view-state');

  // C. A->B does not save A. The old 900ms timer later reads state.roomId=B and writes B instead.
  await page.evaluate(roomId=>openChat(roomId),A.roomId);
  const aMid=A.ids[330];
  const directWrites=[];
  const handler=async route=>{
    if(route.request().method()==='PUT'){
      const url=new URL(route.request().url());
      directWrites.push({roomId:url.pathname.split('/')[3],body:JSON.parse(route.request().postData()||'{}')});
    }
    await route.continue();
  };
  await page.route('**/api/rooms/*/view-state',handler);
  await page.evaluate(id=>{
    const node=findMessageElement(id);
    if(!node)throw new Error('direct-a mid node missing');
    FPScroll173.focus(node,'auto',29);
  },aMid);
  await page.waitForTimeout(60);
  await page.evaluate(roomId=>openChat(roomId),B.roomId);
  await page.waitForTimeout(1100);
  const aWrites=directWrites.filter(row=>row.roomId===A.roomId);
  const bWrites=directWrites.filter(row=>row.roomId===B.roomId);
  assert.equal(aWrites.length,0,'defect C did not reproduce: direct A->B unexpectedly saved A');
  assert.ok(bWrites.length>=1,'defect C did not reproduce: stale timer did not write current B room');
  await page.unroute('**/api/rooms/*/view-state',handler);

  db.close();
  assert.deepEqual(errors,[]);
  console.log('REPRODUCED A: delayed old view-state PUT overwrites newer bottom on server');
  console.log('REPRODUCED B: immediate reopen joins before leave save reaches server and restores stale anchor');
  console.log('REPRODUCED C: direct A->B loses A position and stale timer saves B instead');
}).catch(error=>{console.error(error);process.exitCode=1;});
