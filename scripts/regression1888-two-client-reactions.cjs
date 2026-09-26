const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const arbiterSource = read('public/reaction-arbiter188.js');
const managerSource = read('public/reaction-manager188.js');
const rawCatalog = JSON.parse(read('public/reactions-catalog188.json'));

new Function(arbiterSource);
new Function(managerSource);

function publicCatalogFromRaw() {
  return {
    ok: true,
    version: rawCatalog.version,
    maxPerParticipantPerMessage: rawCatalog.maxPerParticipantPerMessage,
    quickLimit: rawCatalog.quickLimit,
    reactions: rawCatalog.reactions.map((item) => ({
      id: item.id,
      type: item.type,
      value: item.value,
      category: item.category,
      enabled: item.enabled,
      ...(item.quickOrder != null ? { quickOrder: item.quickOrder } : {})
    }))
  };
}

function eventClass(type, init) {
  this.type = type;
  this.detail = init?.detail;
}

function makeSignal() {
  return {
    aborted: false,
    reason: null,
    addEventListener() {},
    removeEventListener() {}
  };
}

const roomId = 'room-two-client';
const messageId = 10;
let revision = 0;
const active = [];
const clients = [];

function descriptor(id) {
  const item = rawCatalog.reactions.find((entry) => entry.id === id);
  if (!item) throw new Error('unknown reaction in fake server');
  return { reactionId: item.id, type: item.type, value: item.value };
}

function serverSummary(viewerId = null) {
  const byReaction = new Map();
  for (const row of active) {
    let list = byReaction.get(row.reactionId);
    if (!list) byReaction.set(row.reactionId, list = []);
    list.push(row);
  }
  const reactions = [...byReaction.entries()].map(([reactionId, rows]) => {
    const info = descriptor(reactionId);
    const ordered = [...rows].sort((a, b) => b.seq - a.seq);
    const result = {
      ...info,
      count: rows.length,
      ...(viewerId != null ? { mine: rows.some((row) => row.participantId === viewerId) } : {})
    };
    if (rows.length <= 2) result.previewParticipantIds = ordered.map((row) => row.participantId);
    return result;
  }).sort((a, b) => b.count - a.count || a.reactionId.localeCompare(b.reactionId));

  const myRows = viewerId == null
    ? []
    : active.filter((row) => row.participantId === viewerId).sort((a, b) => a.seq - b.seq);

  return {
    messageId,
    reactionRevision: revision,
    reactions,
    ...(viewerId != null ? {
      myReactions: myRows.map((row) => ({ ...descriptor(row.reactionId), createdAt: row.createdAt }))
    } : {}),
    catalogVersion: rawCatalog.version
  };
}

let seq = 0;
function serverMutate(participantId, reactionId, operation) {
  const existingIndex = active.findIndex((row) => row.participantId === participantId && row.reactionId === reactionId);
  let changed = false;
  if (operation === 'add') {
    if (existingIndex < 0) {
      const own = active.filter((row) => row.participantId === participantId).sort((a, b) => a.seq - b.seq);
      while (own.length >= rawCatalog.maxPerParticipantPerMessage) {
        const oldest = own.shift();
        const index = active.findIndex((row) => row.seq === oldest.seq);
        if (index >= 0) active.splice(index, 1);
      }
      active.push({
        participantId,
        reactionId,
        seq: ++seq,
        createdAt: new Date(1700000000000 + seq * 1000).toISOString()
      });
      changed = true;
    }
  } else {
    if (existingIndex >= 0) {
      active.splice(existingIndex, 1);
      changed = true;
    }
  }
  if (changed) revision += 1;
  return changed;
}

function broadcast(changedParticipantId) {
  const neutral = serverSummary(null);
  const changedIds = active
    .filter((row) => row.participantId === changedParticipantId)
    .sort((a, b) => a.seq - b.seq)
    .map((row) => row.reactionId);
  const payload = {
    type: 'reaction:update',
    roomId,
    messageId,
    reactionRevision: neutral.reactionRevision,
    reactions: neutral.reactions,
    catalogVersion: neutral.catalogVersion,
    changedParticipantId,
    changedParticipantReactions: changedIds
  };
  for (const client of clients) client.manager.ingestWs(payload, client.participantId);
}

