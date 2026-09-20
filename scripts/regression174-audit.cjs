'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');
run(async({newClient,errors,temp,root,browser,origin})=>{
  let passed=0;const failed=[];
  const check=async(name,task)=>{if(process.env.AUDIT_FOCUS&&!name.includes(process.env.AUDIT_FOCUS))return;try{await task();passed++;console.log('PASS '+name);}catch(error){failed.push(name);console.error('FAIL '+name+': '+error.stack);}};
  const page=await newClient();
  const fixtures=await page.evaluate(async()=>{
    const fixtures=[],deviceId=getOrCreateDeviceId();
    for(const name of ['audit-a','audit-b']){
      const secret='174-'+name,key=await deriveKey(secret),recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
      const data=await(await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})})).json();
      STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});upsertChat(data.publicId,{});
      fixtures.push({roomId:data.publicId,inviteLink:data.inviteLink,deviceId,count:12,incoming:false,encrypted:[await encryptText('audit original',key)]});
    }
    return fixtures;
  });
  const seeded=JSON.parse(execFileSync(process.env.FPCHAT_TEST_NODE||process.execPath,[path.join(root,'scripts/seed-history174.cjs')],{input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures}),encoding:'utf8'}));
  await page.evaluate(data=>window.audit174=data,seeded);
  const query=sql=>JSON.parse(execFileSync(process.env.FPCHAT_TEST_NODE||process.execPath,['-e',"const D=require('better-sqlite3');const d=new D(process.argv[1],{readonly:true});console.log(JSON.stringify(d.prepare(process.argv[2]).all()));d.close();",path.join(temp,'test.sqlite'),sql],{encoding:'utf8'}));
  async function preview(count=1){
    await page.evaluate(async count=>{
      await openChat(audit174[0].roomId);
      const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH0QAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
      const items=Array.from({length:count},(_,i)=>{const file=new File([bytes],`image-${i}.png`,{type:'image/png'});return{id:crypto.randomUUID(),file,kind:'image',thumbnailBlob:file,objectUrl:URL.createObjectURL(file),thumbnailObjectUrl:URL.createObjectURL(file),width:1,height:1,uploadedMedia:null};});
      mediaPreviewState={roomId:state.roomId,items,caption:'initial caption',sending:false};renderMediaPreviewModal();
    },count);
  }
  async function holdUpload(holdAt=1){
    let release,started;
    const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
    let count=0;
    await page.route('**/media/upload',async route=>{
      const response=await route.fetch();
      if(++count===holdAt){started();await gate;}
      await route.fulfill({response}).catch(()=>{});
    });
    return{ready,release,close:async()=>{release();await page.unroute('**/media/upload');}};
  }
  await check('real upload uses cancellable transport, freezes membership and sends the edited caption',async()=>{
    await preview(2);const hold=await holdUpload();
    const before=query("SELECT count(*) n FROM media WHERE status='attached'")[0].n;
    let locked,uploads;
    try{
      uploads=await page.evaluate(()=>FPNetwork171.snapshot().xhr.uploads);
      await page.evaluate(()=>{window.auditSend=sendMediaFromPreview(document.getElementById('mediaPreviewRoot'));});
      await hold.ready;
      locked=await page.locator('.media-item-remove').first().isDisabled();
      await page.locator('.media-caption-input').fill('changed during real upload');
      hold.release();await page.evaluate(()=>auditSend);
      await page.waitForFunction(()=>[...document.querySelectorAll('#messages .message-text')].some(n=>n.textContent==='changed during real upload'),null,{timeout:3000});
      assert.equal(locked,true);assert.equal(query("SELECT count(*) n FROM media WHERE status='attached'")[0].n,before+2);
      assert.equal(await page.evaluate(()=>FPNetwork171.snapshot().xhr.uploads),uploads+2);
      const media=query("SELECT public_id FROM media WHERE status='attached' ORDER BY id DESC LIMIT 1")[0];
      const size=await page.evaluate(async id=>(await readEncryptedMedia174(`/api/media/${id}/blob?deviceId=${activeChatDeviceId}`,'image/png',state.key)).size,media.public_id);
      assert(size>0);
    }finally{await hold.close();}
  });
  await check('cancel after the first album upload cleans both completed and unknown-response files',async()=>{
    await preview(2);const hold=await holdUpload(2),before=query('SELECT count(*) n FROM messages')[0].n;
    try{
      await page.evaluate(()=>{window.auditSend=sendMediaFromPreview(document.getElementById('mediaPreviewRoot'));});await hold.ready;
      assert.match(await page.locator('.media-upload-progress').textContent(),/Загрузка \d+%/);
      await page.locator('.media-preview-header .media-preview-remove').click();
      hold.release();await page.evaluate(()=>auditSend);
      assert.equal(query('SELECT count(*) n FROM messages')[0].n,before);
      assert.equal(query("SELECT count(*) n FROM media WHERE status='pending'")[0].n,0);
    }finally{await hold.close();}
  });
  await check('cancel during encryption never starts an upload',async()=>{
    await preview();
    const result=await page.evaluate(async()=>{
      const file=mediaPreviewState.items[0].file,base=file.arrayBuffer.bind(file);let release,started;
      const gate=new Promise(r=>started=r);file.arrayBuffer=async()=>{started();await new Promise(r=>release=r);return base();};
      const before=FPNetwork171.snapshot().xhr.uploads,task=sendMediaFromPreview(document.getElementById('mediaPreviewRoot'));
      await gate;const cancelled=FPMediaSend170.cancelPreview();release();await Promise.all([task,cancelled]);
      return{uploads:FPNetwork171.snapshot().xhr.uploads-before,operations:FPRoomContext170.snapshot().operations.length};
    });
    assert.deepEqual(result,{uploads:0,operations:0});
  });
  await check('preview cancel aborts real XHR, sends nothing and removes unknown-response pending media',async()=>{
    await preview();const hold=await holdUpload(),before=query('SELECT count(*) n FROM messages')[0].n;
    try{
      await page.evaluate(()=>{window.auditSend=sendMediaFromPreview(document.getElementById('mediaPreviewRoot'));});await hold.ready;
      await page.locator('.media-preview-header .media-preview-remove').click();
      hold.release();await page.evaluate(()=>auditSend);
      await page.waitForTimeout(150);
      assert.equal(query('SELECT count(*) n FROM messages')[0].n,before);
      assert.equal(query("SELECT count(*) n FROM media WHERE status='pending'")[0].n,0);
      assert.equal(await page.evaluate(()=>FPRoomContext170.snapshot().operations.length),0);
    }finally{await hold.close();}
  });
  await check('media A to B to A completion preserves the new draft and reply',async()=>{
    await preview();const hold=await holdUpload();
    try{
      await page.evaluate(()=>{window.auditSend=sendMediaFromPreview(document.getElementById('mediaPreviewRoot'));});await hold.ready;
      await page.evaluate(async()=>{
        await openChat(audit174[1].roomId);await openChat(audit174[0].roomId);
        const draft=ensureDraftState(state.roomId);draft.text='new draft';draft.replyTo={messageId:audit174[0].first,preview:'new reply'};
        document.getElementById('msgInput').value='new draft';await saveDraftNow(state.roomId);
      });
      hold.release();await page.evaluate(()=>auditSend);
      const result=await page.evaluate(()=>({text:ensureDraftState(state.roomId).text,reply:ensureDraftState(state.roomId).replyTo?.messageId}));
      assert.deepEqual(result,{text:'new draft',reply:seeded[0].first});
    }finally{await hold.close();}
  });
  await check('history rechecks edit/delete after decrypt and just before detached-window mount',async()=>{
    const result=await page.evaluate(async()=>{
      await openChat(audit174[0].roomId);await openChat(audit174[1].roomId);await openChat(audit174[0].roomId);
      const room=state.roomId,first=audit174[0].first,base=decryptText;
      let calls=0,release,started;const gate=new Promise(r=>started=r);
      decryptText=async(...args)=>{const text=await base(...args);if(++calls===4){started();await new Promise(r=>release=r);}return text;};
      try{
        const task=FPHistory174.jump();await gate;
        // First two nodes were already prepared in the detached window; fourth
        // is still awaiting decrypt. Check both sides of that boundary.
        FPMessageStore172.applyEdit(room,{id:first,edited_at:'2030-01-01T00:00:00Z'},'edit during detached render');
        FPMessageStore172.markDeleted(room,first+1,{scope:'all'});
        FPMessageStore172.markDeleted(room,first+3,{scope:'all'});
        release();await task;
        return{text:findMessageElement(first)?.querySelector('.message-text')?.textContent,deletedPrepared:!!findMessageElement(first+1),deletedAwaited:!!findMessageElement(first+3)};
      }finally{decryptText=base;release?.();}
    });
    assert.deepEqual(result,{text:'edit during detached render',deletedPrepared:false,deletedAwaited:false});
  });
  await check('store pruning protects reply sources across more than 10000 canonical records',async()=>{
    const result=await page.evaluate(()=>{
      const store=FPMessageStore172,room='audit-store-pruning';
      store.upsert(room,{id:1,created_at:'2026-01-01T00:00:00Z'},{text:'protected source',source:'history'});
      for(let i=2;i<=10000;i++)store.upsert(room,{id:i,created_at:'2026-01-02T00:00:00Z'},{text:'filler',source:'history'});
      store.upsert(room,{id:10001,reply_to_message_id:1,created_at:'2026-01-03T00:00:00Z'},{text:'reply',source:'history'});
      for(let i=10002;i<=10010;i++)store.upsert(room,{id:i,created_at:'2026-01-04T00:00:00Z'},{text:'newer',source:'history'});
      return{preview:store.resolveReply(room,1).preview,dependent:!!store.get(room,10001)};
    });
    assert.deepEqual(result,{preview:'protected source',dependent:true});
  });
  await check('direct chat startup waits for room-open owner and joins exactly once',async()=>{
    const storage=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
    const context=await browser.newContext();const direct=await context.newPage();
    try{
      direct.on('pageerror',error=>errors.push(error.message));
      await direct.addInitScript(storage=>{
        for(const [key,value]of Object.entries(storage))localStorage.setItem(key,value);
        window.auditJoins=[];const base=window.fetch;
        window.fetch=function(input,init){if(/\/join(?:\?|$)/.test(String(input)))auditJoins.push({url:String(input),owner:!!window.__fpRoomOpen170Installed,context:!!window.FPRoomContext170});return base.call(this,input,init);};
      },storage);
      await direct.route('**/room-open170.js*',async route=>{await new Promise(r=>setTimeout(r,350));await route.continue();});
      await direct.goto(`${origin}/chat/${seeded[0].roomId}`);
      await direct.waitForFunction(()=>window.FPMediaSend170&&!document.getElementById('bootHold152'));
      const joins=await direct.evaluate(()=>auditJoins);
      assert.equal(joins.length,1,JSON.stringify(joins));assert(joins.every(join=>join.owner&&join.context),JSON.stringify(joins));
    }finally{await context.close();}
  });
  await check('pending sends stay bounded, page locally and accept ACK after DOM eviction',async()=>{
    const result=await page.evaluate(async()=>{
      await openChat(audit174[1].roomId);const box=document.getElementById('messages');
      const sent=[],base=state.ws.send.bind(state.ws);
      state.ws.send=payload=>{const data=JSON.parse(payload);if(data.type==='message:send')sent.push(data);else base(payload);};
      try{
        for(let i=0;i<420;i++){
          const clientMessageId='pending-audit-'+i;
          const message={id:clientMessageId,client_message_id:clientMessageId,created_at:new Date(1900000000000+i).toISOString(),sender_device_id:getOrCreateDeviceId(),sender_name:'me',status:'sending',type:'text'};
          appendMessage(box,message,'pending '+i,true,true);
          queuePendingTextSend({type:'message:send',roomId:state.roomId,clientMessageId,ciphertext:'fixture',iv:'fixture'});
        }
        const before=FPHistory174.snapshot().mounted;
        const firstMissing=!findMessageElement(null,'pending-audit-0');
        const stored=!!FPMessageStore172.get(state.roomId,'pending-audit-0');
        scrollCoordinator.write(box,0);await FPHistory174.load('older');
        while(activeChatHistory.loading)await new Promise(r=>setTimeout(r,10));
        scrollCoordinator.write(box,0);await FPHistory174.load('older');
        const restored=!!findMessageElement(null,'pending-audit-0');
        await FPHistory174.jump();
        handleWsMessageAck({type:'message:ack',roomId:state.roomId,clientMessageId:'pending-audit-0',messageId:990001,status:'delivered'});
        return{before,after:FPHistory174.snapshot().mounted,firstMissing,stored,restored,acked:FPMessageStore172.get(state.roomId,990001)?.clientMessageId,queued:pendingTextSends.has('pending-audit-1')};
      }finally{state.ws.send=base;for(let i=0;i<420;i++)clearPendingText('pending-audit-'+i);}
    });
    assert(result.before<=300&&result.after<=300,JSON.stringify(result));
    assert.equal(result.firstMissing,true);assert.equal(result.stored,true);assert.equal(result.restored,true,JSON.stringify(result));assert.equal(result.acked,'pending-audit-0');assert.equal(result.queued,true);
  });
  await check('direct invite startup waits for owners and renders system events with one join',async()=>{
    const context=await browser.newContext(),direct=await context.newPage();
    try{
      direct.on('pageerror',error=>errors.push(error.message));direct.on('dialog',dialog=>dialog.dismiss());
      await direct.addInitScript(()=>{
        window.auditJoins=[];const base=window.fetch;
        window.fetch=function(input,init){if(/\/join(?:\?|$)/.test(String(input)))auditJoins.push({owner:!!window.__fpRoomOpen170Installed,context:!!window.FPRoomContext170});return base.call(this,input,init);};
      });
      await direct.route('**/room-open170.js*',async route=>{await new Promise(r=>setTimeout(r,350));await route.continue();});
      await direct.goto(fixtures[0].inviteLink);
      await direct.waitForFunction(()=>window.FPMediaSend170&&!!document.querySelector('#messages .msg')&&!document.getElementById('bootHold152'));
      const result=await direct.evaluate(()=>({joins:auditJoins,bad:document.getElementById('messages').textContent.includes('[cannot decrypt]'),room:state.roomId}));
      assert.equal(result.room,seeded[0].roomId);assert.equal(result.bad,false);assert.deepEqual(result.joins,[{owner:true,context:true}]);
    }finally{await context.close();}
  });
  await check('failed room-open asset stops direct navigation with a retry screen',async()=>{
    const context=await browser.newContext(),direct=await context.newPage();let joins=0;
    try{
      direct.on('request',request=>{if(/\/join(?:\?|$)/.test(request.url()))joins++;});
      await direct.route('**/room-open170.js*',route=>route.abort());
      await direct.goto(fixtures[1].inviteLink);
      await direct.getByText('Не удалось загрузить приложение. Обновите страницу.').waitFor();
      assert.equal(joins,0);
    }finally{await context.close();}
  });
  await check('message gestures respect voice and promoted layers; context close preserves current scroll',async()=>{
    const result=await page.evaluate(async()=>{
      await openChat(audit174[0].roomId);const box=document.getElementById('messages'),node=box.querySelector('.msg'),target=node.querySelector('.message-text');
      const touch=(el,type,x=250)=>{
        const point={identifier:7,target:el,clientX:x,clientY:200,pageX:x,pageY:200};
        const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[point]});Object.defineProperty(event,'changedTouches',{value:[point]});el.dispatchEvent(event);
      };
      const delay=()=>new Promise(r=>setTimeout(r,480));
      const escape=()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      const voice=document.createElement('span');voice.className='fp-voice-waveform';node.querySelector('.bubble').appendChild(voice);
      ensureDraftState(state.roomId).replyTo=null;
      touch(voice,'touchstart');await delay();const voiceContext=!!document.querySelector('.message-context-root');touch(voice,'touchmove',140);touch(voice,'touchend',140);
      const voiceReply=!!ensureDraftState(state.roomId).replyTo;voice.remove();escape();
      touch(target,'touchstart');const release=FPLayer173.claim('modal','audit-gesture');await delay();
      const promotedContext=!!document.querySelector('.message-context-root');touch(target,'touchmove',140);touch(target,'touchend',140);
      const promotedReply=!!ensureDraftState(state.roomId).replyTo;release();escape();
      touch(target,'touchstart');touch(target,'touchmove',140);touch(target,'touchend',140);
      const normalReply=!!ensureDraftState(state.roomId).replyTo;
      touch(target,'touchstart');await delay();touch(target,'touchend');
      const normalContext=!!document.querySelector('.message-context-root');
      scrollCoordinator.write(box,Math.max(0,box.scrollTop-50));const expected=box.scrollTop;escape();
      return{voiceContext,voiceReply,promotedContext,promotedReply,normalReply,normalContext,scroll:box.scrollTop===expected};
    });
    assert.deepEqual(result,{voiceContext:false,voiceReply:false,promotedContext:false,promotedReply:false,normalReply:true,normalContext:true,scroll:true});
  });
  await check('history mount of own messages does not dismiss the unread divider',async()=>{
    const result=await page.evaluate(async()=>{
      await openChat(audit174[0].roomId);
      unreadDividerSession={roomId:state.roomId,messageId:String(audit174[0].last),dismissed:false};
      await FPHistory174.jump();await new Promise(requestAnimationFrame);
      return{dismissed:unreadDividerSession.dismissed,divider:!!document.querySelector('#messages .new-messages-divider')};
    });
    assert.deepEqual(result,{dismissed:false,divider:true});
  });
  await check('original body streams without eager buffering and holds its resource through consumption',async()=>{
    const result=await page.evaluate(async()=>{
      const controllers=[],started=[];
      const off=FPNetwork171.use({id:'audit-stream-original',priority:95,handler:({input})=>{
        started.push(String(input));return new Response(new ReadableStream({start(c){controllers.push(c);}}));
      }});
      const a=new AbortController(),b=new AbortController();let releaseConsumer,consuming;
      const consumed=new Promise(r=>consuming=r);
      try{
        const one=FPNetwork171.consumeMedia('/api/media/stream-a/blob',{signal:a.signal},async response=>{
          consuming();await response.arrayBuffer();await new Promise(r=>releaseConsumer=r);return 'one';
        });
        await consumed;
        const two=FPNetwork171.fetch('/api/media/stream-b/blob',{signal:b.signal}).then(r=>r.arrayBuffer());
        await new Promise(r=>setTimeout(r,10));
        const headersBeforeEnd=started.length===1;
        controllers[0].enqueue(new Uint8Array([1]));controllers[0].close();
        while(!releaseConsumer)await new Promise(r=>setTimeout(r,0));
        const held=FPNetwork171.snapshot().mediaBudget.active===1&&started.length===1;
        releaseConsumer();await one;
        while(started.length<2)await new Promise(r=>setTimeout(r,0));
        controllers[1].enqueue(new Uint8Array([2]));controllers[1].close();await two;
        return{headersBeforeEnd,held,active:FPNetwork171.snapshot().mediaBudget.active};
      }finally{a.abort();b.abort();releaseConsumer?.();off();}
    });
    assert.deepEqual(result,{headersBeforeEnd:true,held:true,active:0});
  });
  await check('queued and active original cancellation release the resource budget',async()=>{
    const result=await page.evaluate(async()=>{
      const off=FPNetwork171.use({id:'audit-stream-abort',priority:95,handler:()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));}}))});
      const first=new AbortController(),second=new AbortController();
      try{
        const response=await FPNetwork171.fetch('/api/media/abort-one/blob',{signal:first.signal});
        const waiting=FPNetwork171.fetch('/api/media/abort-two/blob',{signal:second.signal}).catch(e=>e.name);
        second.abort();const queued=await waiting;
        await response.body.cancel();
        const third=await FPNetwork171.fetch('/api/media/abort-three/blob',{signal:first.signal});
        const reader=third.body.getReader();const reading=(async()=>{while(!(await reader.read()).done){}return 'completed';})().catch(e=>e.name);first.abort();
        return{queued,activeAbort:await reading,active:FPNetwork171.snapshot().mediaBudget.active,slots:FPNetwork171.snapshot().mediaBudget.reservedSlots};
      }finally{first.abort();second.abort();off();}
    });
    assert.deepEqual(result,{queued:'AbortError',activeAbort:'AbortError',active:0,slots:0});
  });
  await check('uploadId cleanup is room scoped and the legacy upload remains compatible',async()=>{
    const result=await page.evaluate(async()=>{
      const [a,b]=audit174,uploadId=crypto.randomUUID().replaceAll('-','');
      const upload=async id=>{
        const form=new FormData();for(const [k,v]of Object.entries({deviceId:getOrCreateDeviceId(),mimeType:'image/png',mediaKind:'image',sizeBytes:1}))form.append(k,v);
        if(id)form.append('uploadId',id);form.append('encryptedFile',new Blob(['fixture']),'file.bin');
        return(await fetch(`/api/rooms/${a.roomId}/media/upload`,{method:'POST',body:form})).json();
      };
      const first=await upload(uploadId),retry=await upload(uploadId),legacy=await upload();
      const remove=(room,ids)=>fetch(`/api/rooms/${room}/media/pending`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:getOrCreateDeviceId(),...ids})});
      await remove(b.roomId,{uploadIds:[uploadId]});
      const kept=await fetch(`/api/media/${uploadId}/blob?deviceId=${getOrCreateDeviceId()}`);const scoped=kept.ok;await kept.arrayBuffer();
      const cleanup=await (await remove(a.roomId,{uploadIds:[uploadId],mediaIds:[legacy.media.id]})).json();
      const removed=await fetch(`/api/media/${uploadId}/blob?deviceId=${getOrCreateDeviceId()}&verify=removed`);await removed.arrayBuffer();
      return{same:first.media.id===retry.media.id,scoped,removed:removed.status,legacy:legacy.ok,deleted:cleanup.deleted};
    });
    assert.deepEqual(result,{same:true,scoped:true,removed:404,legacy:true,deleted:2});
  });
  await check('lifecycle resume effects coalesce and pagehide preserves one background notification',async()=>{
    const result=await page.evaluate(async()=>{
      const baseSync=startAppSessionSync,baseState=sendClientState,baseVersion=checkAppVersionOnEntry;
      let syncs=0,states=[];startAppSessionSync=()=>{syncs++;return Promise.resolve();};sendClientState=visible=>states.push(visible);checkAppVersionOnEntry=()=>{};
      try{
        window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));
        await new Promise(r=>setTimeout(r,20));
        window.dispatchEvent(new Event('pagehide'));return{syncs,states};
      }finally{startAppSessionSync=baseSync;sendClientState=baseState;checkAppVersionOnEntry=baseVersion;window.dispatchEvent(new Event('pageshow'));}
    });
    assert.deepEqual(result,{syncs:1,states:[false]});
  });
  await check('no uncaught browser errors',async()=>assert.deepEqual(errors,[]));
  console.log(JSON.stringify({passed,failed,environment:'Linux Chromium; production bootstrap and real XHR; physical mobile acceptance separate'}));
  if(failed.length)process.exitCode=1;
}).catch(error=>{console.error(error);process.exitCode=1;});
