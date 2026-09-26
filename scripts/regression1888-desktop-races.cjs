const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const arbiterSource = read('public/reaction-arbiter188.js');
const managerSource = read('public/reaction-manager188.js');
const interactionSource = read('public/reaction-interaction188.js');
const pickerSource = read('public/reaction-picker188.js');
const detailsSource = read('public/reaction-details188.js');
const contextFix = read('public/message-context-fix.js');
const messageActions = read('public/message-actions.js');
const index = read('public/index.html');

for (const source of [
  arbiterSource, managerSource, interactionSource, pickerSource,
  detailsSource, contextFix, messageActions
]) new Function(source);

// Desktop input must not depend solely on click after legacy capture handlers.
assert(contextFix.includes("e.target.closest('.fp-reaction-quick188,.fp-reaction-picker188')"),
  'legacy context capture still swallows reaction controls');
assert(interactionSource.includes("event.pointerType !== 'mouse' || event.button !== 0"),
  'quick reaction desktop pointerup activation missing');
assert(interactionSource.includes("bindDesktopActivation(button"),
  'quick reaction buttons do not use desktop activation helper');
assert(pickerSource.includes("event.pointerType !== 'mouse' || event.button !== 0"),
  'picker item desktop pointerup activation missing');
assert(pickerSource.includes("['mouse', 'touch', 'pen'].includes(event.pointerType)"),
  'picker expand control does not accept desktop mouse pointerup');
assert(pickerSource.includes('fromMousePointer: Boolean(fromMousePointer)'),
  'picker selection loses mouse activation metadata');
assert(interactionSource.includes('if (activation.fromMousePointer) setTimeout(() => closeContext?.(), 0);'),
  'desktop picker selection can generate an underlying ghost click');
assert(index.includes("messageContextFix.src = `/message-context-fix.js${reactionBuildSuffix188 || buildSuffix}`;"),
  'same-build desktop context fix can be stale-cached');

// Reaction Details accepted race contract: tab switch aborts old page and generation rejects late results.
assert(detailsSource.includes('state.requestGeneration += 1;'), 'Details reset does not advance generation');
assert(detailsSource.includes("state.controller?.abort?.('details-reset');"), 'Details tab/reset does not abort old request');
assert(detailsSource.includes('generation !== state.requestGeneration'), 'late Details response can enter a newer tab');
assert(!detailsSource.includes('if (state.tab === entry.id || state.loading) return;'),
  'Details still blocks tab switches instead of cancelling old request');
assert(detailsSource.includes('incomingRevision <= state.revision'),
  'duplicate/older Details reaction events still mark current snapshot stale');
assert(detailsSource.includes('const opened = opener(row.profile);') &&
       detailsSource.indexOf('const opened = opener(row.profile);') < detailsSource.indexOf("close('profile-open');"),
  'Details closes before profile handoff succeeds');
assert(detailsSource.includes("manager?.hold?.(room, message, 'reaction-details188')"),
  'Reaction Details does not retain the current message reaction summary');
assert(detailsSource.includes('state.releaseHold?.();'),
  'Reaction Details does not release its reaction-summary hold on close');

// Delete-for-self must differ from delete-for-all.
assert(messageActions.includes("if (scope === 'self') window.FPReactionManager188?.hideMessageLocal?.(roomId, id);"),
  'delete-for-self still destroys reaction domain like delete-for-all');
assert(managerSource.includes('function hideMessageLocal(roomId, messageId)'),
  'local-hide reaction lifecycle missing');
assert(managerSource.includes("REACTION_MESSAGE_HIDDEN_CANCELLED"),
  'queued hidden-message reactions are not classified as cancellation');
assert(managerSource.includes('const releaseWhenIdle = new Set();'),
  'running delete-for-self reaction has no deferred release state');

// Lost HTTP response after server commit/WS must not become a false failure.
assert(managerSource.includes('mutationsReconciledByWs'),
  'WS reconciliation metric missing');
assert(managerSource.includes('reconciledByWs: true'),
  'lost response cannot reconcile from authoritative WS');

function makeSignal() {
  const listeners = [];
  return {
    aborted: false,
    reason: null,
    addEventListener(type, fn) { if (type === 'abort') listeners.push(fn); },
    removeEventListener(type, fn) {
      if (type !== 'abort') return;
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    },
    abort(reason) {
      if (this.aborted) return;
      this.aborted = true;
      this.reason = reason;
      for (const fn of [...listeners]) fn();
    }
  };
}

