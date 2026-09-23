'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./browser-harness174.cjs');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

const apiStart = appSource.indexOf('const FPComposer177=Object.freeze({');
const apiEnd = appSource.indexOf('window.FPComposer177=FPComposer177;', apiStart);
assert(apiStart >= 0 && apiEnd > apiStart, 'FPComposer177 missing');
const apiBlock = appSource.slice(apiStart, apiEnd);
assert(apiBlock.includes('applyRestoredDraft({input,draft,text=\'\',replyTo=null}={})'),
  'FPComposer177 restored-draft command missing');
assert(apiBlock.includes('draft.text=text;'), 'restored draft state application missing');
assert(apiBlock.includes('input.value=text;'), 'restored input application missing');
assert(!apiBlock.includes('/draft'), 'FPComposer177 must not own draft transport');
assert(!apiBlock.includes('fetch('), 'FPComposer177 must not fetch restored drafts');
assert(!apiBlock.includes('decryptText('), 'FPComposer177 must not own draft decryption');

const loadStart = appSource.indexOf('async function loadDraftForCurrentRoom(){');
const loadEnd = appSource.indexOf('\nfunction showMessageReplyMenu', loadStart);
assert(loadStart >= 0 && loadEnd > loadStart, 'draft loader missing');
const loadBlock = appSource.slice(loadStart, loadEnd);
assert(loadBlock.includes('captureRoomView170()'), 'draft loader must retain RoomContext capture');
assert(loadBlock.includes('/draft?deviceId='), 'existing room draft GET endpoint must remain');
assert(loadBlock.includes('decryptText(serverDraft.iv,serverDraft.ciphertext,view.key)'),
  'existing encrypted draft format/decrypt path must remain');
assert.equal((loadBlock.match(/if\(!canApply\(\)\)return;/g) || []).length, 2,
  'draft loader must keep both stale-result guards');
assert(loadBlock.includes('window.FPComposer177?.applyRestoredDraft?.({input,draft,text,replyTo});'),
  'draft loader must delegate only restored application to FPComposer177');
assert(!loadBlock.includes('draft.text=text;input.value=text;'),
  'draft loader must not retain independent restored text application');

console.log('PASS restored draft application is delegated to FPComposer177');
console.log('PASS draft transport/decrypt and RoomContext guards remain in the existing loader');

run(async ({ browser, origin, errors }) => {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.FPComposer177?.applyRestoredDraft &&
    window.FPVoice &&
    typeof openChat === 'function' &&
    typeof saveDraftNow === 'function'
  );

  const rooms = await page.evaluate(async () => {
    const out = [];
    const deviceId = getOrCreateDeviceId();
    for (const suffix of ['a','b']) {
      const secret = '177-draft-restore-' + suffix;
      const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
      const response = await fetch('/api/rooms', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({displayName:state.nick,deviceId,roomSecret:secret,...recovery})
      });
      if(!response.ok) throw new Error('room fixture failed: '+response.status);
      const data=await response.json();
      STORAGE.set(STORAGE.roomState(data.publicId),{secret,deviceId});
      upsertChat(data.publicId,{});
      out.push(data.publicId);
    }
    return out;
  });

  const open = async (roomId) => {
    await page.evaluate(room => openChat(room), roomId);
    await page.waitForSelector('#msgInput');
  };

  const saveServerDraft = async (roomId, text) => {
    await open(roomId);
    await page.locator('#msgInput').fill(text);
    await page.evaluate(() => saveDraftNow(state.roomId));
  };

  await saveServerDraft(rooms[0], '177.11 server A');
  await saveServerDraft(rooms[1], '177.11 server B');

  const wireFormat = await page.evaluate(async (entries) => {
    const result = {};
    for (const [roomId, plain] of entries) {
      const persisted=STORAGE.get(STORAGE.roomState(roomId));
      const response=await fetch(`/api/rooms/${roomId}/draft?deviceId=${encodeURIComponent(persisted.deviceId)}`);
      const data=await response.json();
      const raw=JSON.stringify(data?.draft||{});
      result[roomId]={
        ciphertext:Boolean(data?.draft?.ciphertext),
        iv:Boolean(data?.draft?.iv),
        leaksPlaintext:raw.includes(plain)
      };
    }
    return result;
  }, [[rooms[0],'177.11 server A'],[rooms[1],'177.11 server B']]);

  for (const value of Object.values(wireFormat)) {
    assert.deepEqual(value,{ciphertext:true,iv:true,leaksPlaintext:false},
      'server draft must remain encrypted ciphertext/iv without plaintext');
  }

  await page.evaluate(ids => {
    for (const roomId of ids) {
      const draft=ensureDraftState(roomId);
      clearTimeout(draft.saveTimer);
      draft.saveTimer=null;
      draft.text='';
      draft.replyTo=null;
      draft.loaded=false;
    }
    showChatsList();
  }, rooms);

  await open(rooms[0]);
  assert.equal(await page.locator('#msgInput').inputValue(),'177.11 server A',
    'room A must restore its own encrypted server draft');

  await page.evaluate(roomId => {
    const draft=ensureDraftState(roomId);
    clearTimeout(draft.saveTimer);
    draft.saveTimer=null;
    draft.text='';
    draft.replyTo=null;
    draft.loaded=false;
    showChatsList();
  }, rooms[1]);
  await open(rooms[1]);
  assert.equal(await page.locator('#msgInput').inputValue(),'177.11 server B',
    'room B must restore its own encrypted server draft');

  await saveServerDraft(rooms[0], '177.11 delayed server draft');
  await page.evaluate(roomId => {
    const draft=ensureDraftState(roomId);
    clearTimeout(draft.saveTimer);
    draft.saveTimer=null;
    draft.text='';
    draft.replyTo=null;
    draft.loaded=false;
    showChatsList();
  }, rooms[0]);

  let release;
  let markStarted;
  const gate = new Promise(resolve => { release=resolve; });
  const started = new Promise(resolve => { markStarted=resolve; });
  await page.route('**/draft?*', async route => {
    const response=await route.fetch();
    markStarted();
    await gate;
    await route.fulfill({response});
  });

  try {
    await page.evaluate(room => {
      window.__fp17711Open=openChat(room);
    }, rooms[0]);

    await Promise.race([
      started,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('delayed draft request not reached')),5000))
    ]);
    await page.waitForSelector('#msgInput');
    await page.locator('#msgInput').fill('177.11 fresh local text');

    release();
    await page.evaluate(() => window.__fp17711Open);

    const stateAfter=await page.evaluate(() => ({
      input:document.getElementById('msgInput')?.value,
      draft:ensureDraftState(state.roomId).text
    }));
    assert.deepEqual(stateAfter,{
      input:'177.11 fresh local text',
      draft:'177.11 fresh local text'
    },'delayed server draft must not overwrite newer local text');
  } finally {
    release();
    await page.unroute('**/draft?*');
  }

  assert.deepEqual(errors,[]);
  console.log('PASS room-specific encrypted server drafts restore through FPComposer177');
  console.log('PASS delayed restored draft does not overwrite newer local text');
  console.log('PASS no uncaught browser errors');
}).catch(error => {
  console.error(error?.stack || error);
  process.exitCode=1;
});
