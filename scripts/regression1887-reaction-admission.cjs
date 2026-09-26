const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.FPCHAT_TEST_ROOT || path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const arbiterSource = read('src/reaction-mutation-arbiter188.js');
const reactionServer = read('src/message-reactions188.js');
const server = read('server.js');

new Function(arbiterSource);
new Function(reactionServer);
new Function(server);

const {
  createReactionMutationArbiter188,
  WINDOW_MS,
  USER_BURST_LIMIT,
  ROOM_MIN_BUDGET,
  ROOM_PER_ONLINE,
  ROOM_MAX_BUDGET,
  ROOM_QUEUE_MULTIPLIER
} = require(path.join(root, 'src/reaction-mutation-arbiter188.js'));

assert.equal(WINDOW_MS, 5000, 'reaction admission window changed');
assert.equal(USER_BURST_LIMIT, 20, 'per-user reaction burst guard changed');
assert.equal(ROOM_MIN_BUDGET, 40, 'minimum room reaction budget changed');
assert.equal(ROOM_PER_ONLINE, 1, 'online participant coefficient changed');
assert.equal(ROOM_MAX_BUDGET, 250, 'maximum room reaction budget changed');
assert.equal(ROOM_QUEUE_MULTIPLIER, 1, 'room overflow queue multiplier changed');

assert(arbiterSource.includes("owner: 'FPReactionMutationArbiter188'"), 'server reaction arbiter ownership changed');
assert(arbiterSource.includes("throw admissionError('REACTION_RATE_LIMITED', 429"), 'per-user guard missing');
assert(arbiterSource.includes("throw admissionError('REACTION_BUSY', 503"), 'bounded room overflow guard missing');
assert(arbiterSource.includes('room.pending >= maxPending(room)'), 'room pending queue is not bounded');
assert(arbiterSource.includes('room.waiters.push(waiter)'), 'normal room budget overflow is not queued');
assert(arbiterSource.includes('room.timer?.unref?.()'), 'room wake timer is not unrefed');
assert(arbiterSource.includes('room.idleTimer?.unref?.()'), 'idle admission state cleanup timer is not unrefed');
assert(!arbiterSource.includes('setInterval('), 'reaction admission introduced polling');
assert(!arbiterSource.includes('localStorage'), 'server reaction queue became persistent');
assert(!arbiterSource.includes('indexedDB'), 'server reaction queue became persistent');

assert(reactionServer.includes('getOnlineParticipantCount = null'), 'reaction server does not accept online admission source');
assert(reactionServer.includes('createReactionMutationArbiter188({ getOnlineParticipantCount })'), 'reaction server does not wire online admission');
assert(reactionServer.includes('actorId: auth.participant.id'), 'per-user guard is not keyed by participant identity');
assert(reactionServer.includes("res.setHeader('Retry-After'"), '429/503 retry metadata header missing');
assert(reactionServer.includes('retryAfterMs'), '429/503 retry metadata body missing');

assert(server.includes('getOnlineParticipantCount: countOnlineRoomParticipants188'), 'server composition does not feed online participants to reaction arbiter');
assert(server.includes('function countOnlineRoomParticipants188(roomId)'), 'live online participant counter missing');
assert(server.includes('for (const participant of q.listParticipantsByRoom.all(id))'), 'online budget is not scoped to room participants');
assert(server.includes('if (hasVisibleSocketForDevice(participant.device_id)) count += 1;'), 'online budget does not use live visible WebSocket presence');
assert(!server.includes('countOnlineParticipants188'), 'unexpected second online reaction counter introduced');

function createFakeClock() {
  let current = 0;
  let seq = 0;
  const timers = [];

  function schedule(fn, ms) {
    const timer = {
      id: ++seq,
      at: current + Math.max(0, Number(ms) || 0),
      fn,
      cancelled: false,
      unref() {}
    };
    timers.push(timer);
    return timer;
  }

  function cancelSchedule(timer) {
    if (timer) timer.cancelled = true;
  }

  async function flush() {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  }

  async function advance(ms) {
    current += ms;
    let ran = true;
    while (ran) {
      ran = false;
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      for (const timer of timers) {
        if (timer.cancelled || timer.at > current) continue;
        timer.cancelled = true;
        timer.fn();
        ran = true;
        await flush();
      }
    }
  }

  return {
    now: () => current,
    schedule,
    cancelSchedule,
    advance,
    flush
  };
}

