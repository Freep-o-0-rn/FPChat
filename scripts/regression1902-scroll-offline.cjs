'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Database=require('better-sqlite3');
const {run}=require('./browser-harness174.cjs');

run(async({newClient,errors,temp,root})=>{
  const page=await newClient(async p=>{
    await p.addInitScript(()=>{
      localStorage.setItem('fpchat:nick','ScrollNetwork');
    });
  });

  const fixture=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='scroll-network-offline';
    const key=await deriveKey(secret);
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:'ScrollNetwork',deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok)throw new Error('fixture '+response.status);
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});
    const encrypted=[];
    for(let i=0;i<12;i++)encrypted.push(await encryptText('scroll network '+i+' '+('payload '.repeat((i%5)+1)),key));
    return{roomId:data.publicId,deviceId,secret,count:520,incoming:false,encrypted};
  });

  const seeded=JSON.parse(execFileSync(
    process.env.FPCHAT_TEST_NODE||process.execPath,
    [path.join(root,'scripts/seed-history174.cjs')],
    {input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures:[fixture]}),encoding:'utf8'}
  ))[0];

  const db=new Database(path.join(temp,'test.sqlite'));
  db.pragma('busy_timeout = 5000');
  const room=db.prepare('SELECT id FROM rooms WHERE public_id=?').get(fixture.roomId);
  const legacy=db.prepare(
    "INSERT INTO chat_view_state(room_id,device_id,anchor_message_id,anchor_offset_px,at_bottom,client_seq,updated_at) VALUES(?,?,?,?,?,0,datetime('now')) "+
    "ON CONFLICT(room_id,device_id) DO UPDATE SET anchor_message_id=excluded.anchor_message_id,anchor_offset_px=excluded.anchor_offset_px,at_bottom=excluded.at_bottom,client_seq=0,updated_at=datetime('now')"
  );
  legacy.run(room.id,fixture.deviceId,null,0,1);

  await page.evaluate(roomId=>openChat(roomId),fixture.roomId);
  const chosen=await page.evaluate(()=>{
    const box=document.getElementById('messages');
    const max=Math.max(0,box.scrollHeight-box.clientHeight);
    box.dispatchEvent(new WheelEvent('wheel',{deltaY:-500,bubbles:true}));
    box.scrollTop=Math.max(0,max-760);
    box.dispatchEvent(new Event('scroll'));
    const anchor=getFirstVisibleMessageAnchor(box);
    return{anchor,scrollTop:box.scrollTop};
  });
  assert.ok(chosen.anchor?.anchorMessageId,JSON.stringify(chosen));

  // The bounded local cadence must create a durable snapshot before any
  // lifecycle/network save is required.
  await page.waitForTimeout(380);
  const durable=await page.evaluate(roomId=>STORAGE.get(STORAGE.viewState(roomId)),fixture.roomId);
  assert.ok(durable?.anchorMessageId,JSON.stringify(durable));
  assert.equal(durable.atBottom,false);
  assert.ok(Number(durable.clientSeq)>0);

  // Go offline before leaving. The final PUT cannot be relied on, but the local
  // room-bound snapshot must survive and later ride through the normal join.
  await page.context().setOffline(true);
  await page.evaluate(()=>setView('chats'));
  await page.waitForTimeout(150);
  const offlineLocal=await page.evaluate(roomId=>STORAGE.get(STORAGE.viewState(roomId)),fixture.roomId);
  assert.equal(Number(offlineLocal.clientSeq),Number(durable.clientSeq),JSON.stringify({durable,offlineLocal}));
  assert.equal(Number(offlineLocal.anchorMessageId),Number(durable.anchorMessageId),JSON.stringify({durable,offlineLocal}));

  const whileOffline=db.prepare('SELECT anchor_message_id,anchor_offset_px,at_bottom,client_seq FROM chat_view_state WHERE room_id=? AND device_id=?').get(room.id,fixture.deviceId);
  assert.equal(Number(whileOffline.client_seq),0,JSON.stringify(whileOffline));
  assert.equal(Number(whileOffline.at_bottom),1,JSON.stringify(whileOffline));

  await page.context().setOffline(false);
  await page.evaluate(roomId=>openChat(roomId),fixture.roomId);

  const restored=await page.evaluate(anchorId=>{
    const box=document.getElementById('messages'),node=findMessageElement(anchorId);
    if(!box||!node)return null;
    return{
      offset:Math.round(node.getBoundingClientRect().top-box.getBoundingClientRect().top),
      atBottom:isMessagesAtBottom(box),
      roomId:state.roomId
    };
  },Number(durable.anchorMessageId));
  assert.notEqual(restored,null,'offline durable anchor was not restored after network recovery');
  assert.ok(Math.abs(restored.offset-Number(durable.anchorOffsetPx))<=3,JSON.stringify({durable,restored}));
  assert.equal(restored.atBottom,false);

  const recovered=db.prepare('SELECT anchor_message_id,anchor_offset_px,at_bottom,client_seq FROM chat_view_state WHERE room_id=? AND device_id=?').get(room.id,fixture.deviceId);
  assert.equal(Number(recovered.client_seq),Number(durable.clientSeq),JSON.stringify({durable,recovered}));
  assert.equal(Number(recovered.anchor_message_id),Number(durable.anchorMessageId),JSON.stringify({durable,recovered}));
  assert.equal(Number(recovered.at_bottom),0,JSON.stringify(recovered));

  db.close();
  assert.deepEqual(errors,[]);
  console.log('PASS offline leave keeps durable local scroll snapshot when final network save cannot complete');
  console.log('PASS normal guarded join reconciles the offline snapshot after network recovery and restores its pixel offset');
  console.log('NOTE browser offline emulation is not a physical iOS/Android background/process-kill test');
}).catch(error=>{console.error(error);process.exitCode=1;});
