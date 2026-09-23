'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {run}=require('./browser-harness174.cjs');

run(async({newClient,errors,temp,root})=>{
  const page=await newClient();
  await page.setViewportSize({width:390,height:844});

  const fixture=await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),secret='scroll17824',key=await deriveKey(secret);
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const data=await(await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})})).json();
    STORAGE.set(STORAGE.roomState(data.publicId),{deviceId,secret});
    upsertChat(data.publicId,{});
    const encrypted=[];
    for(let i=0;i<16;i++)encrypted.push(await encryptText('178.24 history '+i+' '+('variable line '.repeat((i%7)+1)),key));
    return{roomId:data.publicId,deviceId,count:450,incoming:false,encrypted};
  });
  const seeded=JSON.parse(execFileSync(process.env.FPCHAT_TEST_NODE||process.execPath,[path.join(root,'scripts/seed-history174.cjs')],{input:JSON.stringify({database:path.join(temp,'test.sqlite'),fixtures:[fixture]}),encoding:'utf8'}))[0];
  await page.evaluate(data=>window.test17824=data,seeded);
  await page.evaluate(async()=>{await openChat(test17824.roomId);});
  await page.waitForSelector('#messages .bubble-wrap.msg');

  // Delay one real older-page response. User scrolls while the request is in flight.
  const delayed=await page.evaluate(async()=>{
    const box=document.getElementById('messages');
    scrollCoordinator.write(box,Math.max(0,box.scrollHeight*0.25),'auto');
    let releaseFetch,markStarted;
    const started=new Promise(r=>markStarted=r);
    const release=new Promise(r=>releaseFetch=r);
    const off=FPNetwork171.use({id:'17824-delay-older',priority:-1000,handler:async({input,init,next})=>{
      const response=await next(input,init);
      if(String(input).includes('/rooms/'+test17824.roomId+'/messages?')&&String(input).includes('before=')){
        markStarted();
        await release;
      }
      return response;
    }});
    try{
      const task=FPHistory174.load('older');
      await started;
      // Synthetic native user position change while history fetch is unresolved.
      box.scrollTop=Math.min(Math.max(0,box.scrollHeight-box.clientHeight),box.scrollTop+Math.max(180,box.clientHeight*0.7));
      box.dispatchEvent(new Event('scroll'));
      await new Promise(r=>requestAnimationFrame(r));
      const anchor=getFirstVisibleMessageAnchor(box);
      const beforeTop=box.scrollTop;
      releaseFetch();
      await task;
      const node=findMessageElement(anchor.anchorMessageId);
      if(!node)throw new Error('user-visible anchor was lost after prepend');
      const offset=node.getBoundingClientRect().top-box.getBoundingClientRect().top;
      return{anchor,beforeTop,afterTop:box.scrollTop,offset,drift:offset-anchor.anchorOffsetPx,mounted:FPHistory174.snapshot().mounted};
    }finally{off();}
  });
  assert.ok(Math.abs(delayed.drift)<=2,JSON.stringify(delayed));
  assert.ok(delayed.mounted<=300,JSON.stringify(delayed));

  // Next older page contains one synthetic media message whose thumbnail resolves only after mount.
  const media=await page.evaluate(async()=>{
    const box=document.getElementById('messages');
    const originalThumb=fetchMediaThumbUrl;
    let resolveThumb,thumbStartedResolve;
    const thumbStarted=new Promise(r=>thumbStartedResolve=r);
    fetchMediaThumbUrl=(item)=>{
      if(item?.public_id!=='17824-delayed-thumb')return originalThumb(item);
      thumbStartedResolve();
      return new Promise(resolve=>{resolveThumb=resolve;});
    };
    let mutated=false;
    const off=FPNetwork171.use({id:'17824-media-page',priority:-1000,handler:async({input,init,next})=>{
      const response=await next(input,init);
      if(mutated||!String(input).includes('/rooms/'+test17824.roomId+'/messages?')||!String(input).includes('before='))return response;
      const data=await response.json();
      if(data.messages?.length){
        const index=Math.floor(data.messages.length/2);
        data.messages[index]={...data.messages[index],type:'media',media:[{public_id:'17824-delayed-thumb',media_kind:'photo',mime_type:'image/png'}]};
        mutated=true;
      }
      return new Response(JSON.stringify(data),{status:response.status,headers:{'Content-Type':'application/json'}});
    }});
    try{
      const anchorBefore=getFirstVisibleMessageAnchor(box);
      await FPHistory174.load('older');
      await thumbStarted;
      const mediaNode=[...box.querySelectorAll('.bubble-wrap.msg')].find(n=>n.querySelector('.media-tile'));
      if(!mediaNode)throw new Error('synthetic history media was not mounted');
      const tile=mediaNode.querySelector('.media-tile');
      const image=mediaNode.querySelector('.media-thumb');
      const anchor=getFirstVisibleMessageAnchor(box)||anchorBefore;
      const anchorNode=findMessageElement(anchor.anchorMessageId);
      const beforeOffset=anchorNode.getBoundingClientRect().top-box.getBoundingClientRect().top;
      const beforeHeight=tile.getBoundingClientRect().height;
      const svg='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="90"><rect width="320" height="90" fill="black"/></svg>');
      resolveThumb(svg);
      await new Promise(resolve=>{
        if(image.complete)return requestAnimationFrame(()=>requestAnimationFrame(resolve));
        image.addEventListener('load',()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),{once:true});
        image.addEventListener('error',()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),{once:true});
      });
      const afterOffset=anchorNode.getBoundingClientRect().top-box.getBoundingClientRect().top;
      const afterHeight=tile.getBoundingClientRect().height;
      return{beforeOffset,afterOffset,drift:afterOffset-beforeOffset,beforeHeight,afterHeight,heightDelta:afterHeight-beforeHeight,aspect:getComputedStyle(tile).aspectRatio,overflowAnchor:getComputedStyle(box).overflowAnchor};
    }finally{fetchMediaThumbUrl=originalThumb;off();}
  });
  assert.ok(Math.abs(media.drift)<=2,JSON.stringify(media));
  assert.ok(Math.abs(media.heightDelta)<=1,JSON.stringify(media));
  assert.equal(media.aspect,'1 / 1');
  assert.equal(media.overflowAnchor,'none');

  assert.deepEqual(errors,[]);
  console.log('PASS 178.24 delayed older fetch preserves the user position chosen while the request is in flight');
  console.log('PASS 178.24 late history thumbnail keeps reserved media height and does not move the visible anchor');
  console.log('NOTE synthetic Chromium only; physical mobile scroll acceptance is intentionally deferred');
}).catch(error=>{console.error(error);process.exitCode=1;});
