'use strict';
const assert = require('node:assert/strict');
const {run} = require('./browser-harness174.cjs');

run(async ({newClient, errors}) => {
  let passed = 0;
  const pass = name => { passed++; console.log('PASS 190 ' + name); };
  const page = await newClient();
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(() => window.__fpMediaGallery134Installed);

  const fixture = await page.evaluate(async () => {
    const deviceId = getOrCreateDeviceId(), secret = 'media-190-fixture';
    const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
    const response = await fetch('/api/rooms', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})
    });
    if (!response.ok) throw Error('Build 190 fixture room creation failed');
    const data = await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId), {secret,deviceId});
    upsertChat(data.publicId, {});
    await openChat(data.publicId);

    window.media190 = {
      roomId:data.publicId,
      deviceId,
      items:[
        {public_id:'media190-a',media_kind:'image',mime_type:'image/svg+xml'},
        {public_id:'media190-video',media_kind:'video',mime_type:'video/mp4'},
        {public_id:'media190-b',media_kind:'image',mime_type:'image/svg+xml'}
      ]
    };
    const realRead = readEncryptedMedia174;
    readEncryptedMedia174 = async function(url, ...rest) {
      if (!url.includes('/api/media/media190-')) return realRead(url, ...rest);
      if (url.includes('video')) return new Blob(['not-a-real-video-frame'], {type:'video/mp4'});
      return new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#445"/></svg>'], {type:'image/svg+xml'});
    };
    window.pointer190 = (type,id,x,y,target) => {
      const node = target || document.querySelector('.fp-gallery134-stage');
      const event = new PointerEvent(type, {
        bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,
        button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,isPrimary:id===1
      });
      node.dispatchEvent(event);
      return {defaultPrevented:event.defaultPrevented};
    };
    window.snapshot190 = () => ({
      open:!!document.querySelector('.fp-gallery134'),
      key:mediaViewerState?.messageMedia?.[mediaViewerState?.index]?.public_id || null,
      index:mediaViewerState?.index ?? null,
      action:FPGesture135.snapshot().pointer?.action ?? null,
      track:document.querySelector('.fp-gallery134-track')?.style.transform || '',
      stage:document.querySelector('.fp-gallery134-stage')?.style.transform || ''
    });
    return {roomId:data.publicId,deviceId};
  });

  await page.route('**/api/rooms/*/messages?*', async route => {
    const items = await page.evaluate(() => media190.items);
    await route.fulfill({json:{ok:true,messages:[{id:190001,type:'media',media:items}],hasMore:false,nextCursor:null}});
  });

  const openVideo = async () => {
    await page.evaluate(() => openMediaViewer(media190.items, 1));
    await page.waitForSelector('[data-slot="current"] video');
    await page.waitForSelector('[data-slot="current"] .fp-gallery134-video-gesture190');
  };
  const pointerOnVideo = (type,id,x,y) => page.evaluate(({type,id,x,y}) => {
    const video = document.querySelector('[data-slot="current"] video');
    return pointer190(type,id,x,y,video);
  }, {type,id,x,y});
  const snap = () => page.evaluate(() => snapshot190());

  await openVideo();
  const tap = await page.evaluate(() => {
    const video = document.querySelector('[data-slot="current"] video');
    window.media190TapClicks = 0;
    video.addEventListener('click', () => media190TapClicks++);
    pointer190('pointerdown',1,195,420,video);
    const during = FPGesture135.snapshot().pointer?.action ?? null;
    pointer190('pointerup',1,195,420,video);
    const click = new MouseEvent('click',{bubbles:true,cancelable:true});
    const allowed = video.dispatchEvent(click);
    return {during,allowed,clicks:media190TapClicks,controls:video.controls,playsInline:video.playsInline};
  });
  assert.deepEqual(tap,{during:null,allowed:true,clicks:1,controls:true,playsInline:true});
  pass('stationary video tap stays native and does not claim FPGesture135');

  await pointerOnVideo('pointerdown',1,300,420);
  assert.equal((await snap()).action,null,'video must not claim on pointerdown');
  await pointerOnVideo('pointermove',1,120,420);
  let moved = await snap();
  assert.equal(moved.action,'viewer:interaction','horizontal video drag must claim existing viewer arbiter');
  assert.notEqual(moved.track,'translate3d(-100%,0,0)');
  await pointerOnVideo('pointerup',1,120,420);
  await page.waitForFunction(() => mediaViewerState?.messageMedia?.[mediaViewerState.index]?.public_id === 'media190-b');
  pass('horizontal swipe starting on video navigates to next media through gallery executor');

  await openVideo();
  await pointerOnVideo('pointerdown',1,195,360);
  await pointerOnVideo('pointermove',1,195,500);
  assert.equal((await snap()).action,'viewer:interaction');
  await pointerOnVideo('pointerup',1,195,500);
  await page.waitForSelector('.fp-gallery134',{state:'detached'});
  pass('downward swipe starting on video closes viewer');

  await openVideo();
  await pointerOnVideo('pointerdown',1,195,500);
  await pointerOnVideo('pointermove',1,195,350);
  await pointerOnVideo('pointerup',1,195,350);
  await page.waitForSelector('.fp-gallery134',{state:'detached'});
  pass('upward swipe starting on video closes viewer');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.evaluate(() => {
    window.media190NativeEvents=[];
    for (const type of ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel']) {
      window.addEventListener(type,event => {
        const touch=event.touches?.[0]||event.changedTouches?.[0];
        media190NativeEvents.push({
          type,target:event.target?.className||event.target?.tagName||'',
          x:event.clientX??touch?.clientX??null,y:event.clientY??touch?.clientY??null,
          pointerAction:FPGesture135.snapshot().pointer?.action??null,
          touchAction:FPGesture135.snapshot().touch?.action??null
        });
      },{capture:true,passive:true});
    }
  });
  const native = (type,points) => cdp.send('Input.dispatchTouchEvent',{
    type,
    touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:4,radiusY:4,force:1}))
  });
  await openVideo();
  const nativeSurface = async () => {
    const box=await page.locator('[data-slot="current"] .fp-gallery134-video-gesture190').boundingBox();
    assert.ok(box && box.width > 80 && box.height > 40,'video gesture surface must have usable geometry');
    return box;
  };
  let surface=await nativeSurface();
  const hy=surface.y+surface.height*0.45;
  const hx0=surface.x+surface.width*0.82,hx1=surface.x+surface.width*0.58,hx2=surface.x+surface.width*0.18;
  await native('touchStart',[[1,hx0,hy]]);
  await page.waitForTimeout(35);
  await native('touchMove',[[1,hx1,hy]]);
  await page.waitForTimeout(25);
  await native('touchMove',[[1,hx2,hy]]);
  await page.waitForTimeout(80);
  const nativeClaim=await page.evaluate(({x,y})=>({
    pointer:FPGesture135.snapshot().pointer,
    touch:FPGesture135.snapshot().touch,
    hit:(()=>{const n=document.elementFromPoint(x,y);return {tag:n?.tagName||'',cls:n?.className||''};})(),
    events:media190NativeEvents
  }),{x:hx2,y:hy});
  if(nativeClaim.pointer?.action!=='viewer:interaction')console.log('Build 190 picture-surface diagnostic',JSON.stringify(nativeClaim));
  assert.equal(nativeClaim.pointer?.action,'viewer:interaction','native picture drag must claim viewer pointer session');
  await page.waitForTimeout(25);
  await native('touchEnd',[]);
  await page.waitForTimeout(320);
  const nativeAfterEnd=await page.evaluate(()=>({
    key:mediaViewerState?.messageMedia?.[mediaViewerState.index]?.public_id||null,
    pointer:FPGesture135.snapshot().pointer,
    touch:FPGesture135.snapshot().touch,
    events:media190NativeEvents
  }));
  if(nativeAfterEnd.key!=='media190-b')console.log('Build 190 picture-surface end diagnostic',JSON.stringify(nativeAfterEnd));
  assert.equal(nativeAfterEnd.key,'media190-b','native horizontal video drag did not navigate after touch end');
  pass('native touch horizontal drag on video picture reaches existing viewer arbiter');

  await openVideo();
  surface=await nativeSurface();
  const vx=surface.x+surface.width*0.5;
  const vy0=surface.y+surface.height*0.2,vy1=surface.y+surface.height*0.5,vy2=surface.y+surface.height*0.85;
  await native('touchStart',[[1,vx,vy0]]);
  await page.waitForTimeout(35);
  await native('touchMove',[[1,vx,vy1]]);
  await page.waitForTimeout(25);
  await native('touchMove',[[1,vx,vy2]]);
  await page.waitForFunction(() => FPGesture135.snapshot().pointer?.action === 'viewer:interaction');
  await page.waitForTimeout(25);
  await native('touchEnd',[]);
  await page.waitForSelector('.fp-gallery134',{state:'detached'});
  pass('native touch vertical drag on video picture dismisses viewer');

  // The chat thumbnail path must recover both a missing primary thumb and a
  // primary URL that decodes as an invalid image. Fallback is deliberately
  // lazy and runs only for video.
  const fallback = await page.evaluate(async () => {
    const originalPrimary = fetchMediaThumbUrl;
    const originalFallback = fetchVideoFallbackThumbUrl;
    window.media190Thumb = {primary:0,fallback:0};
    const validUrl = async () => {
      const c=document.createElement('canvas');c.width=64;c.height=36;
      c.getContext('2d').fillRect(0,0,64,36);
      const blob=await new Promise(resolve=>c.toBlob(resolve,'image/webp',0.8));
      return URL.createObjectURL(blob);
    };
    fetchVideoFallbackThumbUrl = async () => { media190Thumb.fallback++; return validUrl(); };
    const append = id => appendMessage(document.getElementById('messages'), {
      id, type:'media', status:'read', sender_device_id:media190.deviceId,
      sender_name:'Fixture', created_at:new Date().toISOString(),
      media:[{public_id:'broken-thumb-'+id,media_kind:'video',mime_type:'video/mp4'}]
    },'',true,false);

    fetchMediaThumbUrl = async () => { media190Thumb.primary++; return ''; };
    append(190101);
    await new Promise(resolve => {
      const img=document.querySelector('[data-message-id="190101"] .media-thumb');
      if(img?.complete&&img.naturalWidth) return resolve();
      img?.addEventListener('load',resolve,{once:true});
    });
    const missingRecovered = document.querySelector('[data-message-id="190101"] .media-thumb')?.naturalWidth > 0;

    fetchMediaThumbUrl = async () => {
      media190Thumb.primary++;
      return URL.createObjectURL(new Blob(['broken-webp'],{type:'image/webp'}));
    };
    append(190102);
    await new Promise((resolve,reject) => {
      const deadline=Date.now()+3000;
      const poll=()=> {
        const img=document.querySelector('[data-message-id="190102"] .media-thumb');
        if(img?.naturalWidth>0) return resolve();
        if(Date.now()>deadline) return reject(new Error('decode-error fallback timeout'));
        setTimeout(poll,20);
      };
      poll();
    });
    const decodeRecovered = document.querySelector('[data-message-id="190102"] .media-thumb')?.naturalWidth > 0;
    const calls={...media190Thumb};
    fetchMediaThumbUrl = originalPrimary;
    fetchVideoFallbackThumbUrl = originalFallback;
    return {missingRecovered,decodeRecovered,calls};
  });
  assert.equal(fallback.missingRecovered,true);
  assert.equal(fallback.decodeRecovered,true);
  assert.deepEqual(fallback.calls,{primary:2,fallback:2});
  pass('missing or undecodable video thumb falls back once to the original video path');

  const zeroThumbStatus = await page.evaluate(async ({roomId,deviceId}) => {
    const fd=new FormData();
    fd.append('deviceId',deviceId);
    fd.append('mimeType','video/mp4');
    fd.append('mediaKind','video');
    fd.append('sizeBytes','1');
    fd.append('encryptedSizeBytes','40');
    fd.append('thumbSizeBytes','0');
    fd.append('thumbEncryptedSizeBytes','28');
    fd.append('fileOrder','0');
    fd.append('encryptedFile',new Blob([new Uint8Array(40)]),'file.bin');
    fd.append('encryptedThumbnail',new Blob([new Uint8Array(28)]),'thumb.bin');
    const response=await fetch('/api/rooms/'+encodeURIComponent(roomId)+'/media/upload',{method:'POST',body:fd});
    return {status:response.status,body:await response.json().catch(()=>({}))};
  }, fixture);
  assert.equal(zeroThumbStatus.status,400);
  assert.equal(zeroThumbStatus.body.error,'thumbnail invalid');
  pass('server rejects a zero-plaintext encrypted thumbnail invariant violation');

  assert.deepEqual(errors,[]);
  console.log(`Build 190 media swipe/preview browser acceptance PASS (${passed} groups)`);
}).catch(error => { console.error(error); process.exitCode = 1; });
