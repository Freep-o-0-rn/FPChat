'use strict';
const assert = require('node:assert/strict');
const {run} = require('./browser-harness174.cjs');

run(async ({newClient, errors}) => {
  let passed = 0;
  const pass = name => { passed++; console.log(`PASS 185 ${name}`); };
  const page = await newClient();
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(() => window.__fpMediaGallery134Installed);
  await page.evaluate(async () => {
    const deviceId = getOrCreateDeviceId(), secret = 'photo-zoom185-fixture';
    const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
    const response = await fetch('/api/rooms', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})});
    if (!response.ok) throw Error('Fixture room creation failed');
    const data = await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId), {secret,deviceId});
    upsertChat(data.publicId, {});
    await openChat(data.publicId);
    window.zoom185 = {loads:0,room:data.publicId,deviceId};
    const realRead = readEncryptedMedia174;
    readEncryptedMedia174 = async function(url, ...rest) {
      if (!url.includes('/api/media/zoom185-')) return realRead(url,...rest);
      zoom185.loads++;
      if (url.includes('delayed')) await new Promise(resolve => {zoom185.resolveAsset = resolve;});
      return new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960"><rect width="1280" height="960" fill="#274c77"/><path d="M640 0V960M0 480H1280" stroke="#ffffff" stroke-width="8"/></svg>'],{type:'image/svg+xml'});
    };
    zoom185.items = ['a','b','c'].map(id=>({public_id:`zoom185-${id}`,media_kind:'image',mime_type:'image/svg+xml'}));
    window.pointer185 = (type,id,x,y,target) => {
      const node = target || document.querySelector('.fp-gallery134-stage');
      const ev = new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,isPrimary:id===1});
      node.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    window.snapshot185 = () => {
      const img = document.querySelector('[data-slot="current"] img');
      const matrix = img ? new DOMMatrix(getComputedStyle(img).transform) : new DOMMatrix();
      return {scale:matrix.a,x:matrix.e,y:matrix.f,image:!!img,width:img?.offsetWidth,height:img?.offsetHeight,
        index:mediaViewerState?.index,key:mediaViewerState?.messageMedia[mediaViewerState.index]?.public_id,
        open:!!document.querySelector('.fp-gallery134'),loads:zoom185.loads,
        pointer:FPGesture135.snapshot().pointer,top:FPLayer173.topLayer(),
        track:document.querySelector('.fp-gallery134-track')?.style.transform,
        stage:document.querySelector('.fp-gallery134-stage')?.style.transform,
        scroll:document.getElementById('messages')?.scrollTop};
    };
  });
  // Hold the real gallery hydration response until fingers are down.
  let completeHydration;
  let hydrationRequested = false;
  // Background voice/history reads may share this route. Release all held
  // replies together; a later request must not overwrite the gallery resolver.
  const hydrationGate = new Promise(resolve => {completeHydration = resolve;});
  await page.route('**/api/rooms/*/messages?*', async route => {
    hydrationRequested = true;
    await hydrationGate;
    const items = await page.evaluate(()=>[{public_id:'zoom185-prefix',media_kind:'image',mime_type:'image/svg+xml'},...zoom185.items]);
    await route.fulfill({json:{messages:[{id:185,media:items}],hasMore:false,nextCursor:null}});
  });
  await page.evaluate(()=>openMediaViewer(zoom185.items,0));
  await page.waitForFunction(()=>document.querySelector('[data-slot="current"] img')?.style.transform.includes('scale(1)'));
  // Pinch starts after the initial responsive layout has settled. Resize
  // during an active gesture is tested separately and must cancel that gesture.
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const tick = () => page.evaluate(()=>new Promise(requestAnimationFrame));
  const pointer = (type,id,x,y) => page.evaluate(({type,id,x,y})=>pointer185(type,id,x,y),{type,id,x,y});
  const snap = () => page.evaluate(()=>snapshot185());
  const near = (a,b,msg) => assert.ok(Math.abs(a-b)<0.02,`${msg}: ${a} != ${b}`);
  const close = async () => {await page.locator('.media-viewer-close').click(); await tick();};
  const open = async (index=0, items=null) => {
    await page.evaluate(({index,items})=>openMediaViewer(items||zoom185.items,index),{index,items});
    await page.waitForFunction(()=>document.querySelector('[data-slot="current"] img')?.style.transform.includes('scale(1)'));
  };
  let baseline = await snap();
  await pointer('pointerdown',1,130,430);
  const session = (await snap()).pointer.id;
  await pointer('pointerdown',2,230,430);
  assert.equal((await snap()).pointer.id,session,'second finger restarted the arbiter');
  await page.evaluate(()=>{zoom185.node = document.querySelector('[data-slot="current"] img');});
  assert.ok(hydrationRequested,'gallery hydration was not requested');
  completeHydration();
  await page.waitForFunction(()=>mediaViewerState.messageMedia.length===4);
  await page.unroute('**/api/rooms/*/messages?*');
  assert.equal(await page.evaluate(()=>zoom185.node===document.querySelector('[data-slot="current"] img')),true);
  await pointer('pointermove',1,80,430);
  await pointer('pointermove',2,280,430);
  await tick();
  let s = await snap();
  if (s.scale !== 2) console.log('Zoom start diagnostic', JSON.stringify({baseline,current:s,arbiter:await page.evaluate(()=>FPGesture135.snapshot())}));
  near(s.scale,2,'pinch scale');
  near(s.x,15,'pinch focal point');
  assert.equal(s.index,1);
  assert.equal(s.scroll,baseline.scroll);
  assert.equal(s.pointer.action,'viewer:interaction');
  pass('one arbiter session; 2x focal zoom; real gallery hydration preserves the touched node and current photo');

  await pointer('pointerup',1,80,430);
  assert.equal((await snap()).pointer.pointers,1);
  await pointer('pointermove',2,300,430);
  await tick();
  near((await snap()).x,35,'2→1 pan continuity');
  await pointer('pointerup',2,300,430);
  await page.waitForFunction(()=>document.querySelector('[data-slot="current"] img')?.style.transform.includes('scale(2)'));
  s = await snap();
  near(s.x,35,'zoom survives deferred render');
  assert.equal(s.pointer,null);
  pass('2→1→0 finishes once and restores zoom after deferred render');

  const initialLoads = s.loads;
  await pointer('pointerdown',1,180,430);
  await pointer('pointermove',1,1000,1500);
  await pointer('pointerup',1,1000,1500);
  await tick();
  s = await snap();
  near(s.x,195,'horizontal clamp');
  assert.equal(s.key,'zoom185-a');
  assert.equal(s.loads,initialLoads,'pan requested another media load');
  assert.ok(s.open);
  pass('pan clamps at the image edge without navigation, closing or media I/O');

  // Reset via pinch; the remaining finger must never turn into a dismiss.
  await pointer('pointerdown',1,95,430); await pointer('pointerdown',2,295,430);
  await pointer('pointermove',1,170,430); await pointer('pointermove',2,220,430);
  await tick(); near((await snap()).scale,1,'minimum zoom');
  await pointer('pointerup',1,170,430); await pointer('pointermove',2,220,750); await pointer('pointerup',2,220,750);
  assert.ok((await snap()).open);
  await pointer('pointerdown',1,300,430); await pointer('pointermove',1,140,430); await pointer('pointerup',1,140,430);
  await page.waitForFunction(()=>mediaViewerState?.messageMedia[mediaViewerState.index]?.public_id==='zoom185-b');
  await page.waitForFunction(()=>document.querySelector('[data-slot="current"] img')?.style.transform.includes('scale(1)'));
  pass('return to 1x drains remaining fingers; the next new swipe navigates once and resets the next photo');

  // Convert both existing swipe axes into pinch before the commit.
  for (const axis of ['horizontal','vertical']) {
    await pointer('pointerdown',1,130,430);
    await pointer('pointermove',1,axis==='horizontal'?180:130,axis==='vertical'?480:430);
    await pointer('pointerdown',2,280,430);
    await pointer('pointerup',2,280,430); await pointer('pointerup',1,180,480);
    await tick();
    s=await snap(); assert.equal(s.key,'zoom185-b'); assert.ok(s.open); assert.equal(s.stage,'');
  }
  pass('second finger cancels an uncommitted horizontal or vertical swipe');

  await pointer('pointerdown',1,130,430); await pointer('pointerdown',2,230,430);
  await pointer('pointermove',1,30,430); await pointer('pointermove',2,330,430);
  await tick(); const triple = await snap();
  await pointer('pointerdown',3,195,530); await pointer('pointermove',3,350,700); await tick();
  near((await snap()).scale,triple.scale,'third finger must not change zoom');
  await pointer('pointerup',1,30,430); await tick(); near((await snap()).scale,triple.scale,'pair replacement must rebase');
  await pointer('pointermove',2,5,100); await pointer('pointermove',3,380,790); await tick();
  near((await snap()).scale,4,'maximum zoom');
  await pointer('pointercancel',2,5,100); await pointer('pointerup',3,380,790);
  await tick(); assert.equal((await snap()).pointer,null); assert.ok((await snap()).open);
  pass('third contact, pair replacement, 4x cap and pointercancel leave no stuck lease');

  await pointer('pointerdown',1,180,430); await pointer('pointermove',1,210,430);
  await page.evaluate(()=>pointer185('lostpointercapture',1,210,430));
  await pointer('pointerup',1,210,430); await tick(); assert.equal((await snap()).pointer,null);
  pass('unexpected capture loss cancels movement without navigation');

  const beforeResize = await snap();
  await page.setViewportSize({width:844,height:390}); await page.waitForTimeout(60);
  s=await snap(); near(s.scale,beforeResize.scale,'orientation keeps zoom');
  assert.ok(Number.isFinite(s.x)&&Number.isFinite(s.y));
  assert.ok(Math.abs(s.x)<=(s.width*s.scale-844)/2+1 || s.x===0);
  await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(60);
  pass('viewport resize remeasures untransformed geometry and clamps zoom');

  await pointer('pointerdown',1,130,430); await pointer('pointerdown',2,230,430);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await pointer('pointerup',1,130,430); await pointer('pointerup',2,230,430);
  assert.equal((await snap()).pointer,null);
  await page.evaluate(()=>window.dispatchEvent(new Event('pageshow'))); await tick();
  assert.ok((await snap()).open);
  pass('background/foreground clears the gesture and retains static zoom');

  await pointer('pointerdown',1,130,430); await pointer('pointerdown',2,230,430);
  await close();
  await page.evaluate(()=>{pointer185('pointermove',1,10,430,document.body);});
  assert.equal(await page.evaluate(()=>FPGesture135.canNavigate('chat',document.body,{type:'pointermove'})),false);
  await page.evaluate(()=>{pointer185('pointerup',1,10,430,document.body); pointer185('pointerup',2,230,430,document.body);});
  assert.equal((await snap()).pointer,null);
  await open();
  await page.evaluate(()=>{zoom185.prior = mediaViewerState;});
  await open(1);
  assert.equal(await page.evaluate(()=>FPMediaManager177.closeViewer(zoom185.prior,()=>{throw Error('stale worker ran');})),false);
  assert.ok((await snap()).open);
  pass('close drains fingers; stale viewer close cannot destroy its replacement');

  const counts = await page.evaluate(()=>FPDOM173.snapshot().listenerGroups);
  for(let i=0;i<5;i++){await close();await open(i%2);}
  assert.equal(await page.evaluate(()=>FPDOM173.snapshot().listenerGroups),counts);
  assert.equal((await snap()).pointer,null);
  pass('repeated open/close keeps DOM lifecycle subscriptions bounded');

  // Native Chromium multi-touch exercises capture, browser event ordering and Touch Events guard together.
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const native = (type,points) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:4,radiusY:4,force:1}))});
  await native('touchStart',[[1,130,430]]); await native('touchStart',[[1,130,430],[2,230,430]]);
  await native('touchMove',[[1,80,430],[2,280,430]]); await tick();
  near((await snap()).scale,2,'native pinch');
  await native('touchEnd',[[2,280,430]]); await native('touchMove',[[2,300,430]]); await native('touchEnd',[]); await tick();
  assert.equal((await snap()).pointer,null); assert.ok((await snap()).open);
  pass('native Chromium 2→1→0 touch input works with capture and compatibility touch events');

  await close();
  // A late media result must not mount into a replacement viewer.
  await page.evaluate(()=>openMediaViewer([{public_id:'zoom185-delayed',media_kind:'image',mime_type:'image/svg+xml'}],0));
  await page.waitForFunction(()=>typeof zoom185.resolveAsset==='function');
  await open(0);
  await page.evaluate(()=>zoom185.resolveAsset()); await tick();
  assert.equal((await snap()).key,'zoom185-a'); near((await snap()).scale,1,'late A affected B');
  pass('late image load after viewer replacement cannot attach to the new photo');

  await close();
  await page.evaluate(()=>{zoom185.resolveAsset=null;openMediaViewer([{public_id:'zoom185-delayed-close',media_kind:'image',mime_type:'image/svg+xml'}],0);});
  await page.waitForFunction(()=>typeof zoom185.resolveAsset==='function');
  await pointer('pointerdown',1,180,430); await pointer('pointermove',1,180,550); await pointer('pointerup',1,180,550);
  await page.evaluate(()=>zoom185.resolveAsset());
  await page.waitForTimeout(250);
  assert.equal((await snap()).open,false,'image arriving during committed dismiss cancelled closing');
  pass('late image readiness cannot cancel an already committed dismiss animation');
  await open();
  await pointer('pointerdown',1,130,430); await pointer('pointerdown',2,230,430);
  await page.evaluate(()=>FPMediaManager177.closeViewer(mediaViewerState,()=>{
    mediaViewerState=null;document.getElementById('mediaViewerRoot').replaceChildren();return true;
  }));
  await page.evaluate(()=>{pointer185('pointerup',1,130,430,document.body);pointer185('pointerup',2,230,430,document.body);});
  assert.equal((await snap()).pointer,null);
  assert.equal(await page.evaluate(()=>FPMediaManager177.currentViewer()),null);
  pass('alternate MediaManager close worker releases the gesture even without calling the gallery renderer');
  await open();

  // Native video controls keep their pointer stream; gallery claims none on video.
  await close();
  await page.evaluate(()=>openMediaViewer([{public_id:'zoom185-video',media_kind:'video',mime_type:'video/mp4'}],0));
  await page.waitForSelector('[data-slot="current"] video');
  await page.evaluate(()=>{const v=document.querySelector('[data-slot="current"] video');pointer185('pointerdown',9,180,430,v);});
  assert.equal((await snap()).pointer.action,null);
  await page.evaluate(()=>{const v=document.querySelector('[data-slot="current"] video');pointer185('pointerup',9,180,430,v);});
  assert.equal(await page.locator('[data-slot="current"] video').evaluate(v=>v.controls&&v.playsInline),true);
  pass('video targets bypass photo gesture capture and retain native controls (playback requires device acceptance)');
  await close();
  assert.deepEqual(errors,[]);
  console.log(`PASS 185 photo zoom browser acceptance (${passed} groups)`);
}).catch(error=>{console.error(error);process.exitCode=1;});