(async () => {
  // Adaptive room budget uses online participants only.
  {
    const clock = createFakeClock();
    const online = new Map([[1, 2], [2, 100], [3, 500], [4, 0]]);
    const arbiter = createReactionMutationArbiter188({
      getOnlineParticipantCount: (roomId) => online.get(roomId) || 0,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule
    });

    await arbiter.enqueue(1, 101, async () => 'ok', { actorId: 1 });
    await arbiter.enqueue(2, 201, async () => 'ok', { actorId: 2 });
    await arbiter.enqueue(3, 301, async () => 'ok', { actorId: 3 });
    await arbiter.enqueue(4, 401, async () => 'ok', { actorId: 4 });

    const byRoom = new Map(arbiter.snapshot().rooms.map((room) => [room.roomId, room]));
    assert.equal(byRoom.get(1)?.online, 2);
    assert.equal(byRoom.get(1)?.budget, 40);
    assert.equal(byRoom.get(2)?.online, 100);
    assert.equal(byRoom.get(2)?.budget, 100);
    assert.equal(byRoom.get(3)?.online, 500);
    assert.equal(byRoom.get(3)?.budget, 250);
    assert.equal(byRoom.get(4)?.online, 0);
    assert.equal(byRoom.get(4)?.budget, 40);
  }

  // Normal overflow waits until the next admission window instead of being dropped.
  {
    const clock = createFakeClock();
    const started = [];
    const arbiter = createReactionMutationArbiter188({
      getOnlineParticipantCount: () => 2,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule
    });

    const promises = [];
    for (let i = 1; i <= 41; i += 1) {
      promises.push(arbiter.enqueue(10, 1000 + i, async () => {
        started.push(i);
        return i;
      }, { actorId: i }));
    }

    await clock.flush();
    assert.equal(started.length, 40, 'room minimum budget should admit exactly 40 operations in the first window');
    const before = arbiter.snapshot().rooms.find((room) => room.roomId === 10);
    assert.equal(before?.budget, 40);
    assert.equal(before?.waiters, 1, '41st operation should wait in bounded room queue');

    await clock.advance(5000);
    await Promise.all(promises);
    assert.equal(started.length, 41, 'queued room overflow was not released in the next window');
    assert.equal(arbiter.snapshot().stats.busyRejected, 0, 'normal overflow was incorrectly rejected');
  }

  // Queue cap is finite: budget 40 + one-window queue 40 = max 80 pending.
  {
    const clock = createFakeClock();
    const never = () => new Promise(() => {});
    const arbiter = createReactionMutationArbiter188({
      getOnlineParticipantCount: () => 2,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule
    });

    for (let i = 1; i <= 80; i += 1) {
      void arbiter.enqueue(20, 2000 + i, never, { actorId: i });
    }
    await clock.flush();
    const state = arbiter.snapshot().rooms.find((room) => room.roomId === 20);
    assert.equal(state?.budget, 40);
    assert.equal(state?.queueCapacity, 40);
    assert.equal(state?.maxPending, 80);
    assert.equal(state?.pending, 80);

    await assert.rejects(
      arbiter.enqueue(20, 9999, async () => true, { actorId: 9999 }),
      (error) => error?.code === 'REACTION_BUSY'
        && error?.status === 503
        && Number(error?.retryAfterMs) > 0,
      'room queue cap did not return 503 REACTION_BUSY'
    );
  }

  // One participant cannot spam across many messages and bypass the room budget.
  {
    const clock = createFakeClock();
    const arbiter = createReactionMutationArbiter188({
      getOnlineParticipantCount: () => 100,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule
    });

    const first = [];
    for (let i = 1; i <= 20; i += 1) {
      first.push(arbiter.enqueue(30, 3000 + i, async () => i, { actorId: 77 }));
    }
    await Promise.all(first);

    await assert.rejects(
      arbiter.enqueue(30, 3999, async () => true, { actorId: 77 }),
      (error) => error?.code === 'REACTION_RATE_LIMITED'
        && error?.status === 429
        && Number(error?.retryAfterMs) > 0,
      'per-user reaction burst guard did not trigger'
    );

    await clock.advance(5000);
    const afterWindow = await arbiter.enqueue(30, 4000, async () => 'accepted', { actorId: 77 });
    assert.equal(afterWindow, 'accepted', 'per-user reaction burst did not recover after the window');
  }

  // Same-message FIFO remains intact under the new room admission layer.
  {
    const clock = createFakeClock();
    const order = [];
    const arbiter = createReactionMutationArbiter188({
      getOnlineParticipantCount: () => 500,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule
    });

    const first = arbiter.enqueue(40, 5000, async () => {
      order.push('first:start');
      await Promise.resolve();
      order.push('first:end');
    }, { actorId: 1 });
    const second = arbiter.enqueue(40, 5000, async () => {
      order.push('second:start');
      order.push('second:end');
    }, { actorId: 2 });

    await Promise.all([first, second]);
    assert(order.indexOf('first:end') < order.indexOf('second:start'), 'adaptive admission broke per-message FIFO');
  }

  console.log('Build 188.7 adaptive reaction admission regression: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
