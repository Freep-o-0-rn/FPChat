/* Build 188.1: client-side reaction mutation arbiter.
   One FIFO lane per room+message, max 20 in-flight+queued operations per message.
   No persistence, retry or transport ownership. */
(() => {
  if (window.FPReactionArbiter188) return;

  const MAX_PER_MESSAGE = 20;
  const lanes = new Map();
  let sequence = 0;
  const stats = { enqueued: 0, completed: 0, failed: 0, cancelled: 0, rejectedFull: 0, peakLanes: 0, peakPending: 0 };

  function key(roomId, messageId) {
    const room = String(roomId || '').trim();
    const message = Number(messageId);
    if (!room || !Number.isSafeInteger(message) || message <= 0) return '';
    return `${room}:${message}`;
  }

  function error(code) {
    const value = new Error(code);
    value.code = code;
    return value;
  }

  function laneFor(roomId, messageId, create = true) {
    const laneKey = key(roomId, messageId);
    if (!laneKey) return null;
    let lane = lanes.get(laneKey);
    if (!lane && create) {
      lane = { key: laneKey, roomId: String(roomId), messageId: Number(messageId), running: false, queue: [], generation: 0 };
      lanes.set(laneKey, lane);
      stats.peakLanes = Math.max(stats.peakLanes, lanes.size);
    }
    return lane || null;
  }

  function totalPending(lane) {
    return lane ? lane.queue.length + (lane.running ? 1 : 0) : 0;
  }

  function cleanup(lane) {
    if (!lane || lane.running || lane.queue.length) return;
    if (lanes.get(lane.key) === lane) lanes.delete(lane.key);
  }

  async function drain(lane) {
    if (!lane || lane.running) return;
    lane.running = true;
    try {
      while (lane.queue.length) {
        const entry = lane.queue.shift();
        if (entry.generation !== lane.generation) {
          stats.cancelled += 1;
          entry.reject(error(entry.cancelCode || 'REACTION_CANCELLED'));
          continue;
        }
        try {
          const result = await entry.run();
          stats.completed += 1;
          entry.resolve(result);
        } catch (reason) {
          stats.failed += 1;
          entry.reject(reason);
        }
      }
    } finally {
      lane.running = false;
      cleanup(lane);
    }
  }

  function enqueue({ roomId, messageId, run } = {}) {
    if (typeof run !== 'function') return Promise.reject(new TypeError('reaction operation requires run()'));
    const lane = laneFor(roomId, messageId, true);
    if (!lane) return Promise.reject(new TypeError('reaction operation requires roomId + messageId'));
    if (totalPending(lane) >= MAX_PER_MESSAGE) {
      stats.rejectedFull += 1;
      return Promise.reject(error('REACTION_QUEUE_FULL'));
    }
    const generation = lane.generation;
    stats.enqueued += 1;
    stats.peakPending = Math.max(stats.peakPending, totalPending(lane) + 1);
    return new Promise((resolve, reject) => {
      lane.queue.push({ id: ++sequence, generation, run, resolve, reject, cancelCode: null });
      void drain(lane);
    });
  }

  function cancelMessage(roomId, messageId, code = 'REACTION_CANCELLED') {
    const lane = laneFor(roomId, messageId, false);
    if (!lane) return 0;
    lane.generation += 1;
    const queued = lane.queue.splice(0);
    for (const entry of queued) {
      stats.cancelled += 1;
      entry.reject(error(code));
    }
    cleanup(lane);
    return queued.length;
  }

  function cancelRoom(roomId, code = 'REACTION_ROOM_CANCELLED') {
    const room = String(roomId || '').trim();
    if (!room) return 0;
    let cancelled = 0;
    for (const lane of [...lanes.values()]) {
      if (lane.roomId !== room) continue;
      cancelled += cancelMessage(lane.roomId, lane.messageId, code);
    }
    return cancelled;
  }

  function hasPending(roomId, messageId) {
    return totalPending(laneFor(roomId, messageId, false)) > 0;
  }

  function snapshot() {
    let queued = 0;
    let running = 0;
    for (const lane of lanes.values()) {
      queued += lane.queue.length;
      if (lane.running) running += 1;
    }
    return {
      owner: 'FPReactionArbiter188',
      maxPerMessage: MAX_PER_MESSAGE,
      lanes: lanes.size,
      queued,
      running,
      stats: { ...stats }
    };
  }

  window.FPReactionArbiter188 = Object.freeze({ MAX_PER_MESSAGE, enqueue, cancelMessage, cancelRoom, hasPending, snapshot });

  const register = () => {
    try {
      window.FPRuntime?.registerOwner?.('reaction-arbiter188', {
        role: 'reaction-mutation-arbiter',
        mode: 'active-owner',
        scope: 'per-room-message FIFO',
        maxPerMessage: MAX_PER_MESSAGE,
        owns: 'ordering only; no transport/retry/persistence'
      });
    } catch {}
  };
  register();
  window.addEventListener?.('fpchat:boot-ready', register, { once: true, passive: true });
})();
