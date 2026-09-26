/* Build 188.1: server-side FIFO serialization for reaction mutations per room+message.
   Owns ordering/admission only. It does not own HTTP, WebSocket or SQLite business logic. */

function reactionLaneKey(roomId, messageId) {
  const room = Number(roomId);
  const message = Number(messageId);
  if (!Number.isSafeInteger(room) || room <= 0 || !Number.isSafeInteger(message) || message <= 0) return '';
  return `${room}:${message}`;
}

function cancellationError(code = 'REACTION_CANCELLED') {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createReactionMutationArbiter188() {
  const lanes = new Map();
  let sequence = 0;
  const stats = { enqueued: 0, completed: 0, failed: 0, cancelled: 0, peakLanes: 0, peakQueued: 0 };

  function laneFor(roomId, messageId, create = true) {
    const key = reactionLaneKey(roomId, messageId);
    if (!key) return null;
    let lane = lanes.get(key);
    if (!lane && create) {
      lane = { key, roomId: Number(roomId), messageId: Number(messageId), running: false, queue: [], generation: 0 };
      lanes.set(key, lane);
      stats.peakLanes = Math.max(stats.peakLanes, lanes.size);
    }
    return lane || null;
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
          entry.reject(cancellationError(entry.cancelCode || 'REACTION_CANCELLED'));
          continue;
        }
        try {
          const value = await entry.task();
          stats.completed += 1;
          entry.resolve(value);
        } catch (error) {
          stats.failed += 1;
          entry.reject(error);
        }
      }
    } finally {
      lane.running = false;
      cleanup(lane);
    }
  }

  function enqueue(roomId, messageId, task) {
    if (typeof task !== 'function') return Promise.reject(new TypeError('reaction mutation task is required'));
    const lane = laneFor(roomId, messageId, true);
    if (!lane) return Promise.reject(new TypeError('valid roomId and messageId are required'));
    const generation = lane.generation;
    stats.enqueued += 1;
    stats.peakQueued = Math.max(stats.peakQueued, lane.queue.length + (lane.running ? 1 : 0) + 1);
    return new Promise((resolve, reject) => {
      lane.queue.push({ id: ++sequence, generation, task, resolve, reject, cancelCode: null });
      void drain(lane);
    });
  }

  function cancelMessage(roomId, messageId, code = 'MESSAGE_DELETED') {
    const lane = laneFor(roomId, messageId, false);
    if (!lane) return 0;
    lane.generation += 1;
    const pending = lane.queue.splice(0);
    for (const entry of pending) {
      stats.cancelled += 1;
      entry.reject(cancellationError(code));
    }
    cleanup(lane);
    return pending.length;
  }

  function cancelRoom(roomId, code = 'ROOM_DELETED') {
    const room = Number(roomId);
    if (!Number.isSafeInteger(room) || room <= 0) return 0;
    let cancelled = 0;
    for (const lane of [...lanes.values()]) {
      if (lane.roomId !== room) continue;
      cancelled += cancelMessage(lane.roomId, lane.messageId, code);
    }
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
      stats: { ...stats }
    };
  }

  return Object.freeze({ enqueue, cancelMessage, cancelRoom, snapshot });
}

module.exports = { reactionLaneKey, createReactionMutationArbiter188 };
