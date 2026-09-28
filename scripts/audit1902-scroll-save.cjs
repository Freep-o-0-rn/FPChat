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
  const legacyUpsert=db.prepare(
    "INSERT INTO chat_view_state(room_id,device_id,anchor_message_id,anchor_offset_px,at_bottom,client_seq,updated_at) VALUES(?,?,?,?,?,0,datetime('now')) "+
    "ON CONFLICT(room_id,device_id) DO UPDATE SET anchor_message_id=excluded.anchor_message_id,anchor_offset_px=excluded.anchor_offset_px,at_bottom=excluded.at_bottom,client_seq=0,updated_at=datetime('now')"
  );
  REOPEN.oldAnchor=REOPEN.ids[180];
  legacyUpsert.run(REOPEN.dbRoomId,REOPEN.deviceId,REOPEN.oldAnchor,17,0);
  legacyUpsert.run(A.dbRoomId,A.deviceId,null,0,1);
  legacyUpsert.run(B.dbRoomId,B.deviceId,null,0,1);

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

  // A. Explicitly apply a newer ordered bottom write, then an older anchor write.
  // The old request must be rejected and must not mutate the stored row.
  const lateResult=await page.evaluate(async input=>{
    const put=async body=>{
      const response=await fetch('/api/rooms/'+input.roomId+'/view-state',{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({deviceId:input.deviceId,...body})
      });
      return{status:response.status,data:await response.json()};
    };
    const newer=await put({anchorMessageId:null,anchorOffsetPx:0,atBottom:true,clientSeq:200});
    const older=await put({anchorMessageId:input.anchor,anchorOffsetPx:21,atBottom:false,clientSeq:100});
    const get=await fetch('/api/rooms/'+input.roomId+'/view-state?deviceId='+encodeURIComponent(input.deviceId));
    return{newer,older,current:(await get.json()).viewState};
  },{roomId:LATE.roomId,deviceId:LATE.deviceId,anchor:LATE.ids[220]});
  assert.equal(lateResult.newer.status,200,JSON.stringify(lateResult));
  assert.equal(lateResult.older.status,409,JSON.stringify(lateResult));
  assert.equal(lateResult.older.data.code,'VIEW_STATE_STALE',JSON.stringify(lateResult));
  assert.equal(lateResult.current.atBottom,true,JSON.stringify(lateResult));
  assert.equal(lateResult.current.anchorMessageId,null,JSON.stringify(lateResult));
  assert.equal(lateResult.current.clientSeq,200,JSON.stringify(lateResult));

  // B. Simulate a failed/incomplete leave PUT. The durable local snapshot is
  // still carried in the next access-check join and chooses the current tail.
  await page.evaluate(roomId=>openChat(roomId),REOPEN.roomId);
  const openedOld=await page.evaluate(anchorId=>{
    const box=document.getElementById('messages'),node=findMessageElement(anchorId);
    if(!box||!node)return null;
    return{
      anchorId,
      offset:Math.round(node.getBoundingClientRect().top-box.getBoundingClientRect().top),
      atBottom:isMessagesAtBottom(box)
    };
  },REOPEN.oldAnchor);
  assert.notEqual(openedOld,null,'old saved anchor was not mounted');
  assert.ok(Math.abs(openedOld.offset-17)<=3,JSON.stringify(openedOld));
  assert.equal(openedOld.atBottom,false,JSON.stringify(openedOld));
  await page.evaluate(async()=>{
    const box=document.getElementById('messages');
    FPScroll173.noteUserIntent(box);
    if(activeChatHistory?.hasNewer||activeChatHistory?.localNewer174)await FPHistory174.jump();
    FPScroll173.requestBottom(box);
  });
  await page.waitForFunction(()=>!activeChatHistory?.hasNewer&&!activeChatHistory?.localNewer174&&isMessagesAtBottom(document.getElementById('messages')));

  await page.evaluate(()=>{window.__scroll1902OriginalSend=FPScroll173.sendSnapshot;FPScroll173.sendSnapshot=async()=>null;});
  await page.evaluate(()=>setView('chats'));
  const durableBottom=await page.evaluate(async({roomId,deviceId})=>FPScroll173.snapshotForJoin(roomId,deviceId),{roomId:REOPEN.roomId,deviceId:REOPEN.deviceId});
  assert.equal(durableBottom?.atBottom,true,JSON.stringify(durableBottom));
  assert.ok(Number(durableBottom?.clientSeq)>0,JSON.stringify(durableBottom));

  const beforeReopenDb=db.prepare('SELECT anchor_message_id,at_bottom,client_seq FROM chat_view_state WHERE room_id=? AND device_id=?').get(REOPEN.dbRoomId,REOPEN.deviceId);
  assert.equal(Number(beforeReopenDb.at_bottom),0,JSON.stringify(beforeReopenDb));
  assert.equal(Number(beforeReopenDb.anchor_message_id),REOPEN.oldAnchor,JSON.stringify(beforeReopenDb));
  assert.equal(Number(beforeReopenDb.client_seq),0,JSON.stringify(beforeReopenDb));

  await page.evaluate(roomId=>openChat(roomId),REOPEN.roomId);
  const reopened=await visible();
  await page.evaluate(()=>{FPScroll173.sendSnapshot=window.__scroll1902OriginalSend;delete window.__scroll1902OriginalSend;});
  assert.equal(reopened.atBottom,true,JSON.stringify(reopened));
  const reopenDb=db.prepare('SELECT anchor_message_id,at_bottom,client_seq FROM chat_view_state WHERE room_id=? AND device_id=?').get(REOPEN.dbRoomId,REOPEN.deviceId);
  assert.equal(Number(reopenDb.at_bottom),1,JSON.stringify(reopenDb));
  assert.equal(reopenDb.anchor_message_id,null,JSON.stringify(reopenDb));
  assert.equal(Number(reopenDb.client_seq),Number(durableBottom.clientSeq),JSON.stringify({reopenDb,durableBottom}));

  // C. A native A scroll schedules persistence, then A -> B happens before the
  // old 900ms timer. The concrete A snapshot must be captured before transition;
  // no stale timer is allowed to reinterpret it as room B.
  await page.evaluate(roomId=>openChat(roomId),A.roomId);
  const writes=[];
  const wildcard='**/api/rooms/*/view-state';
  await page.route(wildcard,async route=>{
    if(route.request().method()==='PUT'){
      const url=new URL(route.request().url());
      writes.push({roomId:url.pathname.split('/')[3],body:JSON.parse(route.request().postData()||'{}')});
    }
    await route.continue();
  });
  const aBefore=await page.evaluate(()=>{
    const box=document.getElementById('messages');
    const max=Math.max(0,box.scrollHeight-box.clientHeight);
    box.dispatchEvent(new WheelEvent('wheel',{deltaY:-400,bubbles:true}));
    box.scrollTop=Math.max(0,max-700);
    box.dispatchEvent(new Event('scroll'));
    return getFirstVisibleMessageAnchor(box);
  });
  assert.ok(aBefore?.anchorMessageId,'A native position missing before direct transition');
  await page.waitForTimeout(40);
  await page.evaluate(roomId=>openChat(roomId),B.roomId);
  await page.waitForTimeout(1050);

  const aWrites=writes.filter(row=>row.roomId===A.roomId);
  const bWrites=writes.filter(row=>row.roomId===B.roomId);
  assert.ok(aWrites.length>=1,'direct A->B did not flush A position');
  assert.equal(bWrites.length,0,'A delayed timer was rebound to room B: '+JSON.stringify(writes));

  const aRow=db.prepare('SELECT anchor_message_id,anchor_offset_px,at_bottom,client_seq FROM chat_view_state WHERE room_id=? AND device_id=?').get(A.dbRoomId,A.deviceId);
  assert.equal(Number(aRow.at_bottom),0,JSON.stringify(aRow));
  assert.ok(Number(aRow.anchor_message_id)>0,JSON.stringify(aRow));
  assert.ok(Number(aRow.client_seq)>0,JSON.stringify(aRow));

  await page.evaluate(roomId=>openChat(roomId),A.roomId);
  const restored=await page.evaluate(anchorId=>{
    const box=document.getElementById('messages'),node=findMessageElement(anchorId);
    if(!box||!node)return null;
    return Math.round(node.getBoundingClientRect().top-box.getBoundingClientRect().top);
  },Number(aRow.anchor_message_id));
  assert.notEqual(restored,null,'A saved anchor was not restored after A->B->A');
  assert.ok(Math.abs(restored-Number(aRow.anchor_offset_px))<=3,JSON.stringify({restored,row:aRow}));
  await page.unroute(wildcard);

  const metrics=await page.evaluate(()=>FPScroll173.snapshot());
  assert.equal(metrics.localCaptureIntervalMs,300);
  assert.equal(metrics.networkMaxLagMs,900);
  assert.ok(metrics.metrics.localWrites>0,JSON.stringify(metrics));
  assert.ok(metrics.metrics.networkWrites>0,JSON.stringify(metrics));

  db.close();
  assert.deepEqual(errors,[]);
  console.log('PASS A stale lower clientSeq is rejected before it can overwrite a newer server position');
  console.log('PASS B reopen uses durable local candidate through normal join even when standalone leave PUT fails');
  console.log('PASS C direct A->B captures A before transition and no delayed timer writes room B');
  console.log('PASS A->B->A restores the persisted A anchor and pixel offset');
  console.log('PASS scroll persistence exposes bounded 300ms local capture / 900ms network cadence metrics');
}).catch(error=>{console.error(error);process.exitCode=1;});
