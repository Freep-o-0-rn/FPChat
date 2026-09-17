/* Build 170: room/operation context owner.
   Visible-room transitions are separated from long-running send/upload operations.
   A pending room transition does not cancel the currently displayed room until
   the new room is ready to commit. */
(() => {
  if (window.FPRoomContext170) return;

  let generation = 0;
  let activeRoomContext = null;
  let pendingTransition = null;
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
      phase: context.phase,
      aborted: context.signal.aborted,
      startedAt: context.startedAt,
      committedAt: context.committedAt || null
    };
  }

  function dispatch(type, context, extra = {}) {
    try {
      window.dispatchEvent(new CustomEvent(type, {
        detail: { ...publicContext(context), ...extra }
      }));
    } catch {}
  }

  function abortContext(context, reason) {
    if (!context || context.signal.aborted) return;
    try { context.controller.abort(String(reason || 'cancelled')); }
    catch { context.controller.abort(); }
  }

  function createContext(roomId, phase, key = null) {
    const id = normalizeRoomId(roomId);
    if (!id) throw new Error('roomId required');
    const controller = new AbortController();
    return {
      roomId: id,
      generation: ++generation,
      phase,
      key,
      controller,
      signal: controller.signal,
      startedAt: performance.now(),
      committedAt: null
    };
  }

  function beginTransition(roomId) {
    if (pendingTransition) {
      abortContext(pendingTransition, 'superseded');
      dispatch('fpchat:room-transition-ended', pendingTransition, { reason: 'superseded' });
    }
    const context = createContext(roomId, 'pending');
    pendingTransition = context;
    dispatch('fpchat:room-transition-started', context);
    return context;
  }

  function isLatestTransition(context) {
    return Boolean(
      context
      && pendingTransition === context
      && context.phase === 'pending'
      && !context.signal.aborted
    );
  }

  function cancelTransition(context = pendingTransition, reason = 'cancelled') {
    if (!context || pendingTransition !== context) return false;
    abortContext(context, reason);
    pendingTransition = null;
    dispatch('fpchat:room-transition-ended', context, { reason: String(reason || 'cancelled') });
    return true;
  }

  function commitTransition(context, key = null) {
    if (!isLatestTransition(context)) return null;

    if (activeRoomContext && activeRoomContext !== context) {
      abortContext(activeRoomContext, 'room-replaced');
      dispatch('fpchat:room-context-ended', activeRoomContext, { reason: 'room-replaced' });
    }

    context.phase = 'active';
    context.key = key;
    context.committedAt = performance.now();
    activeRoomContext = context;
    pendingTransition = null;
    dispatch('fpchat:room-context-changed', context);
    dispatch('fpchat:room-transition-ended', context, { reason: 'committed' });
    return context;
  }

  function beginRoom(roomId, key = null) {
    const transition = beginTransition(roomId);
    return commitTransition(transition, key);
  }

  function current() {
    return activeRoomContext;
  }

  function pending() {
    return pendingTransition;
  }

  function isCurrent(context) {
    return Boolean(
      context
      && activeRoomContext === context
      && context.phase === 'active'
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

  function endRoom(context = activeRoomContext, reason = 'ended') {
    if (!context || activeRoomContext !== context) return false;
    abortContext(context, reason);
    activeRoomContext = null;
    dispatch('fpchat:room-context-ended', context, { reason: String(reason || 'ended') });
    return true;
  }

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
    dispatch('fpchat:operation-ended', null, {
      operationId: operation.id,
      kind: operation.kind,
      status: String(status || 'complete')
    });
    return true;
  }

  function cancelOperation(operation, reason = 'cancelled') {
    if (!operation || !operations.has(operation.id)) return false;
    try { operation.controller.abort(String(reason || 'cancelled')); }
    catch { operation.controller.abort(); }
    operations.delete(operation.id);
    dispatch('fpchat:operation-ended', null, {
      operationId: operation.id,
      kind: operation.kind,
      status: 'cancelled'
    });
    return true;
  }

  function snapshot() {
    return {
      generation,
      active: publicContext(activeRoomContext),
      pending: publicContext(pendingTransition),
      operations: [...operations.values()].map((operation) => ({
        id: operation.id,
        kind: operation.kind,
        aborted: operation.signal.aborted,
        ageMs: Math.round(performance.now() - operation.startedAt)
      }))
    };
  }

  window.FPRoomContext170 = Object.freeze({
    beginTransition,
    isLatestTransition,
    cancelTransition,
    commitTransition,
    beginRoom,
    current,
    pending,
    isCurrent,
    guard,
    endRoom,
    beginOperation,
    finishOperation,
    cancelOperation,
    snapshot
  });

  try {
    window.FPRuntime?.registerOwner?.('room-context170', {
      role: 'room-context',
      mode: 'active-transition-owner'
    });
  } catch {}

  const currentScript = document.currentScript;
  const suffix = (() => {
    try { return new URL(currentScript?.src || '', location.href).search || '?v=170'; }
    catch { return '?v=170'; }
  })();

  function loadTextSendOwner() {
    if (window.__fpTextSend170Installed || document.querySelector('script[data-fp-text-send170]')) return;
    const script = document.createElement('script');
    script.src = `/text-send170.js${suffix}`;
    script.dataset.fpTextSend170 = '1';
    document.body.appendChild(script);
  }

  function loadRoomOpenOwner() {
    if (window.__fpRoomOpen170Installed) {
      loadTextSendOwner();
      return;
    }
    const existing = document.querySelector('script[data-fp-room-open170]');
    if (existing) {
      existing.addEventListener('load', loadTextSendOwner, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `/room-open170.js${suffix}`;
    script.dataset.fpRoomOpen170 = '1';
    script.onload = loadTextSendOwner;
    document.body.appendChild(script);
  }

  function loadConnectionOwner() {
    if (window.FPConnection170) {
      loadRoomOpenOwner();
      return;
    }
    const existing = document.querySelector('script[data-fp-connection170]');
    if (existing) {
      existing.addEventListener('load', loadRoomOpenOwner, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `/connection170.js${suffix}`;
    script.dataset.fpConnection170 = '1';
    script.onload = loadRoomOpenOwner;
    document.body.appendChild(script);
  }

  function loadLifecycleOwner() {
    if (window.FPLifecycle170) {
      loadConnectionOwner();
      return;
    }
    const existing = document.querySelector('script[data-fp-lifecycle170]');
    if (existing) {
      existing.addEventListener('load', loadConnectionOwner, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `/lifecycle170.js${suffix}`;
    script.dataset.fpLifecycle170 = '1';
    script.onload = loadConnectionOwner;
    document.body.appendChild(script);
  }

  loadLifecycleOwner();
})();