function createHarness(fetchImpl) {
  const listeners = new Map();
  const roomSignal = makeSignal();
  const windowObject = {
    FPRuntime: null,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
      return true;
    },
    FPRoomContext170: {
      current() {
        return { roomId: 'room-a', generation: 1, signal: roomSignal };
      }
    }
  };
  function CustomEventFake(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }

  new Function('window', 'CustomEvent', arbiterSource)(windowObject, CustomEventFake);

  const state = { roomId: 'room-a', me: { id: 7, displayName: 'Vadim' } };
  const STORAGE = {
    roomState: (roomId) => `room:${roomId}`,
    get: () => ({ deviceId: 'device-7' })
  };

  let managerRef = null;
  const wrappedFetch = (...args) => fetchImpl(() => managerRef, ...args);

  new Function(
    'window', 'CustomEvent', 'fetch', 'queueMicrotask', 'state', 'STORAGE',
    'activeChatDeviceId', 'AbortController', 'DOMException',
    managerSource
  )(
    windowObject, CustomEventFake, wrappedFetch, queueMicrotask, state, STORAGE,
    'device-7', AbortController, DOMException
  );

  managerRef = windowObject.FPReactionManager188;
  managerRef.syncHistoryRange('room-a', [10]);
  managerRef.applyAuthoritative('room-a', 10, {
    messageId: 10,
    reactionRevision: 0,
    reactions: [],
    myReactions: [],
    catalogVersion: 1
  });

  return { windowObject, manager: managerRef };
}

const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload
});

(async () => {
  // Server committed + WS arrived, but HTTP response was lost.
  {
    let calls = 0;
    const harness = createHarness(async (getManager, url, init = {}) => {
      calls += 1;
      assert.equal(init.method, 'PUT');
      getManager().ingestWs({
        type: 'reaction:update',
        roomId: 'room-a',
        messageId: 10,
        reactionRevision: 1,
        reactions: [{
          reactionId: 'heart',
          type: 'emoji',
          value: '❤️',
          count: 1,
          previewParticipantIds: [7]
        }],
        catalogVersion: 1,
        changedParticipantId: 7,
        changedParticipantReactions: ['heart']
      }, 7);
      throw new TypeError('response lost after commit');
    });

    const result = await harness.manager.toggleReaction({
      roomId: 'room-a',
      messageId: 10,
      reactionId: 'heart',
      reaction: { reactionId: 'heart', type: 'emoji', value: '❤️', enabled: true }
    });
    assert.equal(calls, 1);
    assert.equal(result.reconciledByWs, true, 'lost response was reported as failure despite authoritative WS');
    assert.equal(harness.manager.get('room-a', 10).reactions[0]?.mine, true);
    assert.equal(harness.manager.snapshot().stats.mutationsReconciledByWs, 1);
    assert.equal(harness.manager.snapshot().stats.mutationsFailed, 0);
  }

  // Delete-for-self while one mutation is already in flight:
  // running request finishes; queued request is cancelled and never sent; state releases afterward.
  {
    let fetchCalls = 0;
    let resolveFirst;
    const firstFetch = new Promise((resolve) => { resolveFirst = resolve; });
    const harness = createHarness(async (_getManager, url, init = {}) => {
      fetchCalls += 1;
      if (fetchCalls > 1) throw new Error('queued hidden mutation reached transport');
      await firstFetch;
      return response({
        ok: true,
        changed: true,
        messageId: 10,
        reactionRevision: 1,
        reactions: [{
          reactionId: 'heart',
          type: 'emoji',
          value: '❤️',
          count: 1,
          mine: true,
          previewParticipantIds: [7]
        }],
        myReactions: [{
          reactionId: 'heart',
          type: 'emoji',
          value: '❤️',
          createdAt: '2026-09-26T16:00:00Z'
        }],
        catalogVersion: 1
      });
    });

    const running = harness.manager.mutateReaction({
      roomId: 'room-a',
      messageId: 10,
      reactionId: 'heart',
      reaction: { reactionId: 'heart', type: 'emoji', value: '❤️', enabled: true },
      operation: 'add'
    });
    const queued = harness.manager.mutateReaction({
      roomId: 'room-a',
      messageId: 10,
      reactionId: 'joy',
      reaction: { reactionId: 'joy', type: 'emoji', value: '😂', enabled: true },
      operation: 'add'
    });

    await Promise.resolve();
    harness.manager.hideMessageLocal('room-a', 10);

    await assert.rejects(
      queued,
      (error) => String(error?.code || '').includes('CANCEL'),
      'queued delete-for-self reaction was not silently cancelled'
    );

    resolveFirst();
    await running;
    await Promise.resolve();

    assert.equal(fetchCalls, 1, 'delete-for-self sent a queued mutation after the message was hidden');
    assert.equal(harness.manager.get('room-a', 10), null, 'hidden message reaction state leaked after running request settled');
    assert.equal(harness.manager.snapshot().releaseWhenIdle, 0, 'deferred hidden reaction release leaked');
  }

  console.log('Build 188.8 desktop/race audit regression: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
