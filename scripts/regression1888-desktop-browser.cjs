'use strict';
const assert = require('node:assert/strict');
const {run} = require('./browser-harness174.cjs');

run(async ({newClient, errors}) => {
  const page = await newClient();
  await page.setViewportSize({width:1280,height:800});

  await page.evaluate(async () => {
    const deviceId = getOrCreateDeviceId();
    const secret = 'reaction-desktop1888-fixture';
    const recovery = await buildRecoveryPayload(generateRecoveryCode(), secret);
    const response = await fetch('/api/rooms', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        displayName:state.nick,
        deviceId,
        roomSecret:secret,
        ...recovery
      })
    });
    if (!response.ok) throw new Error('fixture room creation failed');
    const data = await response.json();
    STORAGE.set(STORAGE.roomState(data.publicId), {secret,deviceId});
    upsertChat(data.publicId, {});
    await openChat(data.publicId);
    window.reactionDesktop1888 = {roomId:data.publicId,deviceId};
  });

  await page.waitForFunction(() =>
    window.FPReactionManager188 &&
    window.FPReactionInteractionManager188 &&
    window.FPReactionPicker188 &&
    window.FPReactionRenderer188 &&
    document.getElementById('sendForm')
  );

  await page.locator('#msgInput').fill('desktop reaction acceptance');
  await page.waitForFunction(() => !document.getElementById('sendBtn')?.disabled);
  await page.locator('#sendBtn').click();
  await page.waitForFunction(() => {
    const rows=[...document.querySelectorAll('#messages .bubble-wrap.msg')];
    return rows.some(row => row.dataset.messageId && /^\d+$/.test(row.dataset.messageId));
  });

  const message = page.locator('#messages .bubble-wrap.msg').filter({hasText:'desktop reaction acceptance'}).last();
  await message.waitFor();

  const openContext = async () => {
    await message.locator(':scope > .bubble').click({button:'right'});
    await page.waitForSelector('.message-context-root');
    await page.waitForFunction(() =>
      document.querySelectorAll('.fp-reaction-quick188 .fp-reaction-quick-button188').length === 7 &&
      document.querySelector('.fp-reaction-picker-toggle188')
    );
  };

  const closeContext = async () => {
    await page.evaluate(() => document.querySelector('.message-context-backdrop')?.click());
    await page.waitForSelector('.message-context-root', {state:'detached'}).catch(()=>{});
  };

  // 1) Desktop chevron must expand without closing context.
  await openContext();
  await page.locator('.fp-reaction-picker-toggle188').click();
  await page.waitForFunction(() => {
    const root=document.querySelector('.message-context-root');
    const panel=document.querySelector('.fp-reaction-picker188');
    return Boolean(root && panel && !panel.hidden && panel.querySelectorAll('.fp-reaction-picker-item188').length > 7);
  });
  assert.equal(await page.locator('.message-context-root').count(), 1, 'desktop chevron closed message context');
  await closeContext();

  // 2) Desktop quick reaction must mutate and render on the original message.
  await openContext();
  await page.locator('.fp-reaction-quick-button188[data-reaction-id="heart"]').click();
  await page.waitForSelector('.message-context-root', {state:'detached'});
  await page.waitForFunction(() => {
    const row=[...document.querySelectorAll('#messages .bubble-wrap.msg')]
      .find(node => node.textContent?.includes('desktop reaction acceptance'));
    const pill=row?.querySelector('.fp-reaction-pill188[data-reaction-id="heart"]');
    return pill && pill.getAttribute('aria-pressed') === 'true';
  });

  // 3) Existing pill toggles off through the independent compact-pill path.
  await message.locator('.fp-reaction-pill188[data-reaction-id="heart"]').click();
  await page.waitForFunction(() => {
    const row=[...document.querySelectorAll('#messages .bubble-wrap.msg')]
      .find(node => node.textContent?.includes('desktop reaction acceptance'));
    return !row?.querySelector('.fp-reaction-pill188[data-reaction-id="heart"]');
  });

  // 4) Full picker item uses the same mutation path.
  await openContext();
  await page.locator('.fp-reaction-picker-toggle188').click();
  await page.waitForFunction(() => {
    const panel=document.querySelector('.fp-reaction-picker188');
    return Boolean(panel && !panel.hidden);
  });
  await page.locator('.fp-reaction-picker-item188[data-reaction-id="grin"]').click();
  await page.waitForSelector('.message-context-root', {state:'detached'});
  await page.waitForFunction(() => {
    const row=[...document.querySelectorAll('#messages .bubble-wrap.msg')]
      .find(node => node.textContent?.includes('desktop reaction acceptance'));
    const pill=row?.querySelector('.fp-reaction-pill188[data-reaction-id="grin"]');
    return pill && pill.getAttribute('aria-pressed') === 'true';
  });

  const snap = await page.evaluate(() => ({
    interaction: window.FPReactionInteractionManager188?.snapshot?.(),
    picker: window.FPReactionPicker188?.snapshot?.(),
    manager: window.FPReactionManager188?.snapshot?.()
  }));
  assert.ok((snap.interaction?.quickClicks || 0) >= 1, 'desktop quick activation did not reach interaction owner');
  assert.ok((snap.picker?.toggles || 0) >= 2, 'desktop picker toggle did not reach picker owner');
  assert.ok((snap.picker?.selections || 0) >= 1, 'desktop picker selection did not reach picker owner');
  assert.equal(snap.interaction?.lastMutationError, null, 'desktop acceptance recorded a mutation error');

  assert.deepEqual(errors, []);
  console.log('PASS 188.8 desktop chevron opens full picker');
  console.log('PASS 188.8 desktop quick reaction mutates and renders');
  console.log('PASS 188.8 desktop compact pill toggles independently');
  console.log('PASS 188.8 desktop full picker selection mutates and renders');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
