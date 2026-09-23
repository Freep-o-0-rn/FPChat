'use strict';
// Real application + isolated DB; synthetic touch for boundary/cancel cases,
// and Chromium input dispatch for native scroll/horizontal-drag checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {run} = require('./browser-harness174.cjs');

run(async ({newClient, errors}) => {
  let passed = 0;
  const pass = name => { passed++; console.log(`PASS 184 ${name}`); };
  async function setup(page) {
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(async () => {
      const deviceId = getOrCreateDeviceId(), secret = 'reply-visual184-test';
      const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
      const response = await fetch('/api/rooms', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})});
      if (!response.ok) throw Error('Fixture room creation failed');
      const data = await response.json();
      STORAGE.set(STORAGE.roomState(data.publicId), {secret,deviceId});
      upsertChat(data.publicId, {});
      await openChat(data.publicId);
      window.reply184 = {room:data.publicId, calls:[], pulses:0};
      const originalReply = setSelectedReply;
      setSelectedReply = function(...args) { reply184.calls.push(args); return originalReply.apply(this,args); };
      document.addEventListener('animationstart', event => {
        if (event.animationName === 'fp-reply-ripple184') reply184.pulses++;
      });
      window.touch184 = (target, type, x=300, y=350, count=1) => {
        const touch = {identifier:184,target,clientX:x,clientY:y};
        const event = new Event(type, {bubbles:true,cancelable:true});
        const ended = type === 'touchend' || type === 'touchcancel';
        Object.defineProperties(event, {touches:{value:ended?[]:Array.from({length:count},()=>touch)},changedTouches:{value:[touch]}});
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      // These fixtures exercise media gesture targets; uploads/playback are not
      // part of this suite. Avoid a request for a deliberately nonexistent thumb.
      fetchMediaThumbUrl = async () => '';
      window.addRow184 = (id, text, options={}) => appendMessage(document.getElementById('messages'), {
        id,type:'text',status:'read',created_at:new Date().toISOString(),
        sender_device_id:options.mine?deviceId:'remote-184',sender_name:options.mine?'Вы':'Собеседник',
        ...options
      }, text, Boolean(options.mine), false);
      for (let i=0;i<30;i++) addRow184(184100+i, `Сообщение ${i}`);
      window.row184 = addRow184(184001, 'Проведи влево, чтобы ответить');
      window.mine184 = addRow184(184002, 'Исходящее сообщение', {mine:true});
      window.long184 = addRow184(184003, 'Длинное сообщение. '.repeat(65));
      window.quote184 = addRow184(184004, 'Ответ на сообщение', {reply_to_message_id:184001});
      window.photo184 = addRow184(184005, 'Фото', {type:'media',media:[{public_id:'fixture-photo',media_kind:'image',mime_type:'image/png'}]});
      window.video184 = addRow184(184006, 'Видео', {type:'media',media:[{public_id:'fixture-video',media_kind:'video',mime_type:'video/mp4'}]});
    });
    await page.waitForFunction(() => document.getElementById('messages')?.dataset.scrollPhase !== 'opening');
    await page.evaluate(() => { row184.scrollIntoView({block:'center'}); });
    await page.waitForTimeout(200);
  }
  const page = await newClient();
  await setup(page);
  const touch = (type,dx=0,dy=0,count=1) => page.evaluate(({type,dx,dy,count}) => touch184(row184,type,300+dx,350+dy,count), {type,dx,dy,count});
  const snap = () => page.evaluate(() => {
    const root = row184.querySelector('.fp-reply-indicator');
    const circle = root?.querySelector('.fp-reply-circle');
    return {
      state:root?.dataset.state||'absent', opacity:root?Number(getComputedStyle(root).opacity):0,
      size:circle?.getBoundingClientRect().width||0, svg:Boolean(root?.querySelector('svg')),
      calls:reply184.calls.length, pulses:reply184.pulses,
      transform:row184.querySelector('.bubble').style.transform,
      scrollTop:document.getElementById('messages').scrollTop,
      scrollHeight:document.getElementById('messages').scrollHeight,
      layer:FPGesture135.snapshot().touch?.layer
    };
  });
  const shot = async name => {
    if (!process.env.FPCHAT_ARTIFACT_DIR) return;
    fs.mkdirSync(process.env.FPCHAT_ARTIFACT_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.FPCHAT_ARTIFACT_DIR, `${name}.png`)});
  };
  assert.equal((await snap()).state, 'absent');
  await touch('touchstart');
  assert.equal((await snap()).state, 'absent');
  const geometry = await snap();
  await touch('touchmove', -5);
  let s = await snap();
  assert.equal(s.state,'dot');
  assert.ok(Math.abs(s.size-8)<0.1);
  assert.ok(Math.abs(s.opacity-0.5)<0.01);
  await shot('reply184-dot');
  await touch('touchmove',-30);
  s = await snap();
  assert.equal(s.state,'growing');
  assert.ok(s.size>8 && s.size<36);
  assert.ok(s.svg);
  await shot('reply184-growing');
  await touch('touchmove',-51);
  assert.equal((await snap()).state,'growing');
  await touch('touchmove',-52);
  await page.waitForTimeout(50);
  s = await snap();
  assert.equal(s.state,'armed');
  assert.ok(Math.abs(s.size-36)<0.1);
  assert.equal(s.calls,0,'reply executed before release');
  assert.equal(s.pulses,1);
  await shot('reply184-armed');
  for (const dx of [-90,-150,-200,-20,0,-80]) await touch('touchmove',dx);
  await page.waitForTimeout(270);
  s = await snap();
  assert.equal(s.pulses,1,'ripple repeated during hold/retreat/re-arm');
  assert.equal(s.scrollTop,geometry.scrollTop);
  assert.equal(s.scrollHeight,geometry.scrollHeight);
  await touch('touchend',-80);
  assert.equal((await snap()).calls,1);
  assert.equal(await page.evaluate(()=>ensureDraftState(state.roomId).replyTo?.messageId),184001);
  pass('lazy DOM, 8→36px growth, SVG, exact 52px boundary, one pulse and one reply');
  pass('hold/retreat/re-arm does not repeat ripple or alter scroll geometry');

  await page.waitForTimeout(200);
  await touch('touchstart');
  await touch('touchmove',-30);
  const draft = await page.evaluate(()=>JSON.stringify(ensureDraftState(state.roomId).replyTo));
  await touch('touchend',-30);
  assert.equal((await snap()).state,'cancel');
  await page.waitForTimeout(180);
  s = await snap();
  assert.equal(s.opacity,0);
  assert.equal(s.calls,1);
  assert.equal(s.pulses,1);
  assert.equal(await page.evaluate(()=>JSON.stringify(ensureDraftState(state.roomId).replyTo)),draft);
  pass('short swipe collapses without ripple, reply or draft changes');

  await touch('touchstart');
  await touch('touchmove',-70);
  await page.waitForTimeout(40);
  assert.equal((await snap()).pulses,2,'new gesture did not get a fresh pulse');
  await touch('touchmove',-20);
  await touch('touchend',-20);
  assert.equal((await snap()).calls,1);
  pass('retreat below threshold cancels reply; next gesture gets its own pulse');

  for (const mode of ['touchcancel','vertical','multitouch','right']) {
    await touch('touchstart');
    await touch('touchmove',-70);
    if (mode==='touchcancel') await touch('touchcancel',-70);
    if (mode==='vertical') { assert.equal(await touch('touchmove',-20,100),false); await touch('touchend',-20,100); }
    if (mode==='multitouch') { await touch('touchstart',-70,0,2); await touch('touchend',-70); }
    if (mode==='right') { await touch('touchmove',20); assert.equal((await snap()).opacity,0); await touch('touchend',20); }
    assert.equal((await snap()).calls,1,`${mode} executed reply`);
    assert.equal((await snap()).transform,'');
    pass(`${mode} clears indicator and leaves reply untouched`);
  }

  for (const layer of ['selection','context','voice','viewer']) {
    await page.evaluate(layer => { window.releaseLayer184=FPLayer173.claim(layer,'reply184-test'); },layer);
    await touch('touchstart'); await touch('touchmove',-80); await touch('touchend',-80);
    assert.equal((await snap()).opacity,0);
    assert.equal((await snap()).calls,1);
    await page.evaluate(()=>releaseLayer184());
    await touch('touchstart'); await touch('touchmove',-70);
    await page.evaluate(layer => { window.releaseLayer184=FPLayer173.claim(layer,'reply184-test'); },layer);
    assert.equal((await snap()).opacity,0,'layer did not cancel immediately');
    await page.evaluate(()=>releaseLayer184());
    await touch('touchmove',-80); await touch('touchend',-80);
    assert.equal((await snap()).calls,1,'lower gesture revived after upper layer closed');
    pass(`${layer} blocks new and active swipe through the existing arbiter`);
  }

  // Actual voice target classification (no microphone permission is required).
  await page.evaluate(()=>{
    const wave=document.createElement('div');wave.className='fp-voice-waveform';row184.querySelector('.bubble').appendChild(wave);
    touch184(wave,'touchstart');touch184(wave,'touchmove',220);touch184(wave,'touchend',220);wave.remove();
  });
  assert.equal((await snap()).calls,1);
  pass('voice waveform owns its target and does not start reply');

  for (const target of ['mine184','long184','quote184','photo184','video184']) {
    const before = (await snap()).calls;
    await page.evaluate(target => {
      const row=window[target];
      const el=row.querySelector('.media-tile,.reply-block')||row;
      touch184(el,'touchstart');touch184(el,'touchmove',230);touch184(el,'touchend',230);
    },target);
    assert.equal((await snap()).calls,before+1);
    const replyId = await page.evaluate(()=>ensureDraftState(state.roomId).replyTo?.messageId);
    assert.equal(replyId,await page.evaluate(target=>Number(window[target].dataset.messageId),target));
    pass(`${target}: existing handler selects the correct reply target`);
  }

  await page.emulateMedia({reducedMotion:'reduce'});
  for (const theme of ['light','dark']) {
    await page.evaluate(theme=>{applyTheme(theme);row184.scrollIntoView({block:'center'});},theme);
    await touch('touchstart');await touch('touchmove',-70);
    const style = await page.evaluate(()=>{
      const root=row184.querySelector('.fp-reply-indicator');
      return {fill:getComputedStyle(root.querySelector('path')).fill,bg:getComputedStyle(root.querySelector('.fp-reply-circle')).backgroundColor,animation:getComputedStyle(root.querySelector('.fp-reply-ripple')).animationName};
    });
    assert.equal(style.fill,'rgb(255, 255, 255)');
    assert.notEqual(style.bg,'rgba(0, 0, 0, 0)');
    assert.equal(style.animation,'none');
    await shot(`reply184-${theme}-reduced-motion`);
    await touch('touchcancel');
  }
  pass('light/dark theme and reduced-motion keep a readable armed indicator');
  await page.emulateMedia({reducedMotion:'no-preference'});

  let before = (await snap()).calls;
  await touch('touchstart');await touch('touchmove',-70);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal((await snap()).opacity,0);
  await touch('touchend',-70);
  assert.equal((await snap()).calls,before);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  pass('blur cancels the active gesture without a late reply');

  await touch('touchstart');await touch('touchmove',-70);
  await page.evaluate(()=>row184.remove());
  await touch('touchend',-70);
  assert.equal((await snap()).calls,before);
  await page.evaluate(()=>document.getElementById('messages').appendChild(row184));
  pass('removed message cannot reply on delayed touchend');

  // Trusted Chromium touch input: vertical motion scrolls, horizontal drag does
  // not change scrollTop. This still cannot replace physical Safari testing.
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.evaluate(()=>{
    document.getElementById('msgInput')?.blur();
    const box=document.getElementById('messages');
    box.scrollTop=300;
  });
  await page.waitForTimeout(200);
  const startScroll=await page.evaluate(()=>document.getElementById('messages').scrollTop);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:500}]});
  for(let y=480;y>=340;y-=20) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:150,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(before=>document.getElementById('messages').scrollTop>before,startScroll),'native vertical scrolling was blocked');
  assert.equal((await snap()).calls,before);
  pass('trusted Chromium vertical touch scrolls without reply');

  await page.evaluate(()=>row184.scrollIntoView({block:'center'}));
  await page.waitForTimeout(300);
  const point=await page.evaluate(()=>{const r=row184.querySelector('.bubble').getBoundingClientRect();return {x:Math.min(r.right-10,250),y:r.top+r.height/2,scroll:document.getElementById('messages').scrollTop};});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});
  for(const dx of [10,30,52,75]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x-dx,y:point.y}]});
  assert.equal((await snap()).state,'armed');
  assert.equal((await snap()).scrollTop,point.scroll);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal((await snap()).calls,before+1);
  pass('trusted Chromium horizontal touch arms and replies without scrolling');
  await cdp.detach();

  // Real room replacement aborts the captured context before the old finger ends.
  before=(await snap()).calls;
  await touch('touchstart');await touch('touchmove',-70);
  await page.evaluate(()=>showChatsList());
  await page.evaluate(()=>touch184(row184,'touchend',230));
  assert.equal(await page.evaluate(()=>reply184.calls.length),before);
  assert.equal(await page.evaluate(()=>row184.querySelector('.fp-reply-indicator').dataset.state),'hidden');
  pass('leaving room aborts visual and prevents late reply in another view');

  for (const asset of ['js','css']) {
    const fallback=await newClient(async p=>{
      await p.route(`**/reply-swipe-visual184.${asset}*`,route=>route.abort());
    });
    await setup(fallback);
    assert.equal(await fallback.evaluate(()=>window.FPReplySwipeVisual184),null);
    await fallback.evaluate(()=>{touch184(row184,'touchstart');touch184(row184,'touchmove',230);});
    assert.equal(await fallback.evaluate(()=>row184.querySelector('.swipe-reply-icon').style.opacity),'1');
    await fallback.evaluate(()=>touch184(row184,'touchend',230));
    assert.equal(await fallback.evaluate(()=>reply184.calls.length),1);
    await fallback.close();
    pass(`failed optional ${asset} asset preserves startup and legacy reply`);
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS ${passed} Build 184 browser scenarios; physical iPhone/Android acceptance remains pending`);
}).catch(error=>{console.error(error);process.exitCode=1;});