function createClient(participantId) {
  const listeners = new Map();
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
        return { roomId, generation: 1, signal: makeSignal() };
      }
    }
  };
  new Function('window', 'CustomEvent', arbiterSource)(windowObject, eventClass);

  const state = { roomId, me: { id: participantId, displayName: `User ${participantId}` } };
  const STORAGE = {
    roomState: (id) => `room:${id}`,
    get: () => ({ deviceId: `device-${participantId}` })
  };

  async function fakeFetch(url, init = {}) {
    const value = String(url);
    if (value === '/api/reactions/catalog') {
      return { ok: true, status: 200, json: async () => publicCatalogFromRaw() };
    }

    const match = value.match(/\/api\/rooms\/([^/]+)\/messages\/(\d+)\/reactions\/([^/?]+)/);
    assert(match, `unexpected reaction URL: ${value}`);
    assert.equal(decodeURIComponent(match[1]), roomId);
    assert.equal(Number(match[2]), messageId);
    const reactionId = decodeURIComponent(match[3]);
    const operation = init.method === 'PUT' ? 'add' : init.method === 'DELETE' ? 'remove' : null;
    assert(operation, 'mutation did not use explicit PUT/DELETE');

    const changed = serverMutate(participantId, reactionId, operation);
    if (changed) broadcast(participantId);
    const summary = serverSummary(participantId);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, changed, ...summary })
    };
  }

  class AbortControllerFake {
    constructor() { this.signal = makeSignal(); }
    abort(reason) { this.signal.aborted = true; this.signal.reason = reason; }
  }
  class DOMExceptionFake extends Error {
    constructor(message, name) { super(message); this.name = name; }
  }

  new Function(
    'window', 'CustomEvent', 'fetch', 'queueMicrotask', 'state', 'STORAGE',
    'activeChatDeviceId', 'AbortController', 'DOMException',
    managerSource
  )(
    windowObject, eventClass, fakeFetch, queueMicrotask, state, STORAGE,
    `device-${participantId}`, AbortControllerFake, DOMExceptionFake
  );

  const client = { participantId, window: windowObject, manager: windowObject.FPReactionManager188 };
  client.manager.syncHistoryRange(roomId, [messageId]);
  clients.push(client);
  return client;
}

(async () => {
  const first = createClient(1);
  const second = createClient(2);

  const quick = await first.manager.getQuickReactions();
  assert.deepEqual(
    quick.map((item) => item.value),
    ['😂', '❤️', '👍', '👎', '🔥', '🥰', '👏'],
    'physical acceptance quick strip differs from accepted set'
  );
  assert.equal(quick.length, 7);

  const addFirst = first.manager.toggleReaction({
    roomId,
    messageId,
    reactionId: 'heart',
    reaction: { reactionId: 'heart', type: 'emoji', value: '❤️', enabled: true }
  });
  const firstOptimistic = first.manager.get(roomId, messageId);
  assert.equal(firstOptimistic.reactions[0]?.reactionId, 'heart');
  assert.equal(firstOptimistic.reactions[0]?.mine, true);
  await addFirst;

  let firstState = first.manager.get(roomId, messageId);
  let secondState = second.manager.get(roomId, messageId);
  assert.equal(firstState.reactions[0]?.count, 1);
  assert.equal(firstState.reactions[0]?.mine, true);
  assert.deepEqual(firstState.reactions[0]?.previewParticipantIds, [1]);
  assert.equal(secondState.reactions[0]?.count, 1);
  assert.equal(secondState.reactions[0]?.mine, false);
  assert.deepEqual(secondState.reactions[0]?.previewParticipantIds, [1]);

  const addSecond = second.manager.toggleReaction({
    roomId,
    messageId,
    reactionId: 'heart',
    reaction: { reactionId: 'heart', type: 'emoji', value: '❤️', enabled: true }
  });
  const secondOptimistic = second.manager.get(roomId, messageId);
  assert.equal(secondOptimistic.reactions[0]?.count, 2);
  assert.equal(secondOptimistic.reactions[0]?.mine, true);
  await addSecond;

  firstState = first.manager.get(roomId, messageId);
  secondState = second.manager.get(roomId, messageId);
  assert.equal(firstState.reactions[0]?.count, 2);
  assert.equal(firstState.reactions[0]?.mine, true);
  assert.deepEqual(firstState.reactions[0]?.previewParticipantIds, [2, 1]);
  assert.equal(secondState.reactions[0]?.count, 2);
  assert.equal(secondState.reactions[0]?.mine, true);
  assert.deepEqual(secondState.reactions[0]?.previewParticipantIds, [2, 1]);

  await first.manager.toggleReaction({
    roomId,
    messageId,
    reactionId: 'heart',
    reaction: { reactionId: 'heart', type: 'emoji', value: '❤️', enabled: true }
  });

  firstState = first.manager.get(roomId, messageId);
  secondState = second.manager.get(roomId, messageId);
  assert.equal(firstState.reactions[0]?.count, 1);
  assert.equal(firstState.reactions[0]?.mine, false);
  assert.deepEqual(firstState.reactions[0]?.previewParticipantIds, [2]);
  assert.equal(secondState.reactions[0]?.count, 1);
  assert.equal(secondState.reactions[0]?.mine, true);
  assert.deepEqual(secondState.reactions[0]?.previewParticipantIds, [2]);

  console.log('Build 188.8 two-client reaction flow: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
