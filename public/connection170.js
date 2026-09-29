/* Build 170/176: single stable WebSocket current-slot/reconnect owner.
   app.js still executes the existing connect/payload worker and constructs the socket.
   This layer owns current-socket replacement, manual-close state, reconnect timing,
   and connection change/open/close notification; it never creates a second socket. */
(() => {
  if (window.FPConnection170) return;

  let sequence = 0;
  let currentSocket = null;
  let detachSocketEvents = () => {};
  const subscribers = new Set();
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let socketGeneration = 0;
  let manualClose = false;
  let diagnosticTrace19 = null;
  let diagnosticOfflineSocket19 = null;

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
      if (diagnosticTrace19) window.FPRuntime169?.loading?.step?.(diagnosticTrace19,'socket-open');
    };
    const onClose = () => {
      if (socket !== currentSocket) return;
      emit('close', socket);
      if (!manualClose) {
        const diagnostic=window.FPRuntime169?.loading;
        if (!diagnosticTrace19) {
          diagnosticTrace19=diagnostic?.begin?.('connection')||null;
          diagnostic?.annotate?.(diagnosticTrace19,{action:'reconnect',source:'socket-close',syncRequired:true});
        }
        diagnosticOfflineSocket19=socket;
        diagnostic?.step?.(diagnosticTrace19,'break-confirmed');
        diagnostic?.annotate?.(diagnosticTrace19,{breakConfirmed:true,oldSocketPreserved:false});
      }
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

  function setManualClose(value) {
    manualClose = Boolean(value);
    return manualClose;
  }

  function isManualClose() {
    return manualClose;
  }

  function isCurrent(socket, generation = null) {
    if (!socket || socket !== currentSocket) return false;
    return generation === null || Number(generation) === socketGeneration;
  }

  function requestClose(socket = currentSocket, { code, reason } = {}) {
    if (!socket || socket !== currentSocket) return false;
    try {
      if (code === undefined) socket.close();
      else socket.close(code, reason);
      return true;
    } catch {
      return false;
    }
  }

  function beginReplacement({ manual = false, code, reason } = {}) {
    manualClose = Boolean(manual);
    socketGeneration += 1;
    const previous = currentSocket;
    if (previous) {
      try {
        if (code === undefined) previous.close();
        else previous.close(code, reason);
      } catch {}
    }
    return socketGeneration;
  }

  function adoptCurrent(socket, generation = socketGeneration) {
    if (!socket || Number(generation) !== socketGeneration) return false;
    setCurrent(socket, 'changed');
    return true;
  }

  function releaseCurrent(socket, generation = null) {
    if (!isCurrent(socket, generation)) return false;
    socketGeneration += 1;
    setCurrent(null, 'changed');
    return true;
  }

  function closeCurrent({ manual = true, code, reason } = {}) {
    manualClose = Boolean(manual);
    socketGeneration += 1;
    const previous = currentSocket;
    if (previous) {
      try {
        if (code === undefined) previous.close();
        else previous.close(code, reason);
      } catch {}
    }
    setCurrent(null, manualClose ? 'manual-close' : 'changed');
    return Boolean(previous);
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

  function clearReconnect() {
    if (!reconnectTimer) return false;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    return true;
  }

  function resetReconnectAttempt() {
    reconnectAttempt = 0;
  }

  function scheduleReconnect({
    manualClose = false,
    shouldRun = false,
    online = true,
    getDesiredDeviceId,
    ensure = ensureConnected
  } = {}) {
    if (reconnectTimer || manualClose || !shouldRun || online === false) return false;
    const attempt = reconnectAttempt++;
    const delay = Math.min(15000, 500 * 2 ** Math.min(attempt, 5)) + Math.floor(Math.random() * 250);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      const deviceId = typeof getDesiredDeviceId === 'function' ? getDesiredDeviceId() : '';
      if (deviceId) void ensure(deviceId);
    }, delay);
    return true;
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

  function noteNetworkOffline() {
    const diagnostic=window.FPRuntime169?.loading;
    if (diagnosticTrace19) return diagnosticTrace19;
    diagnosticTrace19=diagnostic?.begin?.('connection')||null;
    diagnosticOfflineSocket19=currentSocket||null;
    diagnostic?.annotate?.(diagnosticTrace19,{action:'network-cycle',source:'offline',syncRequired:true});
    return diagnosticTrace19;
  }

  function markSyncStart() {
    if (diagnosticTrace19) window.FPRuntime169?.loading?.step?.(diagnosticTrace19,'sync-start');
  }

  function markSyncReady(success = true) {
    const trace=diagnosticTrace19;
    if (!trace) return;
    const diagnostic=window.FPRuntime169?.loading;
    diagnostic?.step?.(trace,'sync-ready');
    const record=diagnostic?.report?.().records?.find?.((item)=>item.id===trace.id)||null;
    const broke=Boolean(record?.points?.['break-confirmed']!==undefined);
    const opened=Boolean(record?.points?.['socket-open']!==undefined);
    if (!broke && diagnosticOfflineSocket19 && diagnosticOfflineSocket19===currentSocket && currentSocket?.readyState===WebSocket.OPEN) {
      diagnostic?.annotate?.(trace,{oldSocketPreserved:true,breakConfirmed:false,outcome:success?'live-connection-preserved':'live-connection-preserved-sync-incomplete'});
      diagnostic?.missing?.(trace,'reconnect','old-socket-preserved');
    } else if (broke && opened) {
      diagnostic?.annotate?.(trace,{outcome:success?'reconnected-ready':'reconnected-sync-incomplete'});
    } else if (broke) {
      diagnostic?.annotate?.(trace,{outcome:'break-without-open',reason:'not-observed'});
      diagnostic?.missing?.(trace,'reconnect','not-observed');
    }
    diagnostic?.finish?.(trace,success?'ok':'error');
    diagnosticTrace19=null;
    diagnosticOfflineSocket19=null;
  }

  function markSyncNotRequired() {
    const trace=diagnosticTrace19;
    if (!trace) return;
    const diagnostic=window.FPRuntime169?.loading;
    diagnostic?.annotate?.(trace,{syncRequired:false});
    diagnostic?.missing?.(trace,'sync','not-required');
    markSyncReady(true);
  }

  window.FPConnection170 = Object.freeze({
    current: () => currentSocket,
    snapshot,
    subscribe,
    ensureConnected,
    scheduleReconnect,
    clearReconnect,
    resetReconnectAttempt,
    setManualClose,
    isManualClose,
    isCurrent,
    requestClose,
    beginReplacement,
    adoptCurrent,
    releaseCurrent,
    closeCurrent,
    noteNetworkOffline,
    markSyncStart,
    markSyncReady,
    markSyncNotRequired
  });

  try {
    window.FPRuntime?.registerOwner?.('connection170', {
      role: 'websocket-current-reconnect',
      mode: 'active-owner',
      transportWorker: 'app.js stableWs'
    });
  } catch {}

  queueMicrotask(() => emit('ready', currentSocket));
})();
