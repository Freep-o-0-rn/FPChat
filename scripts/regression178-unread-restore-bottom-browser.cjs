'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');

run(async({newClient,errors,temp,root})=>{
  const page=await newClient();
  await page.setViewportSize({width:390,height:844});

  const fixtures=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),output=[];
    for(const [name,count,incoming] of [['unread',650,true],['restore',450,false],['bottom',450,false]]){
      const secret='scroll17825-'+name,key=await deriveKey(secret);
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const data=await(await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})})).json();
      STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});
      upsertChat(data.publicId,{});
      const encrypted=[];
      for(let i=0;i<16;i++)encrypted.push(await encryptText('178.25 '+name+' '+i+' '+('line '.repeat((i%6)+1)),key));
      output.push({roomId:data.publicId,deviceId,count,incoming,encrypted});
    }
    return output;
  });
  const seeded=JSON.parse(execFileSync(process.env.FPCHAT_TEST_NODE||process.execPath,[path.join(root,'scripts/seed-history174.cjs')],{input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures}),encoding:'utf8'}));
  await page.evaluate(data=>window.test17825=data,seeded);

  // 1. Unread opening: firstUnread wins even though it is far from the tail.
  let result=await page.evaluate(async()=>{
    const u=test17825[0];
    await openChat(u.roomId);
    const box=document.getElementById('messages');
    const target=findMessageElement(u.firstUnread);
    if(!target)throw new Error('first unread was not hydrated into the opening window');
    const rect=target.getBoundingClientRect(),bounds=box.getBoundingClientRect();
    return{
      target:u.firstUnread,
      mounted:Boolean(target),
      visible:rect.bottom>=bounds.top&&rect.top<=bounds.bottom,
      bottomGap:bounds.bottom-rect.bottom,
      atBottom:isMessagesAtBottom(box),
      hasNewer:Boolean(activeChatHistory.hasNewer),
      firstUnreadId:activeChatHistory.firstUnreadMessageId
    };
  });
  assert.equal(result.mounted,true,JSON.stringify(result));
  assert.equal(result.visible,true,JSON.stringify(result));
  assert.equal(result.firstUnreadId,result.target,JSON.stringify(result));
  assert.ok(Math.abs(result.bottomGap-8)<=3,JSON.stringify(result));
  assert.equal(result.hasNewer,true,JSON.stringify(result));
  assert.equal(result.atBottom,false,JSON.stringify(result));

  // 2. Saved restore: with no unread and atBottom=false, exact saved anchor/offset wins.
  result=await page.evaluate(async()=>{
    const r=test17825[1],anchor=r.first+130,offset=17,deviceId=getOrCreateDeviceId();
    const response=await fetch('/api/rooms/'+r.roomId+'/view-state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId,anchorMessageId:anchor,anchorOffsetPx:offset,atBottom:false})});
    if(!response.ok)throw new Error('failed to save restore fixture');
    await openChat(r.roomId);
    const box=document.getElementById('messages'),node=findMessageElement(anchor);
    if(!node)throw new Error('saved anchor was not hydrated');
    const actual=node.getBoundingClientRect().top-box.getBoundingClientRect().top;
    updateUnreadIndicators();
    const pill=document.getElementById('newMessagesPill');
    return{anchor,offset,actual,hasNewer:Boolean(activeChatHistory.hasNewer),atBottom:isMessagesAtBottom(box),pillHidden:pill.classList.contains('hidden'),pillText:pill.textContent};
  });
  assert.ok(Math.abs(result.actual-result.offset)<=2,JSON.stringify(result));
  assert.equal(result.hasNewer,true,JSON.stringify(result));
  assert.equal(result.atBottom,false,JSON.stringify(result));
  assert.equal(result.pillHidden,false,JSON.stringify(result));
  assert.equal(result.pillText,'Вниз ↓',JSON.stringify(result));

  // 3. The same no-unread down control must load the real tail, not the bottom of the current bounded DOM.
  await page.locator('#newMessagesPill').click();
  await page.waitForFunction(()=>!activeChatHistory.loading&&!activeChatHistory.hasNewer&&!activeChatHistory.localNewer174);
  result=await page.evaluate(()=>{
    const r=test17825[1],box=document.getElementById('messages');
    return{lastMounted:Boolean(findMessageElement(r.last)),atBottom:isMessagesAtBottom(box),hasNewer:Boolean(activeChatHistory.hasNewer),scrollTop:box.scrollTop,max:Math.max(0,box.scrollHeight-box.clientHeight)};
  });
  assert.equal(result.lastMounted,true,JSON.stringify(result));
  assert.equal(result.hasNewer,false,JSON.stringify(result));
  assert.equal(result.atBottom,true,JSON.stringify(result));
  assert.ok(Math.abs(result.scrollTop-result.max)<=2,JSON.stringify(result));

  // 4. Explicit saved atBottom opens directly at the current tail when there is no unread.
  result=await page.evaluate(async()=>{
    const r=test17825[2],deviceId=getOrCreateDeviceId();
    const response=await fetch('/api/rooms/'+r.roomId+'/view-state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId,anchorMessageId:null,anchorOffsetPx:0,atBottom:true})});
    if(!response.ok)throw new Error('failed to save bottom fixture');
    await openChat(r.roomId);
    const box=document.getElementById('messages');
    return{lastMounted:Boolean(findMessageElement(r.last)),atBottom:isMessagesAtBottom(box),hasNewer:Boolean(activeChatHistory.hasNewer),scrollTop:box.scrollTop,max:Math.max(0,box.scrollHeight-box.clientHeight)};
  });
  assert.equal(result.lastMounted,true,JSON.stringify(result));
  assert.equal(result.hasNewer,false,JSON.stringify(result));
  assert.equal(result.atBottom,true,JSON.stringify(result));
  assert.ok(Math.abs(result.scrollTop-result.max)<=2,JSON.stringify(result));

  assert.deepEqual(errors,[]);
  console.log('PASS 178.25 first unread opens in its established visible position');
  console.log('PASS 178.25 saved anchor restores its previous pixel offset when unread is absent');
  console.log('PASS 178.25 down control loads the real bounded-history tail before reporting bottom');
  console.log('PASS 178.25 saved atBottom opens at the current tail');
  console.log('NOTE synthetic Chromium only; physical mobile acceptance remains deferred');
}).catch(error=>{console.error(error);process.exitCode=1;});
