'use strict';
const assert = require('node:assert/strict');
const {run} = require('./browser-harness174.cjs');

run(async ({newClient, errors}) => {
  let passed = 0;
  const pass = name => { passed++; console.log('PASS 186.2 ' + name); };
  const page = await newClient();
  const report = () => page.evaluate(() => FPRuntime169.loading.report());
  const fixtures = await page.evaluate(async () => {
    const deviceId = getOrCreateDeviceId(), secret = 'private-cache-test-1862';
    const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
    const response = await fetch('/api/rooms', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({displayName:state.nick, deviceId, roomSecret:secret, ...recovery})});
    if (!response.ok) throw Error('Fixture room creation failed');
    const data = await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId), {secret, deviceId});
    upsertChat(data.publicId, {}); await openChat(data.publicId);
    const canvas = document.createElement('canvas'); canvas.width=80; canvas.height=60;
    canvas.getContext('2d').fillRect(0,0,80,60);
    const image = await new Promise(resolve => canvas.toBlob(resolve,'image/webp'));
    // Three seconds of valid silent PCM: test real playback after the render-only fix.
    const wav = new ArrayBuffer(44+48000), view = new DataView(wav);
    const word = (offset, value) => [...value].forEach((c,i) => view.setUint8(offset+i,c.charCodeAt(0)));
    word(0,'RIFF'); view.setUint32(4,48036,true); word(8,'WAVE'); word(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,8000,true); view.setUint32(28,16000,true);
    view.setUint16(32,2,true); view.setUint16(34,16,true); word(36,'data'); view.setUint32(40,48000,true);
    const text = await encryptText('',state.key);
    window.fixture1862 = {deviceId, roomId:data.publicId, messages:Array.from({length:100},(_,i) => ({
      id:1862000+i, type:i<58?'media':'text', status:'read', ...text,
      sender_device_id:deviceId, sender_name:'Fixture', created_at:new Date(Date.UTC(2026,8,1)+i*60000).toISOString(),
      media:i<58?[{public_id:'audit1862-'+(i<52?'audio-':'image-')+i, media_kind:i<52?'audio':'image', mime_type:i<52?'audio/wav':'image/webp', duration_seconds:i<52?3:0}]:[]
    }))};
    return {
      image: b64.encode(await (await encryptBlobWithIvPrefix(image)).arrayBuffer()),
      audio: b64.encode(await (await encryptBlobWithIvPrefix(new Blob([wav],{type:'audio/wav'}))).arrayBuffer())
    };
  });
  const requests = [];
  await page.route('**/api/media/audit1862-*/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/voice-meta')) return route.fulfill({json:{ok:true,meta:null}});
    if (!/\/(thumb|blob)$/.test(pathname)) return route.continue();
    requests.push(pathname);
    if (pathname.includes('audio') && pathname.endsWith('/thumb')) return route.fulfill({status:404});
    return route.fulfill({status:200, contentType:'application/octet-stream', body:Buffer.from(pathname.includes('audio')?fixtures.audio:fixtures.image,'base64')});
  });
  const render = () => page.evaluate(async () => {
    FPRuntime169.loading.reset();
    await renderChatView(fixture1862.messages, fixture1862.deviceId);
    await FPNetwork171.waitForMediaCacheIdle();
  });
  await render();
  await page.waitForFunction(() => FPRuntime169.loading.report().records.filter(r=>r.consumer==='chat-thumbnail'&&r.status==='ok').length===6);
  await page.waitForFunction(() => FPRuntime169.loading.report().records.some(r=>r.kind==='cache-repair'&&r.status==='ok'));
  let records = (await report()).records;
  assert.equal(await page.locator('.fp-voice-player').count(),52);
  assert.equal(await page.locator('.media-thumb').count(),6);
  assert.equal(requests.length,6);
  assert(requests.every(url=>url.includes('image-')&&url.endsWith('/thumb')));
  assert.equal(records.filter(r=>r.kind==='media').length,6);
  assert.equal(records.filter(r=>r.kind==='cache-repair').length,1);
  assert.equal(await page.evaluate(()=>pendingMediaThumbLoads),0);
  pass('100-message render: 52 voice players, six image requests, zero audio thumbnails, one repair batch');

  await render();
  await page.waitForFunction(() => FPRuntime169.loading.report().records.filter(r=>r.consumer==='chat-thumbnail'&&r.status==='ok').length===6);
  // Let a mistakenly scheduled background batch fire before checking repeated entry.
  await page.waitForTimeout(180);
  records=(await report()).records;
  assert.equal(requests.length,6);
  assert.equal(records.filter(r=>r.kind==='cache-repair').length,0);
  assert.equal(records.filter(r=>r.kind==='media'&&r.cache==='hit').length,6);
  for (const item of records.filter(r=>r.kind==='media')) {
    for (const name of ['cacheOpen','cacheMeta','cacheMatch']) assert.equal(typeof item.stagesMs[name],'number',name);
    assert.equal(item.points['network-start'],undefined);
  }
  pass('repeated render reuses six encrypted previews and schedules no unchanged-metadata scan');

  await page.locator('.fp-voice-play').first().evaluate(button=>button.click());
  await page.waitForFunction(() => document.querySelector('.fp-voice-play')?.getAttribute('aria-label')==='Пауза');
  assert.equal(requests.filter(url=>url.includes('audio-')&&url.endsWith('/blob')).length,1);
  assert.equal(requests.filter(url=>url.includes('audio-')&&url.endsWith('/thumb')).length,0);
  await page.evaluate(()=>FPVoice.stopPlayback());
  pass('voice still decrypts and plays its original on demand');

  await page.evaluate(() => {
    const message={...fixture1862.messages[52],id:1862110,media:[{public_id:'audit1862-video',media_kind:'video',mime_type:'video/mp4'}]};
    appendMessage(document.getElementById('messages'),message,'',true,false);
  });
  await page.waitForFunction(() => document.querySelector('[data-message-id="1862110"] .media-thumb')?.naturalWidth>0);
  assert.equal(requests.filter(url=>url.includes('video/thumb')).length,1);
  assert.equal(await page.locator('[data-message-id="1862110"] .media-video-badge:not(.hidden)').count(),1);
  await page.evaluate(()=>FPStorage167CacheFix.repair());
  pass('video poster path and badge remain functional');

  await page.evaluate(async () => {
    const cache=await caches.open(FPStorage167.cacheName);
    const url=id=>new URL(`/api/media/audit1862-legacy-${id}/blob?deviceId=fixture`,location.href).href;
    for(let i=0;i<20;i++) await cache.put(url(i),new Response('old-encrypted-fixture'));
    window.legacy1862={url}; FPRuntime169.loading.reset();
    for(let i=0;i<20;i++) {
      FPStorage167CacheFix.rememberMediaList([{public_id:`audit1862-legacy-${i}`,media_kind:'audio',encrypted_size_bytes:99}]);
      await new Promise(resolve=>setTimeout(resolve,5));
    }
  });
  await page.waitForFunction(() => FPRuntime169.loading.report().records.some(r=>r.kind==='cache-repair'&&r.status==='ok'));
  records=(await report()).records.filter(r=>r.kind==='cache-repair');
  assert.equal(records.length,1);
  assert.equal(records[0].counts.updatedEntries,20);
  assert(records[0].counts.entries>=20);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fpchat:storage:cache-meta167'))[legacy1862.url(19)].kind),'audio');
  pass('metadata arriving over several tasks is repaired in one scan; old cached entries retain correct categories');

  const concurrency=await page.evaluate(async () => {
    const nativeKeys=Cache.prototype.keys;
    let calls=0,active=0,peak=0,release,entered;
    const started=new Promise(resolve=>{entered=resolve;});
    Cache.prototype.keys=async function(...args){
      calls++; active++; peak=Math.max(peak,active);
      try {
        const result=await nativeKeys.apply(this,args);
        if(calls===1){entered();await new Promise(resolve=>{release=resolve;});}
        return result;
      } finally { active--; }
    };
    try {
      const first=FPStorage167CacheFix.repair(); await started;
      const cache=await caches.open(FPStorage167.cacheName);
      await cache.put(legacy1862.url('late'),new Response('late-entry'));
      FPStorage167CacheFix.rememberMediaList([{public_id:'audit1862-legacy-late',media_kind:'video',encrypted_size_bytes:123}]);
      const second=FPStorage167CacheFix.repair();
      const shared=first===second; release(); await Promise.all([first,second]);
      return {shared,calls,peak,kind:JSON.parse(localStorage.getItem('fpchat:storage:cache-meta167'))[legacy1862.url('late')]?.kind};
    } finally {Cache.prototype.keys=nativeKeys;}
  });
  assert.deepEqual(concurrency,{shared:true,calls:2,peak:1,kind:'video'});
  pass('concurrent repair callers share work; a late cache entry is caught by one serialized follow-up');

  const guarded=await page.evaluate(async () => {
    const nativeKeys=Cache.prototype.keys, guard=FPStorage167ClearGuard;
    let release,entered;const started=new Promise(resolve=>{entered=resolve;});
    Cache.prototype.keys=async function(...args){const result=await nativeKeys.apply(this,args);entered();await new Promise(resolve=>{release=resolve;});return result;};
    const before=localStorage.getItem('fpchat:storage:cache-meta167');
    FPRuntime169.loading.reset();
    try {
      const repair=FPStorage167CacheFix.repair();await started;
      window.FPStorage167ClearGuard={...guard,isClearing:()=>true};release();await repair;
      return {unchanged:before===localStorage.getItem('fpchat:storage:cache-meta167'),status:FPRuntime169.loading.report().records[0].status};
    } finally {Cache.prototype.keys=nativeKeys;window.FPStorage167ClearGuard=guard;}
  });
  assert.deepEqual(guarded,{unchanged:true,status:'cancelled'});
  pass('repair waiting on Cache.keys does not write metadata after clear exclusivity begins');

  const timing=await page.evaluate(async () => {
    const open=caches.open.bind(caches), match=Cache.prototype.match;
    caches.open=async function(...args){await new Promise(resolve=>setTimeout(resolve,80));return open(...args);};
    Cache.prototype.match=async function(...args){await new Promise(resolve=>setTimeout(resolve,90));return match.apply(this,args);};
    FPRuntime169.loading.reset();
    try {
      await readEncryptedMedia174(`/api/media/audit1862-image-52/thumb?deviceId=${fixture1862.deviceId}`,'image/webp',state.key);
      await FPNetwork171.waitForMediaCacheIdle();
      return FPRuntime169.loading.report().records.find(r=>r.kind==='media');
    } finally {caches.open=open;Cache.prototype.match=match;}
  });
  assert.equal(timing.cache,'hit');
  assert(timing.stagesMs.cacheOpen>=70);
  assert(timing.stagesMs.cacheMatch>=80);
  assert.equal(timing.stagesMs.cacheKeys,null);
  pass('controlled delays are attributed separately to cache open and match, without a network request');

  const recovery=await page.evaluate(async () => {
    const nativeKeys=Cache.prototype.keys; FPRuntime169.loading.reset();
    Cache.prototype.keys=async()=>{throw Error('private-repair-error');};
    try {await FPStorage167CacheFix.repair();} finally {Cache.prototype.keys=nativeKeys;}
    await FPStorage167CacheFix.repair();
    return FPRuntime169.loading.report();
  });
  assert.deepEqual(recovery.records.map(r=>r.status),['error','ok']);
  assert.equal(recovery.records[0].error.stage,'cache-repair');
  for(const secret of ['private-repair-error','audit1862','/api/','deviceId']) assert(!JSON.stringify(recovery).includes(secret));
  pass('repair failure releases its task for retry and report omits private identifiers/errors');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({suite:'186.2 media/cache',passed,environment:'isolated Linux Chromium, synthetic media; not physical phone timing'}));
}).catch(error=>{console.error(error);process.exitCode=1;});
