'use strict';
const assert=require('node:assert/strict');
const {run}=require('./browser-harness174.cjs');

run(async({browser,origin,errors})=>{
  let passed=0;const pass=name=>{passed++;console.log('PASS 186.4 '+name);};
  const start=async(prepare,url='/')=>{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.dismiss());
    await page.addInitScript(()=>{
      window.bootAudit1863={scripts:[],releases:[]};
      document.addEventListener('load',event=>{
        if(event.target instanceof HTMLScriptElement&&event.target.src)bootAudit1863.scripts.push(new URL(event.target.src).pathname.slice(1));
      },true);
      window.addEventListener('fpchat:boot-ready',()=>bootAudit1863.releases.push({
        pending:FPBoot152.pendingCount(),pane:document.getElementById('appRoot').dataset.pane,
        rootReady:!document.getElementById('appRoot').classList.contains('hidden-boot'),
        owners:Boolean(window.FPRoomContext170&&window.FPConnection170&&window.FPSendManager177&&window.FPMediaSend170),
        interaction:Boolean(window.FPGesture135&&window.FPViewport173&&window.FPLayer173),
        room:typeof state!=='undefined'?state.roomId:null
      }));
    });
    if(prepare)await prepare(page);
    await page.goto(origin+url,{waitUntil:'domcontentloaded'});return page;
  };
  const ready=page=>page.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'));
  const normal=await start();await ready(normal);
  const state=await normal.evaluate(()=>({audit:bootAudit1863,boot:FPBoot152.timings186()}));
  assert.equal(state.audit.releases.length,1);
  assert.deepEqual({...state.audit.releases[0],room:null},{pending:0,pane:'list',rootReady:true,owners:true,interaction:true,room:null});
  for(const pair of [['room-context170.js','app.js'],['app.js','notification-manager181.js'],['room-lifecycle.js','connection170.js'],['connection170.js','sync-coordinator176.js'],['sync-coordinator176.js','room-open170.js'],['room-open170.js','send-manager177.js'],['send-manager177.js','text-send170.js'],['text-send170.js','media-send170.js']]){
    const [a,b]=pair.map(name=>state.audit.scripts.indexOf(name));
    assert(a>=0&&b>a,'execution order changed: '+pair.join(' -> '));
  }
  assert.equal(state.boot.completed['assets-end'],true);
  assert.equal(state.boot.points['quiet-start'],undefined);
  assert.equal(state.boot.points['system-start'],undefined);
  await normal.locator('#emptyCreateBtn').click();await normal.waitForSelector('#createBtn');
  assert(state.boot.assets.records.some(r=>r.name==='connection170.js'&&r.status==='loaded'));
  assert(state.boot.assets.records.every(r=>r.endMs!==null&&r.endMs>=r.startMs));
  assert(state.boot.assets.stoppedAtMs<=state.boot.points['boot-ready']);
  pass('preload preserves owner execution order; reveal is once, styled and interactive');

  let releaseData;const dataGate=new Promise(resolve=>{releaseData=resolve;});let pendingData=0;
  const delayed=await start(async page=>{
    await page.route('**/api/system/state?*',async route=>{pendingData++;await dataGate;pendingData--;return route.fulfill({json:{ok:true,hasEvents:true,total:1,unread:1}});});
    await page.route('**/api/system/events?*',route=>route.fulfill({json:{ok:true,events:[{id:1863,type:'fixture',createdAt:new Date().toISOString(),payload:{}}]}}));
    await page.route('**/api/chat-requests/mine?*',async route=>{pendingData++;await dataGate;pendingData--;return route.fulfill({json:{ok:true,requests:[]}});});
  });
  await ready(delayed);assert(pendingData>0,'fixture data was not held at reveal');
  await delayed.locator('#emptyCreateBtn').click();await delayed.waitForSelector('#createBtn');
  releaseData();await delayed.waitForSelector('.fp-system145-row',{state:'attached'});
  assert.equal(await delayed.evaluate(()=>bootAudit1863.releases.length),1);
  pass('held system/request responses do not block UI; their existing owners apply results after reveal');
  await delayed.close();

  let releaseCss,cssRequested=false;const cssGate=new Promise(resolve=>{releaseCss=resolve;});
  const styled=await start(async page=>page.route('**/settings-ui131.css?*',async route=>{cssRequested=true;await cssGate;return route.continue();}));
  await styled.waitForFunction(()=>window.__fpSettings131Installed&&window.__fpMediaGallery134Installed&&window.__fpSystemUi148Installed&&!document.getElementById('appRoot').classList.contains('hidden-boot'));
  assert(cssRequested);assert.equal(await styled.locator('#bootHold152').count(),1);
  await styled.waitForFunction(()=>FPBoot152.timings186().points['assets-start']!==undefined);
  releaseCss();await ready(styled);
  assert.equal(await styled.evaluate(()=>FPBoot152.timings186().completed['assets-end']),true);
  const cssBoot=await styled.evaluate(()=>FPRuntime169.loading.report().boot);
  const css=cssBoot.assets.records.find(r=>r.name==='settings-ui131.css');
  assert.equal(css.pendingAtAssetsStart,true);assert.equal(css.status,'loaded');
  assert(css.endMs>=cssBoot.points['assets-start']);
  pass('a pending stylesheet still holds the splash until the resource settles');await styled.close();

  const failed=await start(async page=>page.route('**/storage168.js?*',route=>route.abort('failed')));
  await ready(failed);assert(await failed.evaluate(()=>FPBoot152.errors().some(url=>url.includes('storage168.js'))));
  assert.equal(await failed.evaluate(()=>bootAudit1863.releases[0].owners),true);
  assert.equal(await failed.evaluate(()=>FPBoot152.timings186().assets.records.find(r=>r.name==='storage168.js').status),'error');
  pass('failed optional asset settles without blocking the installed owners');await failed.close();

  const ownerFailure=await start(async page=>page.route('**/connection170.js?*',route=>route.abort('failed')));
  await ready(ownerFailure);
  assert.match(await ownerFailure.locator('#contentPane').innerText(),/Не удалось загрузить приложение/);
  assert.equal(await ownerFailure.evaluate(()=>bootAudit1863.releases[0].owners),false);
  pass('required owner failure shows the existing retry UI instead of entering a partially owned chat');await ownerFailure.close();

  const fixture=await normal.evaluate(async()=>{
    const deviceId=getOrCreateDeviceId(),secret='startup1863-fixture';
    const recovery=await buildRecoveryPayload(generateRecoveryCode(),secret);
    const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})});
    const data=await response.json();if(!response.ok)throw Error('fixture room failed');
    STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});upsertChat(data.publicId,{});
    return {roomId:data.publicId,inviteCode:new URL(data.inviteLink).pathname.split('/').pop()};
  });
  await normal.goto(origin+'/chat/'+fixture.roomId,{waitUntil:'domcontentloaded'});await ready(normal);
  assert.equal(await normal.evaluate(()=>bootAudit1863.releases[0].room),fixture.roomId);
  await normal.locator('#msgInput').fill('startup1863-send');await normal.locator('#sendBtn').click();
  await normal.waitForFunction(()=>document.getElementById('messages')?.textContent.includes('startup1863-send'));
  pass('direct /chat enters after owners are ready and text sending remains available');

  const denied=await start(null,'/chat/'+fixture.roomId);await ready(denied);
  assert.match(await denied.locator('#contentPane').innerText(),/Нет локального доступа/);
  pass('direct /chat without local access keeps its restore/join screen');await denied.close();
  assert(fixture.inviteCode,'fixture must expose an invitation');
  const invited=await start(null,'/i/'+fixture.inviteCode);await ready(invited);
  await invited.waitForSelector('#msgInput');
  assert.equal(await invited.evaluate(()=>bootAudit1863.releases[0].room),fixture.roomId);
  pass('direct invite still joins through the existing owner before reveal');await invited.close();

  let releaseLateCss;const lateGate=new Promise(resolve=>{releaseLateCss=resolve;});
  const timedAssets=await start(async page=>page.route('**/settings-ui131.css?*',async route=>{await lateGate;return route.continue();}));
  await ready(timedAssets);
  const timedBoot=await timedAssets.evaluate(()=>FPBoot152.timings186());
  assert.equal(timedBoot.completed['assets-end'],false);
  assert.equal(timedBoot.assets.records.find(r=>r.name==='settings-ui131.css').status,'pending');
  assert(timedBoot.points['assets-end']-timedBoot.points['assets-start']>=3900);
  releaseLateCss();await timedAssets.waitForFunction(()=>FPBoot152.pendingCount()===0);
  assert.deepEqual(await timedAssets.evaluate(()=>FPBoot152.timings186().assets),timedBoot.assets);
  pass('asset timeout exports pending names and freezes evidence even when the stylesheet finishes later');
  await timedAssets.close();

  let releasePrivateCss;const privateGate=new Promise(resolve=>{releasePrivateCss=resolve;});
  const privacy=await start(async page=>{
    await page.route('**/settings-ui131.css?*',async route=>{await privateGate;return route.continue();});
    await page.route('**/private-asset-1864*',route=>route.fulfill({contentType:'text/css',body:'/* fixture */'}));
  });
  await privacy.waitForFunction(()=>window.FPBoot152?.timings186().points['assets-start']!==undefined);
  await privacy.evaluate(async()=>{
    const promises=[];
    for(let i=0;i<170;i++){
      const css=document.createElement('link');css.rel='stylesheet';
      css.href='/private-asset-1864-'+i+'.css?secret=private-query#private-fragment';
      promises.push(new Promise(resolve=>{css.onload=css.onerror=resolve;}));document.head.appendChild(css);
    }
    await Promise.all(promises);
  });
  releasePrivateCss();await ready(privacy);
  const privateReport=await privacy.evaluate(()=>FPRuntime169.loading.report());
  assert.equal(privateReport.boot.assets.records.length,160);assert(privateReport.boot.assets.dropped>0);
  assert(privateReport.boot.assets.records.some(r=>r.name==='other'));
  for(const secret of ['private-asset-1864','private-query','private-fragment',origin])assert(!JSON.stringify(privateReport).includes(secret));
  await privacy.evaluate(()=>FPRuntime169.loading.reset());
  assert.deepEqual(await privacy.evaluate(()=>FPRuntime169.loading.report().boot.assets),privateReport.boot.assets);
  pass('asset journal is bounded, strips unknown names/queries/fragments and survives measurement reset');
  await privacy.close();

  // Existing update ownership and boot-status mirroring are retained.
  await normal.evaluate(()=>localStorage.setItem(APP_BUILD_KEY,'1'));
  // Hold getRegistrations used by applyAppUpdate, without replacing that worker.
  await normal.addInitScript(()=>{
    if(!navigator.serviceWorker)return;
    const base=navigator.serviceWorker.getRegistrations.bind(navigator.serviceWorker);
    navigator.serviceWorker.getRegistrations=async()=>{window.updateEntered1863=true;await new Promise(resolve=>{window.releaseUpdate1863=resolve;});return base();};
  });
  await normal.reload({waitUntil:'domcontentloaded'});
  await normal.waitForFunction(()=>window.updateEntered1863);
  assert.match(await normal.locator('#bootHold152').innerText(),/Обновление приложения/);
  assert.equal(await normal.evaluate(()=>bootAudit1863.releases.length),0);
  await normal.evaluate(()=>releaseUpdate1863());
  await normal.waitForFunction(()=>window.__fpBootReady169At&&!document.getElementById('bootHold152'));
  assert.equal(await normal.evaluate(()=>sessionStorage.getItem(APP_UPDATE_RELOADING_KEY)),null);
  pass('real update retains its splash/reload path and clears the update marker');
  await normal.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({suite:'186.4 startup',passed,environment:'isolated Linux Chromium; physical mobile startup still requires acceptance'}));
}).catch(error=>{console.error(error);process.exitCode=1;});
