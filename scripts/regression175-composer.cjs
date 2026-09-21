'use strict';
const assert = require('node:assert/strict');
const {run} = require('./browser-harness174.cjs');

run(async ({browser, origin, errors}) => {
  let passed = 0;
  const failed = [];
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  await page.goto(origin);
  // Also runs against the unchanged Build 168 checkout: no new owner required.
  await page.waitForFunction(() => window.FPVoice && typeof openChat === 'function' && !document.getElementById('bootHold152'));
  const rooms = await page.evaluate(async () => {
    const ids = [], deviceId = getOrCreateDeviceId();
    for (const name of ['composer-a', 'composer-b']) {
      const secret = '175-' + name;
      const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
      const response = await fetch('/api/rooms', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({displayName: state.nick, deviceId, roomSecret: secret, ...recovery})});
      if (!response.ok) throw Error('Room fixture failed: ' + response.status);
      const data = await response.json();
      STORAGE.set(STORAGE.roomState(data.publicId), {secret, deviceId});
      upsertChat(data.publicId, {});
      ids.push(data.publicId);
    }
    return ids;
  });
  const check = async (name, task) => {
    if (process.env.FPCHAT_175_FOCUS && !name.includes(process.env.FPCHAT_175_FOCUS)) return;
    try { await task(); passed++; console.log('PASS ' + name); }
    catch (error) { failed.push(name); console.error('FAIL ' + name + ': ' + error.stack); }
    finally { await page.mouse.up(); await page.keyboard.press('Escape'); }
  };
  const open = async (index = 0) => {
    await page.evaluate(async room => { showChatsList(); await openChat(room); }, rooms[index]);
    await page.waitForSelector('#sendForm .fp-voice-record-btn', {state: 'attached'});
  };
  const buttons = () => page.evaluate(() => {
    const form = document.getElementById('sendForm');
    const mic = form.querySelector('.fp-voice-record-btn'), send = form.querySelector('#sendBtn');
    return {micVisible: getComputedStyle(mic).display !== 'none', micDisabled: mic.disabled,
      sendVisible: getComputedStyle(send).display !== 'none', sendDisabled: send.disabled,
      text: form.querySelector('#msgInput').value, microphones: form.querySelectorAll('.fp-voice-record-btn').length};
  });
  const expectEmpty = async () => assert.deepEqual(await buttons(), {
    micVisible: true, micDisabled: false, sendVisible: false, sendDisabled: true, text: '', microphones: 1
  });

  const startVoice = async () => {
    await page.evaluate(() => {
      window.testAudio175 ||= [];
      navigator.mediaDevices.getUserMedia = async () => {
        const audio = new AudioContext(), oscillator = audio.createOscillator(), destination = audio.createMediaStreamDestination();
        oscillator.connect(destination); oscillator.start();
        void audio.resume(); testAudio175.push({audio, oscillator, stream: destination.stream});
        return destination.stream;
      };
    });
    const rect = await page.locator('.fp-voice-record-btn').boundingBox();
    assert(rect, 'microphone visible before recording');
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.waitForSelector('#sendForm.fp-voice-recording');
    return {x, y};
  };
  const voicePreview = async () => {
    const {x, y} = await startVoice();
    await page.mouse.move(x, y - 180, {steps: 5}); await page.mouse.up();
    await page.waitForSelector('#sendForm.fp-voice-locked');
    await page.waitForTimeout(850); // Existing 700 ms minimum: real MediaRecorder, synthetic audio stream.
    await page.locator('.fp-voice-record-stop').click();
    await page.waitForSelector('#sendForm.fp-voice-previewing');
  };

  await check('empty composer, typed text and manual clearing keep existing send/mic behavior', async () => {
    await open(); await expectEmpty();
    await page.locator('#msgInput').fill('typing');
    assert.deepEqual(await buttons(), {micVisible: false, micDisabled: true, sendVisible: true, sendDisabled: false, text: 'typing', microphones: 1});
    await page.locator('#msgInput').fill(''); await expectEmpty();
  });
  await check('text send restores the microphone without typing or reopening', async () => {
    await open();
    await page.locator('#msgInput').fill('175 real text');
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => document.getElementById('msgInput').value === '');
    const messages = await page.evaluate(async () => {
      const r = await fetch(`/api/rooms/${state.roomId}/messages?deviceId=${getOrCreateDeviceId()}&limit=100`);
      return (await r.json()).messages;
    });
    assert.equal(messages.filter(m => m.type === 'text').length, 1, 'exactly one real message persisted');
    await expectEmpty();
  });
  await check('restored encrypted draft selects send and empty draft selects mic', async () => {
    await open(1);
    await page.locator('#msgInput').fill('175 saved draft');
    await page.evaluate(() => saveDraftNow(state.roomId));
    await open(1);
    assert.deepEqual(await buttons(), {micVisible: false, micDisabled: true, sendVisible: true, sendDisabled: false, text: '175 saved draft', microphones: 1});
    await page.locator('#msgInput').fill('');
    await page.evaluate(() => saveDraftNow(state.roomId));
    await open(1); await expectEmpty();
  });
  await check('delayed server draft updates a composer that is already mounted', async () => {
    await open(1); await page.locator('#msgInput').fill('delayed draft');
    await page.evaluate(() => saveDraftNow(state.roomId));
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/draft?*', async route => { const response = await route.fetch(); await gate; await route.fulfill({response}); });
    try {
      await page.evaluate(room => { showChatsList(); window.open175 = openChat(room); }, rooms[1]);
      await page.waitForSelector('.fp-voice-record-btn', {state: 'visible'});
      release(); await page.evaluate(() => open175);
      assert.deepEqual(await buttons(), {micVisible: false, micDisabled: true, sendVisible: true, sendDisabled: false, text: 'delayed draft', microphones: 1});
    } finally { release(); await page.unroute('**/draft?*'); }
  });
  await check('opening edit selects send and cancelling restores the original empty composer', async () => {
    await open(0); await expectEmpty();
    await page.locator('#messages .bubble-wrap.mine .message-text').first().click({button: 'right'});
    await page.locator('[data-fp-message-action="edit"]').click();
    assert.equal((await buttons()).sendVisible, true);
    assert.equal((await buttons()).micVisible, false);
    await page.locator('.edit-composer-close').click(); await expectEmpty();
  });
  await check('repeated room mounts keep one microphone and preserve independent drafts', async () => {
    await open(1); await page.locator('#msgInput').fill('room B');
    await page.evaluate(() => saveDraftNow(state.roomId));
    for (let i = 0; i < 3; i++) { await open(0); await expectEmpty(); await open(1); }
    assert.equal((await buttons()).text, 'room B');
    assert.equal((await buttons()).microphones, 1);
  });
  await check('leaving voice preview restores the microphone in the new room', async () => {
    await open(0); await voicePreview();
    try {
      await page.evaluate(() => clearDraftOnServer(state.chats.find(c => c.roomId !== state.roomId).roomId));
      await page.evaluate(room => openChat(room), rooms[1]);
      await expectEmpty();
    } finally { await page.evaluate(() => FPVoice.clearPreview()); }
  });
  await check('voice cancellation returns to the existing empty composer', async () => {
    await open(0); await startVoice();
    await page.evaluate(() => FPVoice.cancelRecording()); await page.mouse.up();
    await page.waitForFunction(() => !document.getElementById('sendForm').classList.contains('fp-voice-recording'));
    await expectEmpty();
  });
  await check('finishing a real voice upload for A restores the idle microphone in B', async () => {
    await open(0); await voicePreview();
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { started = resolve; });
    await page.route('**/voice/upload', async route => {
      const response = await route.fetch(); started(); await gate; await route.fulfill({response});
    });
    try {
      await page.locator('.fp-voice-preview-send').click();
      await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(Error('voice upload not reached')), 5000))]);
      await page.evaluate(room => openChat(room), rooms[1]);
      assert.equal((await buttons()).micDisabled, true, 'preserve existing global voice-upload busy state');
      release();
      await page.waitForFunction(() => !document.querySelector('.fp-voice-record-btn').disabled, null, {timeout: 4000});
      await expectEmpty();
    } finally { release(); await page.unroute('**/voice/upload'); await page.evaluate(() => FPVoice.clearPreview()); }
  });
  await page.evaluate(async () => {
    for (const {audio, oscillator, stream} of window.testAudio175 || []) {
      stream.getTracks().forEach(t => t.stop()); oscillator.stop(); await audio.close();
    }
  });
  await check('no uncaught browser errors', async () => assert.deepEqual(errors, []));
  console.log(JSON.stringify({passed, failed, environment: 'Linux Chromium, real server/text/draft; physical mobile acceptance separate'}));
  if (failed.length) process.exitCode = 1;
}).catch(error => { console.error(error); process.exitCode = 1; });
