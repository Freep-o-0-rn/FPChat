'use strict';
const assert = require('node:assert/strict');
const {run} = require('./browser-harness174.cjs');

run(async ({newClient, errors}) => {
  const page = await newClient();
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(async () => {
    const deviceId = getOrCreateDeviceId(), secret = 'drawer175';
    const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
    const response = await fetch('/api/rooms', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({displayName: state.nick, deviceId, roomSecret: secret, ...recovery})});
    const data = await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId), {secret, deviceId}); upsertChat(data.publicId, {});
    showChatsList(); closeMobileMenu();
    window.drawerCalls175 = {menu: 0, opens: 0};
    const menu = showRoomMenu, open = openChat;
    showRoomMenu = function(...args) { drawerCalls175.menu++; return menu.apply(this, args); };
    openChat = function(...args) { drawerCalls175.opens++; return open.apply(this, args); };
    window.touch175 = (target, type, x = 12, y = 150, count = 1) => {
      const touch = {identifier: 175, target, clientX: x, clientY: y};
      const event = new Event(type, {bubbles: true, cancelable: true});
      const ended = type === 'touchend' || type === 'touchcancel';
      Object.defineProperties(event, {touches: {value: ended ? [] : Array.from({length: count}, () => touch)}, changedTouches: {value: [touch]}});
      target.dispatchEvent(event); return event.defaultPrevented;
    };
  });
  await page.waitForSelector('.chat-row');
  let passed = 0; const failed = [];
  const check = async (name, task) => {
    try {
      await page.evaluate(() => { closeMobileMenu(); hideMenu(); showChatsList(); drawerCalls175.menu = 0; drawerCalls175.opens = 0; });
      await page.waitForSelector('.chat-row'); await task(); passed++; console.log('PASS ' + name);
    } catch (error) { failed.push(name); console.error('FAIL ' + name + ': ' + error.stack); }
  };
  const snapshot = () => page.evaluate(() => ({...drawerCalls175, drawer: document.getElementById('sidebar').classList.contains('open')}));
  const swipe = async (distance, hold = false) => {
    await page.evaluate(distance => {
      const row = document.querySelector('.chat-row'); window.row175 = row;
      touch175(row, 'touchstart'); touch175(row, 'touchmove', 12 + distance);
    }, distance);
    if (hold) await page.waitForTimeout(700);
    await page.evaluate(distance => touch175(row175, 'touchend', 12 + distance), distance);
    await page.waitForTimeout(700);
  };
  await check('edge drawer swipe cancels the row long press even when end is intercepted', async () => {
    await swipe(100); assert.deepEqual(await snapshot(), {menu: 0, opens: 0, drawer: true});
  });
  await check('holding an owned drawer swipe cannot fire long press before release', async () => {
    await swipe(100, true); assert.deepEqual(await snapshot(), {menu: 0, opens: 0, drawer: true});
  });
  await check('short horizontal swipe cancels long press without opening the drawer or chat', async () => {
    await swipe(35); assert.deepEqual(await snapshot(), {menu: 0, opens: 0, drawer: false});
  });
  await check('intentional row long press still opens its menu exactly once', async () => {
    await page.evaluate(() => touch175(document.querySelector('.chat-row'), 'touchstart', 150));
    await page.waitForTimeout(700);
    await page.evaluate(() => touch175(document.querySelector('.chat-row'), 'touchend', 150));
    assert.deepEqual(await snapshot(), {menu: 1, opens: 0, drawer: false});
  });
  await check('vertical movement cancels long press and preserves native scrolling', async () => {
    const prevented = await page.evaluate(() => {
      const row = document.querySelector('.chat-row'); touch175(row, 'touchstart', 12, 150);
      const prevented = touch175(row, 'touchmove', 15, 200); touch175(row, 'touchend', 15, 200); return prevented;
    });
    await page.waitForTimeout(700); assert.equal(prevented, false);
    assert.deepEqual(await snapshot(), {menu: 0, opens: 0, drawer: false});
  });
  await check('opening the drawer by button cancels a pending underlying row press', async () => {
    await page.evaluate(() => touch175(document.querySelector('.chat-row'), 'touchstart', 150));
    await page.locator('#mobileMenuBtn').click(); await page.waitForTimeout(700);
    await page.evaluate(() => touch175(document.querySelector('.chat-row'), 'touchend', 150));
    assert.deepEqual(await snapshot(), {menu: 0, opens: 0, drawer: true});
  });
  await check('cancelled touch and multitouch leave no delayed row menu', async () => {
    await page.evaluate(() => { const row = document.querySelector('.chat-row'); touch175(row, 'touchstart', 150); touch175(row, 'touchcancel', 150); });
    await page.waitForTimeout(700);
    await page.evaluate(() => { const row = document.querySelector('.chat-row'); touch175(row, 'touchstart', 150, 150, 2); });
    await page.waitForTimeout(700);
    await page.evaluate(() => touch175(document.querySelector('.chat-row'), 'touchend', 150));
    assert.deepEqual(await snapshot(), {menu: 0, opens: 0, drawer: false});
  });
  await check('a trailing click after a cancelled swipe is ignored but the next tap works', async () => {
    await swipe(35);
    await page.evaluate(() => row175.click()); assert.equal((await snapshot()).opens, 0);
    await page.evaluate(() => { touch175(row175, 'touchstart', 150); touch175(row175, 'touchend', 150); row175.click(); });
    await page.waitForSelector('#sendForm'); assert.equal((await snapshot()).opens, 1);
  });
  await check('blur cancels a pending long press and releases action registrations', async () => {
    await page.evaluate(() => {
      touch175(document.querySelector('.chat-row'), 'touchstart', 150);
      window.dispatchEvent(new Event('blur'));
    });
    await page.waitForTimeout(700);
    assert.deepEqual(await snapshot(), {menu: 0, opens: 0, drawer: false});
    assert.equal(await page.evaluate(() => FPGesture135.snapshot().touch), null);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  });
  await check('filtering out a row cannot open its delayed context menu', async () => {
    try {
      await page.evaluate(async () => {
        touch175(document.querySelector('.chat-row'), 'touchstart', 150);
        els.search.value = '__no_matching_room_175__'; await renderChats();
      });
      assert.equal(await page.locator('.chat-row').count(), 0);
      await page.waitForTimeout(700);
      assert.deepEqual(await snapshot(), {menu: 0, opens: 0, drawer: false});
    } finally {
      await page.evaluate(async () => {
        touch175(document.body, 'touchcancel', 150); els.search.value = ''; await renderChats();
      });
    }
    assert.equal(await page.evaluate(() => FPGesture135.snapshot().touch), null);
  });
  await check('ordinary row tap still opens the chat', async () => {
    await page.evaluate(() => { const row = document.querySelector('.chat-row'); touch175(row, 'touchstart', 150); touch175(row, 'touchend', 150); row.click(); });
    await page.waitForSelector('#sendForm'); assert.equal((await snapshot()).opens, 1);
  });
  await check('a mouse click after a cancelled touch still opens the chat on a hybrid device', async () => {
    await page.evaluate(() => { const row = document.querySelector('.chat-row'); touch175(row, 'touchstart', 150); touch175(row, 'touchcancel', 150); });
    await page.locator('.chat-row').first().click();
    assert.equal((await snapshot()).opens, 1);
  });
  await check('no uncaught browser errors', async () => assert.deepEqual(errors, []));
  console.log(JSON.stringify({passed, failed, environment: 'Linux Chromium; synthetic touch sequence, physical mobile gestures remain unverified'}));
  if (failed.length) process.exitCode = 1;
}).catch(error => { console.error(error); process.exitCode = 1; });
