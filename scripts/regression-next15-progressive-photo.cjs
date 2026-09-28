'use strict';

const assert=require('node:assert/strict');
const {run}=require('./browser-harness174.cjs');

run(async({newClient,errors})=>{
  let passed=0;
  const pass=name=>{passed++;console.log('PASS next15 '+name);};
  const page=await newClient();
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>window.__fpMediaGallery134Installed);

  await page.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId();
    const secret='next15-progressive-photo';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})
    });
    if(!response.ok)throw Error('next15 room creation failed');
    const data=await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
    upsertChat(data.publicId,{});
    await openChat(data.publicId);

    const thumbSvg=id=>new Blob([
      '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">'
      +'<rect width="480" height="360" fill="#53657d"/>'
      +'<text x="24" y="54" fill="white" font-size="28">'+id+'</text></svg>'
    ],{type:'image/svg+xml'});
    const originalSvg=id=>new Blob([
      '<svg xmlns="http://www.w3.org/2000/svg" width="4032" height="3024">'
      +'<rect width="4032" height="3024" fill="#2f4967"/>'
      +'<path d="M0 1512H4032M2016 0V3024" stroke="white" stroke-width="20"/>'
      +'<text x="160" y="300" fill="white" font-size="160">'+id+'</text></svg>'
    ],{type:'image/svg+xml'});

    const realRead=readEncryptedMedia174;
    window.next15={
      roomId:data.publicId,
      deviceId,
      thumbCalls:0,
      blobCalls:0,
      activeBlob:0,
      maxActiveBlob:0,
      attempts:{},
      pending:new Map(),
      aborted:0,
      makeItem:id=>({public_id:'next15-'+id,media_kind:'image',mime_type:'image/svg+xml',width:4032,height:3024})
    };
    readEncryptedMedia174=async function(url,mime,key,options,...rest){
      if(!url.includes('/api/media/next15-'))return realRead(url,mime,key,options,...rest);
      const match=url.match(/\/api\/media\/next15-([^/]+)\/(thumb|blob)/);
      if(!match)throw Error('next15 fixture url mismatch '+url);
      const id=match[1],kind=match[2];
      if(kind==='thumb'){
        next15.thumbCalls++;
        return thumbSvg(id);
      }
      next15.blobCalls++;
      next15.activeBlob++;
      next15.maxActiveBlob=Math.max(next15.maxActiveBlob,next15.activeBlob);
      next15.attempts[id]=(next15.attempts[id]||0)+1;
      return new Promise((resolve,reject)=>{
        let settled=false;
        const finish=fn=>value=>{
          if(settled)return;
          settled=true;
          next15.activeBlob=Math.max(0,next15.activeBlob-1);
          next15.pending.delete(id);
          fn(value);
        };
        const ok=finish(resolve),bad=finish(reject);
        const abort=()=>{
          next15.aborted++;
          bad(new DOMException('fixture aborted','AbortError'));
        };
        options?.signal?.addEventListener?.('abort',abort,{once:true});
        next15.pending.set(id,{
          attempt:next15.attempts[id],
          resolve:()=>ok(originalSvg(id)),
          reject:()=>bad(new Error('fixture original failed'))
        });
      });
    };

    window.next15Resolve=id=>next15.pending.get(id)?.resolve();
    window.next15Reject=id=>next15.pending.get(id)?.reject();
    window.next15Snapshot=()=>({
      thumbCalls:next15.thumbCalls,
      blobCalls:next15.blobCalls,
      activeBlob:next15.activeBlob,
      maxActiveBlob:next15.maxActiveBlob,
      attempts:{...next15.attempts},
      pending:[...next15.pending.keys()],
      aborted:next15.aborted,
      viewer:mediaViewerState?{
        index:mediaViewerState.index,
        key:mediaViewerState.messageMedia?.[mediaViewerState.index]?.public_id||null
      }:null,
      layer:FPLayer173.topLayer(),
      pointer:FPGesture135.snapshot().pointer
    });
    window.next15Pointer=(type,id,x,y,target)=>{
      const node=target||document.querySelector('.fp-gallery134-stage');
      const event=new PointerEvent(type,{
        bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,
        button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,isPrimary:id===1
      });
      node.dispatchEvent(event);
    };

    const box=document.getElementById('messages');
    const append=(messageId,items)=>appendMessage(box,{
      id:messageId,type:'media',status:'read',sender_device_id:deviceId,
      sender_name:'Fixture',created_at:new Date(Date.UTC(2026,8,28,12,0,messageId%60)).toISOString(),
      media:items
    },'',true,false);

    append(15001,[next15.makeItem('main')]);
    append(15002,[next15.makeItem('close')]);
    append(15003,[next15.makeItem('error')]);
    append(15004,[next15.makeItem('nav-a'),next15.makeItem('nav-b')]);
  });

  await page.waitForFunction(()=>
    [...document.querySelectorAll('[data-message-id="15001"],[data-message-id="15002"],[data-message-id="15003"],[data-message-id="15004"]')]
      .flatMap(row=>[...row.querySelectorAll('.media-thumb')])
      .filter(img=>img.complete&&img.naturalWidth>0).length===5
  );

  const tick=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const snap=()=>page.evaluate(()=>next15Snapshot());
  const pointer=(type,id,x,y)=>page.evaluate(({type,id,x,y})=>next15Pointer(type,id,x,y),{type,id,x,y});
  const currentPhoto=()=>page.locator('[data-slot="current"] img');

  const thumbCallsBefore=await page.evaluate(()=>next15.thumbCalls);
  const mainThumb=await page.locator('[data-message-id="15001"] .media-thumb').evaluate(img=>img.currentSrc||img.src);
  await page.locator('[data-message-id="15001"] .media-tile').click();
  await page.waitForSelector('[data-slot="current"] img[data-fp-viewer-source="preview"]');
  await page.waitForFunction(()=>document.querySelector('[data-slot="current"] img')?.style.transform.includes('scale(1)'));
  const previewState=await currentPhoto().evaluate((img,expected)=>({
    sameUrl:(img.currentSrc||img.src)===expected,
    source:img.dataset.fpViewerSource,
    layout:{width:img.offsetWidth,height:img.offsetHeight},
    widthAttr:img.getAttribute('width'),heightAttr:img.getAttribute('height')
  }),mainThumb);
  assert.equal(previewState.sameUrl,true,'viewer did not reuse the already-ready chat preview URL');
  assert.equal(previewState.source,'preview');
  assert.equal(previewState.widthAttr,'4032');
  assert.equal(previewState.heightAttr,'3024');
  assert.equal(await page.evaluate(()=>next15.thumbCalls),thumbCallsBefore,'viewer fetched another thumbnail');
  assert.equal((await snap()).attempts.main,1,'selected original must use one existing loadAsset request');
  pass('selected photo mounts the existing decrypted thumbnail immediately without another media request');

  await page.evaluate(()=>{next15.progressiveNode=document.querySelector('[data-slot="current"] img');});
  await pointer('pointerdown',1,130,430);
  await pointer('pointerdown',2,230,430);
  await pointer('pointermove',1,80,430);
  await pointer('pointermove',2,280,430);
  await tick();
  let transform=await currentPhoto().evaluate(img=>new DOMMatrix(getComputedStyle(img).transform).a);
  assert.ok(Math.abs(transform-2)<0.03,'pinch on preview did not reach 2x');
  await pointer('pointerup',1,80,430);
  await pointer('pointerup',2,280,430);
  await tick();

  await page.evaluate(()=>next15Resolve('main'));
  await page.waitForSelector('[data-slot="current"] img[data-fp-viewer-source="original"]');
  await tick();
  const originalState=await currentPhoto().evaluate(img=>({
    sameNode:img===next15.progressiveNode,
    layout:{width:img.offsetWidth,height:img.offsetHeight},
    matrix:new DOMMatrix(getComputedStyle(img).transform).a
  }));
  assert.equal(originalState.sameNode,true,'preview->original replaced the gesture-owned image node');
  assert.equal(originalState.layout.width,previewState.layout.width,'photo layout width jumped on original swap');
  assert.equal(originalState.layout.height,previewState.layout.height,'photo layout height jumped on original swap');
  assert.ok(Math.abs(originalState.matrix-2)<0.03,'zoom was reset by original swap');

  const beforePan=await currentPhoto().evaluate(img=>new DOMMatrix(getComputedStyle(img).transform).e);
  await pointer('pointerdown',3,180,430);
  await pointer('pointermove',3,230,430);
  await pointer('pointerup',3,230,430);
  await tick();
  const afterPan=await currentPhoto().evaluate(img=>new DOMMatrix(getComputedStyle(img).transform).e);
  assert.notEqual(afterPan,beforePan,'pan stopped working after original swap');
  pass('original replaces preview on the same geometry/gesture node; pinch state survives and pan remains active');

  await page.locator('.media-viewer-close').click();
  await page.locator('[data-message-id="15002"] .media-tile').click();
  await page.waitForSelector('[data-slot="current"] img[data-fp-viewer-source="preview"]');
  await page.waitForFunction(()=>next15.pending.has('close'));
  await page.locator('.media-viewer-close').click();
  assert.equal((await snap()).viewer,null);
  await page.evaluate(()=>next15Resolve('close'));
  await page.waitForTimeout(220);
  assert.equal(await page.locator('.fp-gallery134').count(),0,'late original reopened a closed viewer');
  assert.equal((await snap()).pointer,null);
  pass('closing during original load prevents late media from mutating or reopening the viewer');

  await page.locator('[data-message-id="15004"] .media-tile').first().click();
  await page.waitForSelector('[data-slot="current"] img[data-fp-viewer-source="preview"]');
  await page.waitForFunction(()=>next15.pending.has('nav-a')&&next15.pending.has('nav-b'));
  await pointer('pointerdown',4,300,430);
  await pointer('pointermove',4,120,430);
  await pointer('pointerup',4,120,430);
  await page.waitForFunction(()=>mediaViewerState?.messageMedia?.[mediaViewerState.index]?.public_id==='next15-nav-b');
  await page.evaluate(()=>next15Resolve('nav-a'));
  await page.waitForTimeout(220);
  assert.equal((await snap()).viewer.key,'next15-nav-b','late previous original changed the navigated item');
  await page.evaluate(()=>next15Resolve('nav-b'));
  await page.waitForSelector('[data-slot="current"] img[data-fp-viewer-source="original"]');
  assert.equal((await snap()).viewer.key,'next15-nav-b');
  pass('navigation during load ignores the old slot result and completes the current destination');

  await page.locator('.media-viewer-close').click();
  await page.locator('[data-message-id="15003"] .media-tile').click();
  await page.waitForSelector('[data-slot="current"] img[data-fp-viewer-source="preview"]');
  await page.waitForFunction(()=>next15.pending.has('error'));
  const errorPreviewUrl=await currentPhoto().evaluate(img=>img.currentSrc||img.src);
  await page.evaluate(()=>next15Reject('error'));
  await page.waitForSelector('[data-slot="current"] .fp-gallery134-original-error');
  assert.equal(await currentPhoto().evaluate((img,url)=>(img.currentSrc||img.src)===url,errorPreviewUrl),true,
    'failed original removed the usable preview');
  await page.locator('[data-slot="current"] .fp-gallery134-original-error button').click();
  await page.waitForFunction(()=>next15.attempts.error===2&&next15.pending.has('error'));
  assert.equal(await currentPhoto().getAttribute('data-fp-viewer-source'),'preview');
  await page.evaluate(()=>next15Resolve('error'));
  await page.waitForSelector('[data-slot="current"] img[data-fp-viewer-source="original"]');
  await page.waitForSelector('[data-slot="current"] .fp-gallery134-original-error',{state:'detached'});
  pass('original failure keeps preview visible and retry reuses the existing owner/load path');

  const final=await snap();
  assert.ok(final.maxActiveBlob<=3,'item 15 introduced extra media fetch parallelism beyond existing current/neighbor slots');
  assert.equal(await page.evaluate(()=>next15.thumbCalls),thumbCallsBefore,'viewer introduced thumbnail I/O');
  assert.equal(final.layer,'viewer');
  await page.locator('.media-viewer-close').click();
  assert.equal((await snap()).pointer,null);
  assert.deepEqual(errors,[]);
  pass('media/layer/gesture owners remain active and no extra preview fetch path was introduced');

  console.log('PASS next15 progressive photo acceptance ('+passed+' groups)');
}).catch(error=>{console.error(error);process.exitCode=1;});
