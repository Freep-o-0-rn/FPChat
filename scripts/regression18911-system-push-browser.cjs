'use strict';
// Real client modules, controlled HTTP snapshots and SW message handoff.
// No OS push service, production database or real invitation is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright')); }
const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const scripts = ['notification-manager181.js', 'system-chat144.js', 'chat-request-system147.js'];
const source = Object.fromEntries(scripts.map(name => [name, fs.readFileSync(path.join(root, 'public', name), 'utf8')]));
const pendingKey = 'fpchat:pending-system-notification181';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const request = (id = 'invite-a', status = 'pending') => ({
  requestId:id, direction:'incoming', status,
  peer:{displayName:`Sender ${id}`, username:id},
  createdAt:new Date().toISOString(), expiresAt:new Date(Date.now() + 3600000).toISOString()
});
const eventFor = (id = 42, refId = 'invite-a') => ({
  id, type:'chat_request_received', refType:'chat_request', refId,
  createdAt:new Date().toISOString(), readAt:null,
  payload:{requestId:refId, status:'pending', sender:{displayName:`Sender ${refId}`}}
});

async function main() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head></head><body><section id="chatListPane"><input id="chatSearch"><div id="emptyChats"></div></section></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await playwright.chromium.launch({
    headless:true, executablePath:process.env.BROWSER_EXECUTABLE_PATH || undefined,
    args:['--no-sandbox', '--disable-dev-shm-usage']
  });
  const errors = [];
  const clients = [];
  async function client({cold = false, ready = true, viewport = {width:390,height:844}} = {}) {
    const page = await browser.newPage({viewport});
    clients.push(page);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const fixture = {events:[eventFor()], rows:[request()], requests:0, activeRequests:0, maxActive:0, actions:[], read:[]};
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/chat-requests/mine') {
        fixture.requests++;
        fixture.activeRequests++;
        fixture.maxActive = Math.max(fixture.maxActive, fixture.activeRequests);
        const rows = structuredClone(fixture.rows);
        const gate = fixture.nextRequests;
        fixture.nextRequests = null;
        if (gate) { gate.started.resolve(); await gate.release.promise; }
        fixture.activeRequests--;
        return route.fulfill({json:{ok:true, requests:rows}});
      }
      if (url.pathname === '/api/system/events') {
        const events = structuredClone(fixture.events);
        const gate = url.searchParams.get('limit') === '100' ? fixture.nextEvents : null;
        if (gate) { fixture.nextEvents = null; gate.started.resolve(); await gate.release.promise; }
        return route.fulfill({json:{ok:true, events:events.slice(0, Number(url.searchParams.get('limit')))}});
      }
      if (url.pathname === '/api/system/state') return route.fulfill({json:{ok:true,hasEvents:fixture.events.length > 0,total:fixture.events.length,unread:1}});
      if (url.pathname === '/api/system/events/read') {
        fixture.read.push(route.request().postDataJSON());
        const gate = fixture.nextRead;
        if (gate) { fixture.nextRead = null; gate.started.resolve(); await gate.release.promise; }
        return route.fulfill({json:{ok:true}});
      }
      const match = url.pathname.match(/^\/api\/chat-requests\/([^/]+)\/(claim|complete|reject|block)$/);
      if (match) {
        fixture.actions.push({id:match[1],action:match[2],body:route.request().postDataJSON()});
        if (match[2] !== 'claim') fixture.rows = fixture.rows.map(row => row.requestId === match[1] ? {...row,status:{complete:'accepted',reject:'rejected',block:'blocked'}[match[2]]} : row);
        return route.fulfill({json:{ok:true,inviteCode:'fixture-invite'}});
      }
      throw new Error(`Unexpected API ${url.pathname}`);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/${cold ? '?systemEvent=42' : ''}`);
    await page.evaluate(() => {
      window.state = {notif:{enabled:false}, roomMute:{}, chats:[]};
      window.STORAGE = {get:() => null, set:() => {}, notif:'notif'};
      window.normalizeNotificationSettings = value => value;
      window.getOrCreateDeviceId = () => 'recipient-fixture';
      window.joinedInvites = [];
      window.joinByInviteText = async code => { joinedInvites.push(code); return true; };
      window.FPChatRequestOwner147 = {reconcile:() => {}};
      window.countdownIntervals = new Set();
      const originalSet = window.setInterval, originalClear = window.clearInterval;
      window.setInterval = (callback, ...args) => {
        const id = originalSet(callback, ...args);
        if (callback.name === 'updateCountdowns') countdownIntervals.add(id);
        return id;
      };
      window.clearInterval = id => { countdownIntervals.delete(id); originalClear(id); };
    });
    await page.addScriptTag({content:source[scripts[0]]});
    await page.addScriptTag({content:source[scripts[1]]});
    if (ready) await install(page);
    return {page,fixture};
  }
  async function install(page) { await page.addScriptTag({content:source[scripts[2]]}); }
  async function push(page, id = 42, refId = 'invite-a') {
    await page.evaluate(({id,refId}) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
      data:{type:'open-system',systemEventId:id,refType:'chat_request',refId}
    })), {id,refId});
  }
  async function buttons(page, id = 'invite-a') {
    await page.waitForFunction(() => document.querySelectorAll('.fp-system147-actions button').length === 3, null, {timeout:4000});
    assert.deepEqual(await page.locator('.fp-system147-actions button').allTextContents(), ['Принять','Отклонить','Заблокировать']);
    assert.equal(await page.locator('.fp-system145-overlay').count(), 1);
    assert.equal(await page.locator('.fp-system145-event').first().getAttribute('data-request-id'), id);
  }
  const gate = () => ({started:deferred(),release:deferred()});
  try {
    // Warm PWA: the SW handoff must use exactly the same actionable view as the row.
    const warm = await client();
    await push(warm.page);
    await buttons(warm.page);
    assert.equal(await warm.page.locator('[data-system-event-id="42"]').count(), 1);
    await warm.page.evaluate(() => FPSystem144.close());
    await warm.page.locator('.fp-system145-row').click();
    await buttons(warm.page);
    console.log('PASS warm SW push and chat row share actionable view');

    // Cold URL: preserve the target while only the system data API has loaded.
    const cold = await client({cold:true,ready:false});
    assert.equal(await cold.page.locator('.fp-system145-overlay').count(), 0);
    assert.ok(await cold.page.evaluate(key => sessionStorage.getItem(key), pendingKey));
    await install(cold.page);
    await buttons(cold.page);
    assert.equal(await cold.page.evaluate(key => sessionStorage.getItem(key), pendingKey), null);
    assert.equal(await cold.page.evaluate(() => location.search), '');
    console.log('PASS cold URL waits for view readiness and opens automatically');

    const early = await client({ready:false});
    await push(early.page);
    await install(early.page);
    await buttons(early.page);
    console.log('PASS early SW message survives delayed view installation');

    // Focus initiated a snapshot before the new request existed.
    const stale = await client();
    await stale.page.waitForFunction(() => !!document.querySelector('.fp-system145-row'));
    await stale.page.waitForTimeout(50);
    stale.fixture.rows = [];
    const oldRequests = gate(); stale.fixture.nextRequests = oldRequests;
    await stale.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await oldRequests.started.promise;
    stale.fixture.rows = [request()];
    await push(stale.page);
    oldRequests.release.resolve();
    await buttons(stale.page);
    assert.equal(stale.fixture.maxActive, 1, 'request snapshots must stay single flight');
    console.log('PASS stale focus snapshot is followed by fresh invitation data');

    // The two endpoints are independent: a pending incoming request is actionable
    // even if the event list was captured just before insertion.
    const split = await client(); split.fixture.events = [];
    await push(split.page);
    await buttons(split.page);
    console.log('PASS incoming request survives an older system-event snapshot');

    // A slow old render of the same overlay cannot erase a newer event.
    const race = await client();
    await push(race.page); await buttons(race.page);
    const oldEvents = gate(); race.fixture.nextEvents = oldEvents;
    await race.page.evaluate(() => window.dispatchEvent(new Event('fpchat:chat-request-changed')));
    await oldEvents.started.promise;
    race.fixture.events.push({id:99,type:'notice',createdAt:new Date().toISOString(),readAt:'read'});
    await race.page.evaluate(() => window.dispatchEvent(new Event('fpchat:chat-request-changed')));
    await race.page.waitForSelector('[data-system-event-id="99"]');
    oldEvents.release.resolve();
    await race.page.waitForTimeout(80);
    assert.equal(await race.page.locator('[data-system-event-id="99"]').count(), 1);
    console.log('PASS late render cannot overwrite a newer overlay snapshot');

    const closing = await client();
    const readGate = gate(); closing.fixture.nextRead = readGate;
    await push(closing.page);
    await readGate.started.promise;
    await closing.page.evaluate(() => FPSystem144.close());
    readGate.release.resolve();
    await closing.page.waitForTimeout(80);
    assert.equal(await closing.page.locator('.fp-system145-overlay').count(), 0);
    assert.equal(await closing.page.evaluate(() => countdownIntervals.size), 0);
    console.log('PASS closing during mark-read does not revive view or countdown');

    for (const action of ['reject','block','accept']) {
      const item = await client({viewport:{width:1280,height:800}});
      await push(item.page); await buttons(item.page);
      await item.page.locator(`.fp-system147-btn.${action}`).click();
      if (action === 'accept') {
        await item.page.waitForSelector('.fp-system145-overlay', {state:'detached'});
        assert.deepEqual(item.fixture.actions.map(a => a.action), ['claim','complete']);
        assert.deepEqual(await item.page.evaluate(() => joinedInvites), ['fixture-invite']);
      } else {
        await item.page.waitForSelector(`.fp-system147-status.${action === 'block' ? 'blocked' : 'rejected'}`);
        assert.equal(await item.page.locator('.fp-system147-actions button').count(), 0);
        assert.deepEqual(item.fixture.actions.map(a => a.action), [action]);
      }
      assert.ok(item.fixture.actions.every(a => a.body.targetDeviceId === 'recipient-fixture'));
      console.log(`PASS push card ${action} uses existing decision flow`);
    }
    assert.deepEqual(errors, []);
    console.log('Build 189.11 system push browser regression PASS');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
