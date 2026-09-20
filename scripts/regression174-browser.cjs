'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');
run(async({newClient,errors,temp,root})=>{
  let passed=0;const failed=[];
  const check=async(name,task)=>{try{await task();passed++;console.log('PASS '+name);}catch(error){failed.push(name);console.error('FAIL '+name+': '+error.stack);}};
  const page=await newClient();
  const fixtures=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),output=[];
    for(const [name,count,incoming] of [['long',1500,false],['short',5,false],['unread',1200,true]]){
      const secret='test-174-'+name,key=await deriveKey(secret);
      const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const data=await(await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})})).json();
      STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});upsertChat(data.publicId,{});
      const encrypted=[];for(let i=0;i<12;i++)encrypted.push(await encryptText('History '+i+' '+('line of text '.repeat(i*6)),key));
      output.push({roomId:data.publicId,deviceId,count,incoming,encrypted});
    }
    return output;
  });
  const seeded=JSON.parse(execFileSync(process.env.FPCHAT_TEST_NODE||process.execPath,[path.join(root,'scripts/seed-history174.cjs')],{input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures}),encoding:'utf8'}));
  await page.evaluate(data=>window.test174=data,seeded);
  await check('keyed chat rows, search cancellation and existing row identity',async()=>{
    const result=await page.evaluate(async()=>{
      const saved=state.chats;
      state.chats=Array.from({length:500},(_,i)=>({roomId:'list174-'+i,lastMessage:'row '+i,lastActivity:'2026-09-18T00:00:00Z'}));
      renderChats();await FPChatList174.idle();
      const original=els.rows.querySelector('[data-room-id="list174-10"]');
      state.chats[10].unread=7;renderChats();await FPChatList174.idle();
      const same=original===els.rows.querySelector('[data-room-id="list174-10"]');
      els.search.value='list174-4';renderChats();els.search.value='list174-499';renderChats();await FPChatList174.idle();
      const ids=[...els.rows.querySelectorAll('[data-room-id]')].map(n=>n.dataset.roomId);
      els.search.value='';state.chats=saved;renderChats();await FPChatList174.idle();return{same,ids};
    });
    assert.deepEqual(result,{same:true,ids:['list174-499']});
  });
  await check('cooperative work yields and cancels an obsolete batch',async()=>{
    const result=await page.evaluate(async()=>{
      let current=true,processed=0,observed=0;
      setTimeout(()=>{observed=processed;current=false;},0);
      const completed=await FPWork174.each(Array.from({length:500}),()=>processed++,{current:()=>current,batch:20});
      return{completed,processed,observed};
    });
    assert.equal(result.completed,false);assert.equal(result.processed,20);assert.equal(result.observed,20);
  });
  await check('saved distant anchor uses two pages and preserves its pixel offset',async()=>{
    const result=await page.evaluate(async()=>{
      const a=test174[0],deviceId=getOrCreateDeviceId();
      const anchor=a.first+220;
      await fetch(`/api/rooms/${a.roomId}/view-state`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId,anchorMessageId:anchor,anchorOffsetPx:11,atBottom:false})});
      const before=FPHistory174.snapshot().requests;await openChat(a.roomId);
      const box=document.getElementById('messages'),node=findMessageElement(anchor);
      return{requests:FPHistory174.snapshot().requests-before,mounted:FPHistory174.snapshot().mounted,offset:node.getBoundingClientRect().top-box.getBoundingClientRect().top,hasNewer:activeChatHistory.hasNewer};
    });
    assert.equal(result.requests,2);assert(result.mounted<=200);assert(Math.abs(result.offset-11)<=2);assert.equal(result.hasNewer,true);
  });
  await check('bidirectional paging stays bounded and preserves variable-height anchors',async()=>{
    const result=await page.evaluate(async()=>{
      await FPHistory174.jump();let max=0,maxDrift=0;
      for(const direction of ['older','older','older','older','older','older','newer','newer','newer','newer','newer','newer']){
        while(activeChatHistory.loading)await new Promise(r=>setTimeout(r,10));
        const box=document.getElementById('messages');
        scrollCoordinator.write(box,direction==='older'?0:box.scrollHeight,'auto');
        const anchor=getFirstVisibleMessageAnchor(box);
        await FPHistory174.load(direction);
        const node=findMessageElement(anchor.anchorMessageId);
        if(!node)throw Error('Visible anchor was evicted');
        maxDrift=Math.max(maxDrift,Math.abs(node.getBoundingClientRect().top-box.getBoundingClientRect().top-anchor.anchorOffsetPx));
        max=Math.max(max,FPHistory174.snapshot().mounted);
      }
      return{max,maxDrift,stats:FPHistory174.snapshot()};
    });
    assert(result.max<=300,JSON.stringify(result));assert(result.maxDrift<=2,JSON.stringify(result));assert(result.stats.evictions>0);
  });
  await check('reply source survives eviction, newer edit and delete remain canonical',async()=>{
    const result=await page.evaluate(async()=>{
      const a=test174[0];await FPHistory174.jump(a.replySource);const original=getMessageReplyMeta(a.replySource).preview;
      FPMessageStore172.applyEdit(a.roomId,{id:a.replySource,edited_at:'2026-09-19T12:00:00Z'},'canonical edit');
      await FPHistory174.jump();
      const edited=findMessageElement(a.last)?.querySelector('.reply-block-preview')?.textContent;
      FPMessageStore172.markDeleted(a.roomId,a.replySource,{scope:'all'});
      await FPHistory174.jump(a.replySource);
      await FPHistory174.jump();
      return{original,edited,deleted:findMessageElement(a.last)?.querySelector('.reply-block-preview')?.textContent};
    });
    assert.notEqual(result.original,'Сообщение недоступно');assert.equal(result.edited,'canonical edit');assert.equal(result.deleted,'Сообщение удалено');
  });
  await check('pins use the same distant jump path',async()=>{
    const status=await page.evaluate(async()=>{
      const a=test174[0];return(await fetch(`/api/rooms/${a.roomId}/messages/${a.first+40}/pins`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:getOrCreateDeviceId(),scope:'personal'})})).status;
    });
    assert.equal(status,200);
    await page.locator('.chat-pin-bar').waitFor();
    await page.locator('.chat-pin-main').click();
    await page.waitForFunction(()=>!!findMessageElement(test174[0].first+40));
    assert((await page.evaluate(()=>FPHistory174.snapshot().mounted))<=300);
  });
  await check('selection survives unmount/remount and can delete an offscreen message',async()=>{
    const selected=seeded[0].last-4;
    await page.evaluate(async()=>{await FPHistory174.jump();});
    await page.locator(`#messages [data-message-id="${selected}"]`).click({button:'right'});
    await page.locator('[data-fp-message-action="select"]').click();
    await page.waitForFunction(()=>document.body.classList.contains('fp-message-selection-open'));
    await page.evaluate(async()=>{await FPHistory174.jump(test174[0].first+40);});
    assert.equal(await page.locator('.message-selection-count').textContent(),'Выбрано 1');
    await page.evaluate(async()=>{await FPHistory174.jump();});
    await page.locator(`#messages [data-message-id="${selected}"].message-selection-selected`).waitFor();
    await page.evaluate(async()=>{await FPHistory174.jump(test174[0].first+40);});
    await page.locator('.message-selection-delete').click();
    await page.locator('[data-selection-delete-scope="all"]').click();
    await page.waitForFunction(()=>!document.body.classList.contains('fp-message-selection-open'));
    await page.evaluate(async()=>{await FPHistory174.jump();});
    assert.equal(await page.locator(`#messages [data-message-id="${selected}"]`).count(),0);
  });
  await check('sending from older history reaches the tail with one acknowledged message',async()=>{
    await page.evaluate(async()=>{await FPHistory174.jump(test174[0].first+40);});
    await page.locator('#msgInput').fill('174 outgoing from old history');
    await page.locator('#sendForm').evaluate(form=>form.requestSubmit());
    await page.waitForFunction(()=>{
      const rows=[...document.querySelectorAll('#messages .bubble-wrap.msg')].filter(n=>n.textContent.includes('174 outgoing from old history'));
      return rows.length===1&&Number(rows[0].dataset.messageId)>0&&!activeChatHistory.hasNewer&&!activeChatHistory.loading;
    });
    const result=await page.evaluate(()=>({previous:!!findMessageElement(test174[0].last),count:FPHistory174.snapshot().mounted}));
    assert.equal(result.previous,true);assert(result.count<=300);
  });
  await check('an entirely tombstoned page still advances the history cursor',async()=>{
    const result=await page.evaluate(async()=>{
      const a=test174[0];await FPHistory174.jump(a.first+300);
      const cursor=activeChatHistory.nextCursor;
      for(let n=cursor-100;n<cursor;n++)FPMessageStore172.markDeleted(a.roomId,n,{scope:'all'});
      await FPHistory174.load('older');const after=activeChatHistory.nextCursor;
      await FPHistory174.load('older');
      return{cursor,after,oldest:activeChatHistory.oldestMessageId};
    });
    assert(result.after<result.cursor);assert(result.oldest<result.after);
  });
  await check('late anchor response cannot replace another room',async()=>{
    const result=await page.evaluate(async()=>{
      const [a,b]=test174;await FPHistory174.jump();let release,started;
      const gate=new Promise(r=>started=r);
      const off=FPNetwork171.use({id:'174-delayed-anchor',priority:-1000,handler:async({input,init,next})=>{
        const response=await next(input,init);
        if(String(input).includes(`/rooms/${a.roomId}/messages?`)&&String(input).includes('before=')){started();await new Promise(r=>release=r);}
        return response;
      }});
      try{const task=FPHistory174.jump(a.first+60);await gate;await openChat(b.roomId);release();await task;return{room:state.roomId,foreign:!!findMessageElement(a.first+60),count:FPHistory174.snapshot().mounted};}
      finally{off();}
    });
    assert.equal(result.room,seeded[1].roomId);assert.equal(result.foreign,false);assert(result.count<=5);
  });
  await check('first unread far from tail is visible without reading the hidden tail',async()=>{
    const result=await page.evaluate(async()=>{
      const u=test174[2],before=FPHistory174.snapshot().requests;await openChat(u.roomId);
      const target=findMessageElement(u.firstUnread),box=document.getElementById('messages');
      const rect=target.getBoundingClientRect(),bounds=box.getBoundingClientRect();
      const snapshot=await(await fetch(`/api/rooms/${u.roomId}/messages?deviceId=${getOrCreateDeviceId()}`)).json();
      return{requests:FPHistory174.snapshot().requests-before,visible:rect.bottom>=bounds.top&&rect.top<=bounds.bottom,geometry:{top:rect.top,bottom:rect.bottom,boxTop:bounds.top,boxBottom:bounds.bottom,scroll:box.scrollTop},mounted:FPHistory174.snapshot().mounted,tail:snapshot.messages.at(-1).status,unread:snapshot.unreadCount,hasNewer:activeChatHistory.hasNewer};
    });
    assert.equal(result.requests,2);assert.equal(result.visible,true,JSON.stringify(result));assert(result.mounted<=200);assert.notEqual(result.tail,'read');assert(result.unread>=990);assert.equal(result.hasNewer,true);
  });
  await check('unread pill loads the first unread outside the mounted window',async()=>{
    const first=await page.evaluate(async()=>{
      const u=test174[2];await FPHistory174.jump(u.first);
      if(document.querySelector('#messages .new-messages-divider'))throw Error('Evicted unread anchor left an orphan divider');
      const data=await(await fetch(`/api/rooms/${u.roomId}/messages?deviceId=${getOrCreateDeviceId()}&limit=1`)).json();
      if(findMessageElement(data.firstUnreadMessageId))throw Error('Fixture unread must be outside DOM');
      return data.firstUnreadMessageId;
    });
    await page.locator('#newMessagesPill').click();
    await page.waitForFunction(id=>!!findMessageElement(id),first);
    assert((await page.evaluate(()=>FPHistory174.snapshot().mounted))<=300);
  });
  await check('incoming while reading older pages increments unread without creating a gap in DOM',async()=>{
    const result=await page.evaluate(async()=>{
      const u=test174[2],box=document.getElementById('messages'),anchor=getFirstVisibleMessageAnchor(box),before=box.querySelectorAll('.bubble-wrap.msg').length;
      const encrypted=await encryptText('late incoming');
      await processStableIncomingMessage(u.roomId,{id:u.last+100,created_at:new Date().toISOString(),sender_device_id:'test-incoming',sender_name:'peer',type:'text',status:'sent',...encrypted},getOrCreateDeviceId(),{notify:false});
      return{before,after:box.querySelectorAll('.bubble-wrap.msg').length,hasNewer:activeChatHistory.hasNewer,gap:!!findMessageElement(u.last+100),offset:findMessageElement(anchor.anchorMessageId).getBoundingClientRect().top-box.getBoundingClientRect().top-anchor.anchorOffsetPx};
    });
    assert.equal(result.after,result.before);assert.equal(result.hasNewer,true);assert.equal(result.gap,false);assert(Math.abs(result.offset)<=2);
  });
  await check('eviction releases a thumbnail that finishes after its message is removed',async()=>{
    const result=await page.evaluate(async()=>{
      await openChat(test174[0].roomId);
      const original=fetchMediaThumbUrl,revoke=URL.revokeObjectURL;
      let release;const revoked=[];
      fetchMediaThumbUrl=()=>new Promise(resolve=>release=resolve);
      URL.revokeObjectURL=url=>{revoked.push(url);revoke.call(URL,url);};
      try{
        const message={id:9000001,created_at:new Date().toISOString(),type:'media',status:'read',sender_device_id:getOrCreateDeviceId(),sender_name:'fixture',media:[{public_id:'174-delayed-thumb',media_kind:'photo',mime_type:'image/png'}]};
        const node=appendMessage(document.getElementById('messages'),message,'',true,false);
        const url=URL.createObjectURL(new Blob(['fixture'],{type:'image/png'}));
        await FPHistory174.jump(test174[0].first+40);
        release(url);await new Promise(resolve=>setTimeout(resolve,0));
        return{detached:!node.isConnected,revoked:revoked.includes(url),rebound:[...node.querySelectorAll('img')].some(img=>img.src===url)};
      }finally{fetchMediaThumbUrl=original;URL.revokeObjectURL=revoke;}
    });
    assert.deepEqual(result,{detached:true,revoked:true,rebound:false});
  });
  await check('startup waits for delayed lifecycle and loads one copy of each owner',async()=>{
    const delayed=await newClient(async p=>{
      await p.route('**/room-lifecycle.js*',async route=>{await new Promise(r=>setTimeout(r,250));await route.continue();});
    });
    const result=await delayed.evaluate(()=>({ready:FPRoomLifecycle98Ready,owners:['network171','room-context170','room-open170','history174'].map(name=>[...document.scripts].filter(s=>new URL(s.src||location.href).pathname===`/${name}.js`).length),errors:FPBoot152.errors()}));
    assert.deepEqual(result,{ready:true,owners:[1,1,1,1],errors:[]});await delayed.close();
  });
  await check('optional history asset failure leaves a usable fallback client',async()=>{
    const fallback=await newClient(async p=>p.route('**/history174.js*',route=>route.abort()));
    const result=await fallback.evaluate(()=>({fallback:!window.FPHistory174,app:!!window.FPMediaSend170,failed:FPBoot152.errors().some(url=>url.includes('/history174.js'))}));
    assert.deepEqual(result,{fallback:true,app:true,failed:true});await fallback.close();
  });
  await check('no uncaught browser errors',async()=>assert.deepEqual(errors,[]));
  console.log(JSON.stringify({passed,failed,environment:'Linux headless Chromium; physical mobile acceptance remains separate'}));
  if(failed.length)process.exitCode=1;
}).catch(error=>{console.error(error);process.exitCode=1;});
