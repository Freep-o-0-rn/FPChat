/* Build 170: single WebSocket change/event owner.
   The existing app.js stable WebSocket path still creates/reconnects the socket.
   This layer owns change/open/close notification only; it never creates a second socket. */
(() => {
  if (window.FPConnection170) return;

  let sequence = 0;
  let currentSocket = null;
  let detachSocketEvents = () => {};
  const subscribers = new Set();

  function socketSnapshot(socket = currentSocket) {
    if (!socket) return { exists: false, readyState: null };
    return {
      exists: true,
      readyState: Number(socket.readyState),
      open: socket.readyState === WebSocket.OPEN,
      connecting: socket.readyState === WebSocket.CONNECTING
    };
  }

  function snapshot() {
    return { sequence, ...socketSnapshot() };
  }

  function emit(type, socket = currentSocket) {
    sequence += 1;
    const detail = Object.freeze({ type: String(type || 'changed'), sequence, ...socketSnapshot(socket) });
    for (const listener of [...subscribers]) {
      try { listener(detail, socket); } catch (error) { console.warn('FPConnection170 subscriber failed', error); }
    }
    try { window.dispatchEvent(new CustomEvent('fpchat:connection170', { detail })); } catch {}
  }

  function watchSocket(socket) {
    detachSocketEvents();
    detachSocketEvents = () => {};
    if (!socket || typeof socket.addEventListener !== 'function') return;

    const onOpen = () => {
      if (socket !== currentSocket) return;
      emit('open', socket);
    };
    const onClose = () => {
      if (socket !== currentSocket) return;
      emit('close', socket);
    };
    const onError = () => {
      if (socket !== currentSocket) return;
      emit('error', socket);
    };

    socket.addEventListener('open', onOpen);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);
    detachSocketEvents = () => {
      try { socket.removeEventListener('open', onOpen); } catch {}
      try { socket.removeEventListener('close', onClose); } catch {}
      try { socket.removeEventListener('error', onError); } catch {}
    };
  }

  function setCurrent(next, reason = 'assigned') {
    const socket = next || null;
    if (socket === currentSocket) return currentSocket;
    currentSocket = socket;
    watchSocket(socket);
    emit(reason, socket);
    return socket;
  }

  function subscribe(listener, { immediate = true } = {}) {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    if (immediate) {
      try { listener(Object.freeze({ type: 'snapshot', sequence, ...socketSnapshot() }), currentSocket); } catch {}
    }
    return () => subscribers.delete(listener);
  }

  function ensureConnected(deviceId, timeoutMs = 8000) {
    return ensureStableWsConnected(deviceId, timeoutMs);
  }

  // state.ws is already the canonical socket slot in app.js. Turn only that
  // property into an observable slot; preserve its value and all existing users.
  try {
    const descriptor = Object.getOwnPropertyDescriptor(state, 'ws');
    if (!descriptor || descriptor.configurable !== false) {
      currentSocket = state.ws || null;
      Object.defineProperty(state, 'ws', {
        configurable: true,
        enumerable: true,
        get() { return currentSocket; },
        set(value) { setCurrent(value, 'changed'); }
      });
      watchSocket(currentSocket);
    } else {
      currentSocket = state.ws || null;
      watchSocket(currentSocket);
    }
  } catch (error) {
    console.warn('FPConnection170 could not observe state.ws', error);
    try { currentSocket = state?.ws || null; } catch { currentSocket = null; }
    watchSocket(currentSocket);
  }

  window.FPConnection170 = Object.freeze({
    current: () => currentSocket,
    snapshot,
    subscribe,
    ensureConnected
  });

  try {
    window.FPRuntime?.registerOwner?.('connection170', {
      role: 'websocket-change-events',
      mode: 'active-signal-owner',
      transportOwner: 'app.js stableWs'
    });
  } catch {}

  queueMicrotask(() => emit('ready', currentSocket));
})();
