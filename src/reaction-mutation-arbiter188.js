/* Build 188.7: server-side reaction mutation ordering + adaptive room admission.
   One FIFO lane per room+message. Room throughput is bounded from unique online
   participants only; overflow waits in bounded RAM and is never persisted. */

const WINDOW_MS = 5000;
const USER_BURST_LIMIT = 20;
const ROOM_MIN_BUDGET = 40;
const ROOM_PER_ONLINE = 1;
const ROOM_MAX_BUDGET = 250;
const ROOM_QUEUE_MULTIPLIER = 1;

function reactionLaneKey(roomId, messageId) {
  const room = Number(roomId);
  const message = Number(messageId);
  if (!Number.isSafeInteger(room) || room <= 0 || !Number.isSafeInteger(message) || message <= 0) return '';
  return `${room}:${message}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cancellationError(code = 'REACTION_CANCELLED') {
  const error = new Error(code);
  error.code = code;
  return error;
}

function admissionError(code, status, retryAfterMs) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) error.retryAfterMs = Math.ceil(retryAfterMs);
  return error;
}

function createReactionMutationArbiter188({
  getOnlineParticipantCount = null,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancelSchedule = (timer) => clearTimeout(timer)
} = {}) {
  const lanes = new Map();
  const rooms = new Map();
  let sequence = 0;
  const stats = {
    enqueued: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    admitted: 0,
    rateRejected: 0,
    busyRejected: 0,
    roomQueued: 0,
    peakLanes: 0,
    peakQueued: 0,
    peakRoomPending: 0,
    peakRoomWaiters: 0
  };

  function onlineCount(roomId) {
    if (typeof getOnlineParticipantCount !== 'function') return 1;
    try {
      const value = Number(getOnlineParticipantCount(Number(roomId)));
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  function budgetForOnline(count) {
    const online = Math.max(1, Number(count) || 0);
    return clamp(
      Math.ceil(online * ROOM_PER_ONLINE),
      ROOM_MIN_BUDGET,
      ROOM_MAX_BUDGET
    );
  }

  function roomFor(roomId, create = true) {
    const id = Number(roomId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    let room = rooms.get(id);
    if (!room && create) {
      const at = Number(now());
      const online = onlineCount(id);
      const budget = budgetForOnline(online);
      room = {
        roomId: id,
        windowStartedAt: Number.isFinite(at) ? at : Date.now(),
        online,
        budget,
        used: 0,
        pending: 0,
        waiters: [],
        timer: null,
        idleTimer: null,
        lastIngressAt: Number.isFinite(at) ? at : Date.now(),
        actorBursts: new Map()
      };
      rooms.set(id, room);
    }
    return room || null;
  }

  function refreshWindow(room, at = Number(now())) {
    if (!room) return;
    const current = Number.isFinite(at) ? at : Date.now();
    if (current - room.windowStartedAt < WINDOW_MS) return;
    room.windowStartedAt = current;
    room.used = 0;
    room.online = onlineCount(room.roomId);
    room.budget = budgetForOnline(room.online);
  }

  function queueCapacity(room) {
    return Math.max(ROOM_MIN_BUDGET, Math.ceil(room.budget * ROOM_QUEUE_MULTIPLIER));
  }

  function maxPending(room) {
    return room.budget + queueCapacity(room);
  }

  function pruneActorBurst(room, actorKey, at) {
    if (!actorKey) return [];
    let burst = room.actorBursts.get(actorKey);
    if (!burst) {
      burst = [];
      room.actorBursts.set(actorKey, burst);
      return burst;
    }
    while (burst.length && at - burst[0] >= WINDOW_MS) burst.shift();
    if (!burst.length) room.actorBursts.set(actorKey, burst);
    return burst;
  }

  function admitIngress(roomId, actorId) {
    const room = roomFor(roomId, true);
    if (!room) throw new TypeError('valid roomId is required');
    const at = Number(now());
    refreshWindow(room, at);

    if (room.pending >= maxPending(room)) {
      stats.busyRejected += 1;
      const retry = Math.max(1, room.windowStartedAt + WINDOW_MS - at);
      throw admissionError('REACTION_BUSY', 503, retry);
    }

    const actorKey = String(actorId ?? '').trim();
    if (actorKey) {
      const burst = pruneActorBurst(room, actorKey, at);
      if (burst.length >= USER_BURST_LIMIT) {
        stats.rateRejected += 1;
        const retry = Math.max(1, burst[0] + WINDOW_MS - at);
        throw admissionError('REACTION_RATE_LIMITED', 429, retry);
      }
      burst.push(at);
    }

    room.pending += 1;
    room.lastIngressAt = at;
    if (room.idleTimer) {
      try { cancelSchedule(room.idleTimer); } catch {}
      room.idleTimer = null;
    }
    stats.peakRoomPending = Math.max(stats.peakRoomPending, room.pending);
    return room;
  }

  function clearRoomTimer(room) {
    if (!room?.timer) return;
    try { cancelSchedule(room.timer); } catch {}
    room.timer = null;
  }

  function cleanupRoom(room) {
    if (!room || room.pending > 0 || room.waiters.length) return;
    clearRoomTimer(room);
    const at = Number(now());
    const current = Number.isFinite(at) ? at : Date.now();
    const idleFor = current - Number(room.lastIngressAt || current);
    if (idleFor >= WINDOW_MS) {
      if (room.idleTimer) {
        try { cancelSchedule(room.idleTimer); } catch {}
        room.idleTimer = null;
      }
      rooms.delete(room.roomId);
      return;
    }
    if (room.idleTimer) return;
    room.idleTimer = schedule(() => {
      room.idleTimer = null;
      cleanupRoom(room);
    }, Math.max(1, WINDOW_MS - idleFor));
    room.idleTimer?.unref?.();
  }

  function settleRoomPending(roomId) {
    const room = roomFor(roomId, false);
    if (!room) return;
    room.pending = Math.max(0, room.pending - 1);
    cleanupRoom(room);
  }

  function scheduleRoomWake(room) {
    if (!room || room.timer || !room.waiters.length) return;
    const at = Number(now());
    refreshWindow(room, at);
    if (room.used < room.budget) {
      drainRoomWaiters(room);
      return;
    }
    const waitMs = Math.max(1, room.windowStartedAt + WINDOW_MS - at);
    room.timer = schedule(() => {
      room.timer = null;
      drainRoomWaiters(room);
    }, waitMs);
    room.timer?.unref?.();
  }

  function drainRoomWaiters(room) {
    if (!room) return;
    const at = Number(now());
    refreshWindow(room, at);
    while (room.waiters.length && room.used < room.budget) {
      const waiter = room.waiters.shift();
      if (waiter.entry.cancelled || waiter.entry.generation !== waiter.lane.generation) {
        waiter.entry.admissionWaiter = null;
        waiter.reject(cancellationError(waiter.entry.cancelCode || 'REACTION_CANCELLED'));
        continue;
      }
      room.used += 1;
      stats.admitted += 1;
      waiter.entry.admissionWaiter = null;
      waiter.resolve();
    }
    stats.peakRoomWaiters = Math.max(stats.peakRoomWaiters, room.waiters.length);
    if (room.waiters.length) scheduleRoomWake(room);
    else clearRoomTimer(room);
  }

  function acquireRoomPermit(roomId, lane, entry) {
    const room = roomFor(roomId, true);
    const at = Number(now());
    refreshWindow(room, at);
    if (entry.cancelled || entry.generation !== lane.generation) {
      return Promise.reject(cancellationError(entry.cancelCode || 'REACTION_CANCELLED'));
    }
    if (room.used < room.budget) {
      room.used += 1;
      stats.admitted += 1;
      return Promise.resolve();
    }
    stats.roomQueued += 1;
    return new Promise((resolve, reject) => {
      const waiter = { lane, entry, resolve, reject };
      entry.admissionWaiter = waiter;
      room.waiters.push(waiter);
      stats.peakRoomWaiters = Math.max(stats.peakRoomWaiters, room.waiters.length);
      scheduleRoomWake(room);
    });
  }

  function removeAdmissionWaiter(entry, code = 'REACTION_CANCELLED') {
    const waiter = entry?.admissionWaiter;
    if (!waiter) return false;
    const room = roomFor(waiter.lane.roomId, false);
    if (!room) return false;
    const index = room.waiters.indexOf(waiter);
    if (index < 0) return false;
    room.waiters.splice(index, 1);
    entry.admissionWaiter = null;
    waiter.reject(cancellationError(code));
    if (!room.waiters.length) clearRoomTimer(room);
    return true;
  }

  function laneFor(roomId, messageId, create = true) {
    const key = reactionLaneKey(roomId, messageId);
    if (!key) return null;
    let lane = lanes.get(key);
    if (!lane && create) {
      lane = {
        key,
        roomId: Number(roomId),
        messageId: Number(messageId),
        running: false,
        current: null,
        queue: [],
        generation: 0
      };
      lanes.set(key, lane);
      stats.peakLanes = Math.max(stats.peakLanes, lanes.size);
    }
    return lane || null;
  }

  function cleanupLane(lane) {
    if (!lane || lane.running || lane.queue.length) return;
    if (lanes.get(lane.key) === lane) lanes.delete(lane.key);
  }

  async function drain(lane) {
    if (!lane || lane.running) return;
    lane.running = true;
    try {
      while (lane.queue.length) {
        const entry = lane.queue.shift();
        lane.current = entry;
        if (entry.cancelled || entry.generation !== lane.generation) {
          stats.cancelled += 1;
          entry.reject(cancellationError(entry.cancelCode || 'REACTION_CANCELLED'));
          settleRoomPending(entry.roomId);
          lane.current = null;
          continue;
        }
        try {
          await acquireRoomPermit(lane.roomId, lane, entry);
          if (entry.cancelled || entry.generation !== lane.generation) {
            throw cancellationError(entry.cancelCode || 'REACTION_CANCELLED');
          }
          entry.startedTask = true;
          const value = await entry.task();
          stats.completed += 1;
          entry.resolve(value);
        } catch (error) {
          if (String(error?.code || '').includes('CANCEL')) stats.cancelled += 1;
          else stats.failed += 1;
          entry.reject(error);
        } finally {
          entry.admissionWaiter = null;
          lane.current = null;
          settleRoomPending(entry.roomId);
        }
      }
    } finally {
      lane.running = false;
      cleanupLane(lane);
    }
  }

  function enqueue(roomId, messageId, task, { actorId = null } = {}) {
    if (typeof task !== 'function') return Promise.reject(new TypeError('reaction mutation task is required'));
    const lane = laneFor(roomId, messageId, true);
    if (!lane) return Promise.reject(new TypeError('valid roomId and messageId are required'));

    try {
      admitIngress(lane.roomId, actorId);
    } catch (error) {
      cleanupLane(lane);
      return Promise.reject(error);
    }

    const generation = lane.generation;
    stats.enqueued += 1;
    stats.peakQueued = Math.max(stats.peakQueued, lane.queue.length + (lane.running ? 1 : 0) + 1);
    return new Promise((resolve, reject) => {
      lane.queue.push({
        id: ++sequence,
        generation,
        roomId: lane.roomId,
        messageId: lane.messageId,
        actorId: actorId == null ? null : String(actorId),
        task,
        resolve,
        reject,
        cancelCode: null,
        cancelled: false,
        startedTask: false,
        admissionWaiter: null
      });
      void drain(lane);
    });
  }

  function cancelMessage(roomId, messageId, code = 'MESSAGE_DELETED') {
    const lane = laneFor(roomId, messageId, false);
    if (!lane) return 0;
    lane.generation += 1;
    let cancelled = 0;

    const current = lane.current;
    if (current && !current.startedTask) {
      current.cancelled = true;
      current.cancelCode = code;
      removeAdmissionWaiter(current, code);
      cancelled += 1;
    }

    const pending = lane.queue.splice(0);
    for (const entry of pending) {
      entry.cancelled = true;
      entry.cancelCode = code;
      stats.cancelled += 1;
      entry.reject(cancellationError(code));
      settleRoomPending(entry.roomId);
      cancelled += 1;
    }
    cleanupLane(lane);
    return cancelled;
  }

  function cancelRoom(roomId, code = 'ROOM_DELETED') {
    const room = Number(roomId);
    if (!Number.isSafeInteger(room) || room <= 0) return 0;
    let cancelled = 0;
    for (const lane of [...lanes.values()]) {
      if (lane.roomId !== room) continue;
      cancelled += cancelMessage(lane.roomId, lane.messageId, code);
    }
    const admissionRoom = roomFor(room, false);
    if (admissionRoom && !admissionRoom.pending) cleanupRoom(admissionRoom);
    return cancelled;
  }

  function snapshot() {
    let queued = 0;
    let running = 0;
    for (const lane of lanes.values()) {
      queued += lane.queue.length;
      if (lane.running) running += 1;
    }
    return {
      owner: 'FPReactionMutationArbiter188',
      lanes: lanes.size,
      queued,
      running,
      policy: {
        windowMs: WINDOW_MS,
        perUserBurst: USER_BURST_LIMIT,
        roomMinBudget: ROOM_MIN_BUDGET,
        roomPerOnline: ROOM_PER_ONLINE,
        roomMaxBudget: ROOM_MAX_BUDGET,
        queueMultiplier: ROOM_QUEUE_MULTIPLIER,
        onlineSource: typeof getOnlineParticipantCount === 'function' ? 'live callback' : 'fallback=1'
      },
      rooms: [...rooms.values()].map((room) => ({
        roomId: room.roomId,
        online: room.online,
        budget: room.budget,
        used: room.used,
        pending: room.pending,
        waiters: room.waiters.length,
        queueCapacity: queueCapacity(room),
        maxPending: maxPending(room)
      })),
      stats: { ...stats }
    };
  }

  return Object.freeze({ enqueue, cancelMessage, cancelRoom, snapshot });
}

module.exports = {
  reactionLaneKey,
  createReactionMutationArbiter188,
  WINDOW_MS,
  USER_BURST_LIMIT,
  ROOM_MIN_BUDGET,
  ROOM_PER_ONLINE,
  ROOM_MAX_BUDGET,
  ROOM_QUEUE_MULTIPLIER
};
