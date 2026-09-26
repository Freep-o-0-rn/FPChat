const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const interaction = read('public/reaction-interaction188.js');
const managerSource = read('public/reaction-manager188.js');
const arbiterSource = read('public/reaction-arbiter188.js');
const renderer = read('public/reaction-renderer188.js');
const context = read('public/message-context.js');
const app = read('public/app.js');
const index = read('public/index.html');

for (const source of [interaction, managerSource, arbiterSource, renderer, app, context]) new Function(source);

assert(interaction.includes('const LONG_PRESS_MS = 450;'), 'reaction long press no longer matches message long press');
assert(interaction.includes('const MOVE_CANCEL_PX = 12;'), 'reaction move cancellation no longer matches message long press');
assert(interaction.includes("watchAction?.('reaction-long-press'"), 'reaction long press bypasses FPGesture135');
assert(interaction.includes("FPGesture135.currentLayer(event, event.target) !== 'chat'"), 'reaction interaction does not respect gesture layer');
assert(interaction.includes("document.addEventListener('contextmenu'"), 'desktop reaction right click missing');
assert(interaction.includes("document.addEventListener('click'"), 'reaction pill tap/click missing');
assert(interaction.includes('manager.toggleReaction({'), 'interaction manager does not delegate mutation state to ReactionManager');
assert(interaction.includes('manager.getQuickReactions()'), 'message context quick strip does not use catalog');
assert(interaction.includes('closeContext?.();'), 'quick reaction does not close message context');
assert(interaction.includes("const detailsOwner = window.FPReactionDetails188;"), 'future Reaction Details handoff missing');
assert(interaction.includes("typeof detailsOwner?.open === 'function'"), 'future Reaction Details owner contract missing');
assert(interaction.includes('fallbackToMessageContext'), 'Build 188.4 has no safe pre-Details long-press fallback');
assert(!interaction.includes('new WebSocket'), 'reaction interaction creates a second socket');
assert(!interaction.includes('localStorage'), 'reaction interaction introduced persistent state');
assert(!interaction.includes('indexedDB'), 'reaction interaction introduced persistent state');

assert(managerSource.includes('pendingByMessage'), 'optimistic reaction projection missing');
assert(managerSource.includes('function projectPending'), 'optimistic projection owner missing');
assert(managerSource.includes('function mutateReaction'), 'explicit reaction mutation API missing');
assert(managerSource.includes('function toggleReaction'), 'reaction toggle decision API missing');
assert(managerSource.includes("operation: mine ? 'remove' : 'add'"), 'tap is not translated into explicit ADD/REMOVE');
assert(managerSource.includes("method = op === 'add' ? 'PUT' : 'DELETE'"), 'server mutation protocol is no longer explicit ADD/REMOVE');
assert(managerSource.includes('cancelPendingRoom(roomId'), 'room transition cancellation hook missing');
assert(managerSource.includes('cancelPendingMessage(roomId'), 'message deletion cancellation hook missing');
assert(managerSource.includes('const roomContext = contextOwner?.current?.() || null;'), 'reaction mutation does not capture RoomContext at enqueue time');
assert(managerSource.includes('roomContext,'), 'pending reaction entry does not retain captured RoomContext');
assert(managerSource.includes('const context = entry?.roomContext || null;'), 'network abort bridge uses a later room context instead of the captured one');
assert(!managerSource.includes('setInterval('), 'reaction mutation manager introduced polling');
assert(!managerSource.includes('localStorage.'), 'reaction mutations became persistent');
assert(!managerSource.includes('indexedDB'), 'reaction mutations became persistent');

assert(renderer.includes(':root.fp-reaction-interaction188-ready .' + '$' + '{PILL}'), 'reaction pills activate before interaction owner');
assert(renderer.includes("document.createElement('button')"), 'reaction pill is not an interactive button');
assert(renderer.includes("pill.setAttribute('aria-pressed'"), 'own reaction state is not exposed on pill');
assert(renderer.includes('.message-context-copy .' + '$' + '{PILL}'), 'cloned message reaction pills can steal context input');

assert.equal((context.match(/fp-reaction-pill188/g) || []).length, 2, 'message-context reaction guards changed');
assert(context.includes('FPReactionInteractionManager188?.decorateContext'), 'quick strip is not an additive message-context hook');
assert(app.includes("if(e.target?.closest?.('.fp-reaction-pill188'))return;"), 'reply swipe can start from reaction pill');
assert(index.includes('renderer.onload = loadReactionPicker188;'), 'picker load order changed');
assert(index.includes('picker.onload = loadReactionInteraction188;'), 'interaction manager load order changed');
assert(index.includes('picker.onerror = loadReactionInteraction188;'), 'quick reactions no longer survive optional picker load failure');

const fakeWindow = {
  addEventListener() {},
  dispatchEvent() {},
  FPRuntime: null,
  FPRoomContext170: {
    current() {
      return { roomId: 'room-a', signal: new AbortController().signal };
    }
  }
};

new Function('window', arbiterSource)(fakeWindow);
assert(fakeWindow.FPReactionArbiter188, 'client reaction arbiter did not initialize');

const state = { roomId: 'room-a', me: { id: 7, displayName: 'Vadim' } };
const STORAGE = {
  roomState: (roomId) => `room:${roomId}`,
  get: () => ({ deviceId: 'device-test-0001' })
};
const fetchQueue = [];
const fetchCalls = [];
function fakeFetch(url, init = {}) {
  fetchCalls.push({ url: String(url), init });
  return new Promise((resolve, reject) => fetchQueue.push({ resolve, reject }));
}
function CustomEventFake(type, init) { this.type = type; this.detail = init?.detail; }

