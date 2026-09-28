'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Database=require('better-sqlite3');
const {run}=require('./browser-harness174.cjs');

run(async({browser,newClient,origin,errors,temp,root})=>{
  const setup=await newClient();
  const fixtures=await setup.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const specs=[
      {name:'interrupt',count:450,incoming:false},
      {name:'explicit',count:450,incoming:false},
      {name:'cold',count:450,incoming:false},
      {name:'tabs',count:450,incoming:false},
      {name:'deleted',count:650,incoming:true}
    ];
    const out=[];
    for(const spec of specs){
      const secret='scroll-resilience-'+spec.name,key=await deriveKey(secret);
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:'ScrollResilience',deviceId,roomSecret:secret,...recovery})});
      if(!response.ok)throw new Error('fixture '+spec.name+' '+response.status);
      const data=await response.json();
      const encrypted=[];
      for(let i=0;i<12;i++)encrypted.push(await encryptText('scroll resilience '+spec.name+' '+i+' '+('line '.repeat((i%6)+1)),key));
      out.push({...spec,roomId:data.publicId,deviceId,secret,encrypted});
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
    const index=fixtures.findIndex(item=>item.name===name),fixture=fixtures[index];
    const room=db.prepare('SELECT id FROM rooms WHERE public_id=?').get(fixture.roomId);
    const ids=db.prepare('SELECT id FROM messages WHERE room_id=? ORDER BY id ASC').all(room.id).map(row=>Number(row.id));
    return{...fixture,...seeded[index],dbRoomId:Number(room.id),ids};
  }
  const INTERRUPT=info('interrupt'),EXPLICIT=info('explicit'),COLD=info('cold'),TABS=info('tabs'),DELETED=info('deleted');
  const legacy=db.prepare(
    "INSERT INTO chat_view_state(room_id,device_id,anchor_message_id,anchor_offset_px,at_bottom,client_seq,updated_at) VALUES(?,?,?,?,?,0,datetime('now')) "+
    "ON CONFLICT(room_id,device_id) DO UPDATE SET anchor_message_id=excluded.anchor_message_id,anchor_offset_px=excluded.anchor_offset_px,at_bottom=excluded.at_bottom,client_seq=0,updated_at=datetime('now')"
  );
  INTERRUPT.saved=INTERRUPT.ids[250];legacy.run(INTERRUPT.dbRoomId,INTERRUPT.deviceId,INTERRUPT.saved,17,0);
  EXPLICIT.saved=EXPLICIT.ids[250];legacy.run(EXPLICIT.dbRoomId,EXPLICIT.deviceId,EXPLICIT.saved,17,0);
  legacy.run(COLD.dbRoomId,COLD.deviceId,null,0,1);
  legacy.run(TABS.dbRoomId,TABS.deviceId,null,0,1);
  DELETED.saved=DELETED.ids[100];legacy.run(DELETED.dbRoomId,DELETED.deviceId,DELETED.saved,13,0);
  db.prepare("UPDATE messages SET deleted_for_all=1,deleted_at=datetime('now') WHERE id=? AND room_id=?").run(DELETED.saved,DELETED.dbRoomId);

  const states=Object.fromEntries([INTERRUPT,EXPLICIT,COLD,TABS,DELETED].map(item=>[item.roomId,{deviceId:item.deviceId,secret:item.secret}]));
  const page=await newClient(async p=>{
    await p.addInitScript(({deviceId})=>{
      localStorage.setItem('fpchat:device-id',deviceId);
      localStorage.setItem('fpchat:nick','ScrollResilience');
    },{deviceId:INTERRUPT.deviceId});
  });
  await page.evaluate(input=>{for(const [roomId,value] of Object.entries(input))STORAGE.set(STORAGE.roomState(roomId),value);},states);

  async function installLayoutGate(){
    await page.evaluate(()=>{
      window.__scrollRestoreOriginalWait=window.waitForInitialMediaLayout;
      window.__scrollRestoreGate=new Promise(resolve=>{window.__scrollRestoreRelease=resolve;});
      window.waitForInitialMediaLayout=async box=>{
        await window.__scrollRestoreGate;
        return window.__scrollRestoreOriginalWait(box);
      };
    });
  }
  async function releaseLayoutGate(){
    await page.evaluate(()=>window.__scrollRestoreRelease?.());
  }
  async function restoreLayoutWait(){
    await page.evaluate(()=>{
      if(window.__scrollRestoreOriginalWait)window.waitForInitialMediaLayout=window.__scrollRestoreOriginalWait;
      delete window.__scrollRestoreOriginalWait;delete window.__scrollRestoreGate;delete window.__scrollRestoreRelease;
    });
  }

  // 1. User motion during delayed initial restore cancels the late restore.
  await installLayoutGate();
  await page.evaluate(roomId=>{window.__scrollOpenPromise=openChat(roomId);return true;},INTERRUPT.roomId);
  await page.waitForFunction(()=>FPScroll173.isOpening()&&document.querySelectorAll('#messages .bubble-wrap.msg').length>20);
  const userTop=await page.evaluate(()=>{
    const box=document.getElementById('messages'),max=Math.max(0,box.scrollHeight-box.clientHeight);
    const target=Math.max(0,Math.min(max,Math.round(max*0.37)));
    box.dispatchEvent(new WheelEvent('wheel',{deltaY:-300,bubbles:true}));
    box.scrollTop=target;
    box.dispatchEvent(new Event('scroll'));
    return box.scrollTop;
  });
  await releaseLayoutGate();
  await page.evaluate(()=>window.__scrollOpenPromise);
  const afterInterrupt=await page.evaluate(()=>({scrollTop:document.getElementById('messages').scrollTop,phase:FPScroll173.snapshot().phase}));
  assert.ok(Math.abs(afterInterrupt.scrollTop-userTop)<=2,JSON.stringify({userTop,afterInterrupt}));
  assert.equal(afterInterrupt.phase,'ready');
  await restoreLayoutWait();

  // 2. Explicit focus during opening wins over background saved-position restore.
  await page.evaluate(()=>setView('chats'));
  await installLayoutGate();
  await page.evaluate(roomId=>{window.__scrollOpenPromise=openChat(roomId);return true;},EXPLICIT.roomId);
  await page.waitForFunction(()=>FPScroll173.isOpening()&&document.querySelectorAll('#messages .bubble-wrap.msg').length>20);
  const explicitTarget=EXPLICIT.ids[280];
  const queued=await page.evaluate(id=>{
    const target=findMessageElement(id);if(!target)throw new Error('explicit target not mounted');
    return FPScroll173.focus(target,'auto',15);
  },explicitTarget);
  assert.equal(queued,true);
  await releaseLayoutGate();
  await page.evaluate(()=>window.__scrollOpenPromise);
  const explicitOffset=await page.evaluate(id=>{
    const box=document.getElementById('messages'),node=findMessageElement(id);
    return node?Math.round(node.getBoundingClientRect().top-box.getBoundingClientRect().top):null;
  },explicitTarget);
  assert.notEqual(explicitOffset,null);
  assert.ok(Math.abs(explicitOffset-15)<=3,JSON.stringify({explicitOffset}));
  await restoreLayoutWait();

  // 3. Cold-start restoration uses a durable local snapshot even when the
  // standalone network save never succeeds. storageState is captured before
  // closing anything, so later pagehide/beforeunload cannot help the new page.
  await page.evaluate(()=>setView('chats'));
  const coldPut='**/api/rooms/'+COLD.roomId+'/view-state';
  let coldPutAttempts=0;
  await page.route(coldPut,async route=>{
    if(route.request().method()==='PUT'){coldPutAttempts++;await route.abort('failed');return;}
    await route.continue();
  });
  await page.evaluate(roomId=>openChat(roomId),COLD.roomId);
  const coldPosition=await page.evaluate(()=>{
    const box=document.getElementById('messages'),max=Math.max(0,box.scrollHeight-box.clientHeight);
    box.dispatchEvent(new WheelEvent('wheel',{deltaY:-500,bubbles:true}));
    box.scrollTop=Math.max(0,max-650);
    box.dispatchEvent(new Event('scroll'));
    return box.scrollTop;
  });
  await page.waitForTimeout(380);
  const durable=await page.evaluate(roomId=>STORAGE.get(STORAGE.viewState(roomId)),COLD.roomId);
  assert.ok(durable?.anchorMessageId,JSON.stringify(durable));
  assert.equal(durable.atBottom,false);
  assert.ok(Number(durable.clientSeq)>0);
  const beforeColdServer=db.prepare('SELECT at_bottom,client_seq FROM chat_view_state WHERE room_id=? AND device_id=?').get(COLD.dbRoomId,COLD.deviceId);
  assert.equal(Number(beforeColdServer.client_seq),0,JSON.stringify(beforeColdServer));
  const storageState=await page.context().storageState();

  const coldContext=await browser.newContext({storageState,viewport:{width:1100,height:760}});
  const coldPage=await coldContext.newPage();
  coldPage.on('pageerror',error=>errors.push(error.message));
  await coldPage.goto(origin);
  await coldPage.waitForFunction(()=>window.FPMediaSend170&&window.FPHistory174&&!document.getElementById('bootHold152'));
  await coldPage.evaluate(roomId=>openChat(roomId),COLD.roomId);
  const coldRestored=await coldPage.evaluate(anchorId=>{
    const box=document.getElementById('messages'),node=findMessageElement(anchorId);
    return node?{
      offset:Math.round(node.getBoundingClientRect().top-box.getBoundingClientRect().top),
      atBottom:isMessagesAtBottom(box),
      serverRoom:state.roomId
    }:null;
  },Number(durable.anchorMessageId));
  assert.notEqual(coldRestored,null,'durable cold-start anchor not mounted');
  assert.ok(Math.abs(coldRestored.offset-Number(durable.anchorOffsetPx))<=3,JSON.stringify({durable,coldRestored,coldPosition}));
  assert.equal(coldRestored.atBottom,false);
  const afterColdServer=db.prepare('SELECT anchor_message_id,anchor_offset_px,at_bottom,client_seq FROM chat_view_state WHERE room_id=? AND device_id=?').get(COLD.dbRoomId,COLD.deviceId);
  assert.equal(Number(afterColdServer.client_seq),Number(durable.clientSeq),JSON.stringify(afterColdServer));
  await coldContext.close();
  await page.unroute(coldPut);

  // 4. A stale second tab that did not change position cannot mint a newer
  // sequence during lifecycle save and overwrite the actively-read position.
  await page.evaluate(()=>setView('chats'));
  const tab2=await page.context().newPage();
  tab2.on('pageerror',error=>errors.push(error.message));
  await tab2.goto(origin);
  await tab2.waitForFunction(()=>window.FPMediaSend170&&window.FPHistory174&&!document.getElementById('bootHold152'));
  await tab2.evaluate(roomId=>openChat(roomId),TABS.roomId);
  await page.evaluate(roomId=>openChat(roomId),TABS.roomId);
  await page.evaluate(()=>{
    const box=document.getElementById('messages'),max=Math.max(0,box.scrollHeight-box.clientHeight);
    box.dispatchEvent(new WheelEvent('wheel',{deltaY:-450,bubbles:true}));
    box.scrollTop=Math.max(0,max-720);
    box.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(380);
  await page.evaluate(roomId=>FPScroll173.flushRoom(roomId),TABS.roomId);
  const activeSnap=await page.evaluate(roomId=>STORAGE.get(STORAGE.viewState(roomId)),TABS.roomId);
  assert.ok(activeSnap?.anchorMessageId,JSON.stringify(activeSnap));
  const activeRow=db.prepare('SELECT anchor_message_id,anchor_offset_px,at_bottom,client_seq FROM chat_view_state WHERE room_id=? AND device_id=?').get(TABS.dbRoomId,TABS.deviceId);
  assert.equal(Number(activeRow.client_seq),Number(activeSnap.clientSeq),JSON.stringify({activeRow,activeSnap}));

  await tab2.evaluate(()=>saveViewStateForLifecycle());
  await tab2.waitForTimeout(120);
  const afterStaleLocal=await tab2.evaluate(roomId=>STORAGE.get(STORAGE.viewState(roomId)),TABS.roomId);
  const afterStaleRow=db.prepare('SELECT anchor_message_id,anchor_offset_px,at_bottom,client_seq FROM chat_view_state WHERE room_id=? AND device_id=?').get(TABS.dbRoomId,TABS.deviceId);
  assert.equal(Number(afterStaleLocal.clientSeq),Number(activeSnap.clientSeq),JSON.stringify({activeSnap,afterStaleLocal}));
  assert.equal(Number(afterStaleRow.client_seq),Number(activeSnap.clientSeq),JSON.stringify({activeSnap,afterStaleRow}));
  assert.equal(Number(afterStaleRow.anchor_message_id),Number(activeSnap.anchorMessageId),JSON.stringify({activeSnap,afterStaleRow}));

  // pageshow/bfcache-style lifecycle normalization must not reapply an opening
  // restore over the already-correct live viewport.
  const beforePageShow=await page.evaluate(()=>document.getElementById('messages').scrollTop);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await page.waitForTimeout(120);
  const afterPageShow=await page.evaluate(()=>document.getElementById('messages').scrollTop);
  assert.ok(Math.abs(afterPageShow-beforePageShow)<=2,JSON.stringify({beforePageShow,afterPageShow}));
  await tab2.close();

  // 5. Deleted saved anchor falls through to first unread, not to a repeated
  // saved-anchor jump or arbitrary tail.
  await page.evaluate(()=>setView('chats'));
  await page.evaluate(roomId=>openChat(roomId),DELETED.roomId);
  const deletedFallback=await page.evaluate(firstUnread=>{
    const box=document.getElementById('messages'),node=findMessageElement(firstUnread);
    if(!node)return null;
    const bounds=box.getBoundingClientRect(),rect=node.getBoundingClientRect();
    return{
      firstUnread:Number(activeChatHistory?.firstUnreadMessageId)||null,
      visible:rect.bottom>=bounds.top&&rect.top<=bounds.bottom,
      bottomGap:Math.round(bounds.bottom-rect.bottom),
      deletedMounted:Boolean(findMessageElement(window.__deletedSavedId||-1)),
      hasNewer:Boolean(activeChatHistory?.hasNewer),
      atBottom:isMessagesAtBottom(box)
    };
  },DELETED.firstUnread);
  assert.notEqual(deletedFallback,null,'first unread missing after deleted saved anchor fallback');
  assert.equal(deletedFallback.firstUnread,DELETED.firstUnread,JSON.stringify(deletedFallback));
  assert.equal(deletedFallback.visible,true,JSON.stringify(deletedFallback));
  assert.ok(Math.abs(deletedFallback.bottomGap-8)<=3,JSON.stringify(deletedFallback));
  assert.equal(deletedFallback.atBottom,false,JSON.stringify(deletedFallback));

  const metrics=await page.evaluate(()=>FPScroll173.snapshot());
  assert.equal(metrics.localCaptureIntervalMs,300);
  assert.equal(metrics.networkMaxLagMs,900);
  assert.ok(metrics.metrics.captureAverageMs>=0);

  db.close();
  assert.deepEqual(errors,[]);
  console.log('PASS delayed initial restore yields to user scroll');
  console.log('PASS explicit focus during opening overrides background restore');
  console.log('PASS cold start restores last durable local snapshot without relying on lifecycle network save');
  console.log('PASS stale background tab cannot overwrite a newer shared-device position');
  console.log('PASS bfcache-style pageshow does not re-run initial restore on the live viewport');
  console.log('PASS deleted saved anchor falls back to first unread');
  console.log('NOTE physical iPhone/Android process-kill/background acceptance remains separate');
}).catch(error=>{console.error(error);process.exitCode=1;});
