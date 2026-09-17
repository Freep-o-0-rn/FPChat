/* Build 170: room/operation context owner foundation.
   First stage only defines ownership and cancellation semantics; legacy chat logic
   keeps running until each path is migrated and regression-tested. */
(() => {
  if (window.FPRoomContext170) return;

  let generation = 0;
  let currentRoomContext = null;
  let nextOperationId = 1;
  const operations = new Map();

  function normalizeRoomId(value) {
    return String(value || '').trim();
  }

  function publicContext(context) {
    if (!context) return null;
    return {
      roomId: context.roomId,
      generation: context.generation,
      aborted: context.signal.aborted,
      startedAt: context.startedAt
    };
  }

  function dispatch(type, context, extra = {}) {
    try {
      window.dispatchEvent(new CustomEvent(type, {
        detail: { ...publicContext(context), ...extra }
      }));
    } catch {}
  }

  function beginRoom(roomId, key = null) {
    const id = normalizeRoomId(roomId);
    if (!id) throw new Error('roomId required');

    const previous = currentRoomContext;
    if (previous && !previous.signal.aborted) {
      try { previous.controller.abort('room-context-replaced'); } catch { previous.controller.abort(); }
      dispatch('fpchat:room-context-ended', previous, { reason: 'replaced' });
    }

    const controller = new AbortController();
    const context = Object.freeze({
      roomId: id,
      generation: ++generation,
      key,
      controller,
      signal: controller.signal,
      startedAt: performance.now()
    });
    currentRoomContext = context;
    dispatch('fpchat:room-context-changed', context);
    return context;
  }

  function current() {
    return currentRoomContext;
  }

  function isCurrent(context) {
    return Boolean(
      context
      && currentRoomContext === context
      && context.generation === currentRoomContext.generation
      && context.roomId === currentRoomContext.roomId
      && !context.signal.aborted
    );
  }

  function guard(context) {
    if (!isCurrent(context)) {
      const error = new DOMException('Stale room context', 'AbortError');
      error.fpStaleRoomContext = true;
      throw error;
    }
    return context;
  }

  function endRoom(context = currentRoomContext, reason = 'ended') {
    if (!context) return false;
    if (!context.signal.aborted) {
      try { context.controller.abort(String(reason || 'ended')); } catch { context.controller.abort(); }
    }
    if (currentRoomContext === context) currentRoomContext = null;
    dispatch('fpchat:room-context-ended', context, { reason: String(reason || 'ended') });
    return true;
  }

  // Long-running sends/uploads are not children of the visible room context.
  // They survive navigation until explicitly completed/cancelled by their owner.
  function beginOperation(roomId, kind = 'operation') {
    const id = normalizeRoomId(roomId);
    if (!id) throw new Error('roomId required');
    const controller = new AbortController();
    const operation = Object.freeze({
      id: nextOperationId++,
      roomId: id,
      kind: String(kind || 'operation').slice(0, 40),
      controller,
      signal: controller.signal,
      startedAt: performance.now()
    });
    operations.set(operation.id, operation);
    dispatch('fpchat:operation-started', null, { operationId: operation.id, kind: operation.kind });
    return operation;
  }

  function finishOperation(operation, status = 'complete') {
    if (!operation || !operations.has(operation.id)) return false;
    operations.delete(operation.id);
    dispatch('fpchat:operation-ended', null, { operationId: operation.id, kind: operation.kind, status: String(status || 'complete') });
    return true;
  }

  function cancelOperation(operation, reason = 'cancelled') {
    if (!operation || !operations.has(operation.id)) return false;
    try { operation.controller.abort(String(reason || 'cancelled')); } catch { operation.controller.abort(); }
    operations.delete(operation.id);
    dispatch('fpchat:operation-ended', null, { operationId: operation.id, kind: operation.kind, status: 'cancelled' });
    return true;
  }

  function snapshot() {
    return {
      generation,
      current: publicContext(currentRoomContext),
      operations: [...operations.values()].map((operation) => ({
        id: operation.id,
        kind: operation.kind,
        aborted: operation.signal.aborted,
        ageMs: Math.round(performance.now() - operation.startedAt)
      }))
    };
  }

  window.FPRoomContext170 = Object.freeze({
    beginRoom,
    current,
    isCurrent,
    guard,
    endRoom,
    beginOperation,
    finishOperation,
    cancelOperation,
    snapshot
  });

  try { window.FPRuntime?.registerOwner?.('room-context170', { role: 'room-context', mode: 'migration' }); } catch {}
})();