new Function(
  'window', 'CustomEvent', 'fetch', 'queueMicrotask', 'state', 'STORAGE', 'activeChatDeviceId',
  managerSource
)(fakeWindow, CustomEventFake, fakeFetch, queueMicrotask, state, STORAGE, 'device-test-0001');

const manager = fakeWindow.FPReactionManager188;
assert(manager, 'reaction manager did not initialize');
manager.syncHistoryRange('room-a', [10]);
manager.applyAuthoritative('room-a', 10, {
  messageId: 10,
  reactionRevision: 0,
  reactions: [],
  myReactions: [],
  catalogVersion: 1
});

const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload
});

(async () => {
  const add = manager.toggleReaction({
    roomId: 'room-a',
    messageId: 10,
    reactionId: 'heart',
    reaction: { reactionId: 'heart', type: 'emoji', value: '❤️', enabled: true }
  });
  assert.equal(manager.get('room-a', 10).reactions[0]?.mine, true, 'ADD optimistic state is not visible immediately');

  const remove = manager.toggleReaction({
    roomId: 'room-a',
    messageId: 10,
    reactionId: 'heart',
    reaction: { reactionId: 'heart', type: 'emoji', value: '❤️', enabled: true }
  });
  assert.equal(manager.get('room-a', 10).reactions.length, 0, 'rapid second tap did not project explicit REMOVE');

  assert.equal(fetchCalls.length, 1, 'same-message FIFO allowed second mutation to overtake first');
  assert.equal(fetchCalls[0].init.method, 'PUT', 'first tap must send explicit ADD');

  fetchQueue.shift().resolve(response({
    ok: true,
    changed: true,
    messageId: 10,
    reactionRevision: 1,
    reactions: [{ reactionId: 'heart', type: 'emoji', value: '❤️', count: 1, mine: true, previewParticipantIds: [7] }],
    myReactions: [{ reactionId: 'heart', type: 'emoji', value: '❤️', createdAt: '2026-09-26T14:00:00Z' }],
    catalogVersion: 1
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCalls.length, 2, 'queued REMOVE was not released after ADD confirmation');
  assert.equal(fetchCalls[1].init.method, 'DELETE', 'second tap must send explicit REMOVE');

  fetchQueue.shift().resolve(response({
    ok: true,
    changed: true,
    messageId: 10,
    reactionRevision: 2,
    reactions: [],
    myReactions: [],
    catalogVersion: 1
  }));
  await Promise.all([add, remove]);
  assert.equal(manager.get('room-a', 10).reactions.length, 0, 'authoritative ADD/REMOVE sequence ended in wrong state');

  manager.applyAuthoritative('room-a', 10, {
    messageId: 10,
    reactionRevision: 3,
    reactions: [
      { reactionId: 'joy', type: 'emoji', value: '😂', count: 1, mine: true, previewParticipantIds: [7] },
      { reactionId: 'heart', type: 'emoji', value: '❤️', count: 1, mine: true, previewParticipantIds: [7] },
      { reactionId: 'fire', type: 'emoji', value: '🔥', count: 1, mine: true, previewParticipantIds: [7] }
    ],
    myReactions: [
      { reactionId: 'joy', type: 'emoji', value: '😂', createdAt: '2026-09-26T14:01:00Z' },
      { reactionId: 'heart', type: 'emoji', value: '❤️', createdAt: '2026-09-26T14:02:00Z' },
      { reactionId: 'fire', type: 'emoji', value: '🔥', createdAt: '2026-09-26T14:03:00Z' }
    ],
    catalogVersion: 1
  });

  const fourth = manager.toggleReaction({
    roomId: 'room-a',
    messageId: 10,
    reactionId: 'thumb_up',
    reaction: { reactionId: 'thumb_up', type: 'emoji', value: '👍', enabled: true }
  });
  assert.deepEqual(
    manager.get('room-a', 10).myReactions.map((item) => item.reactionId),
    ['heart', 'fire', 'thumb_up'],
    'optimistic fourth reaction does not evict the oldest reaction FIFO'
  );
  fetchQueue.shift().resolve(response({
    ok: true,
    changed: true,
    messageId: 10,
    reactionRevision: 4,
    reactions: [
      { reactionId: 'heart', type: 'emoji', value: '❤️', count: 1, mine: true, previewParticipantIds: [7] },
      { reactionId: 'fire', type: 'emoji', value: '🔥', count: 1, mine: true, previewParticipantIds: [7] },
      { reactionId: 'thumb_up', type: 'emoji', value: '👍', count: 1, mine: true, previewParticipantIds: [7] }
    ],
    myReactions: [
      { reactionId: 'heart', type: 'emoji', value: '❤️', createdAt: '2026-09-26T14:02:00Z' },
      { reactionId: 'fire', type: 'emoji', value: '🔥', createdAt: '2026-09-26T14:03:00Z' },
      { reactionId: 'thumb_up', type: 'emoji', value: '👍', createdAt: '2026-09-26T14:04:00Z' }
    ],
    catalogVersion: 1
  }));
  await fourth;

  const beforeFailureCalls = fetchCalls.length;
  const failed = manager.toggleReaction({
    roomId: 'room-a',
    messageId: 10,
    reactionId: 'clap',
    reaction: { reactionId: 'clap', type: 'emoji', value: '👏', enabled: true }
  });
  assert(manager.get('room-a', 10).myReactions.some((item) => item.reactionId === 'clap'), 'failure test has no optimistic state');
  fetchQueue.shift().reject(new Error('network down'));
  await assert.rejects(failed);
  assert.equal(fetchCalls.length, beforeFailureCalls + 1, 'failed reaction was automatically retried');
  assert.equal(manager.get('room-a', 10).myReactions.some((item) => item.reactionId === 'clap'), false, 'network failure did not roll back optimistic reaction');

  console.log('Build 188.4 reaction interaction/mutation regression: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
