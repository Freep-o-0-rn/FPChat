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
  let diagnosticReconnect19 = null;

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
      if(diagnosticReconnect19&&diagnosticReconnect19.brokenSocket!==socket){
        window.FPRuntime169?.loading?.step?.(diagnosticReconnect19.token,'reconnect-open');
      }
      emit('open', socket);
    };
    const onClose = () => {
      if (socket !== currentSocket) return;
      if(!manualClose){
        const loading=window.FPRuntime169?.loading;
        const token=loading?.begin?.('connection');
        loading?.tag?.(token,'source','owner-event');
        loading?.tag?.(token,'syncRequired',true);
        loading?.step?.(token,'break-confirmed');
        diagnosticReconnect19={token,brokenSocket:socket};
      }
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
    diagnosticReconnectToken:()=>diagnosticReconnect19?.token||null,
    clearDiagnosticReconnect(token){
      if(!diagnosticReconnect19||Number(diagnosticReconnect19.token?.id)!==Number(token?.id))return false;
      diagnosticReconnect19=null;return true;
    }
  });

  try {
    window.FPRuntime?.registerOwner?.('connection170', {
      role: 'websocket-current-reconnect',
      mode: 'active-owner',
      transportWorker: 'app.js stableWs'
    });
  } catch {}

  window.addEventListener('fpchat:lifecycle170',(event)=>{
    const detail=event?.detail||{};
    if(detail.lastType!=='online'||diagnosticReconnect19)return;
    const socket=currentSocket;
    if(!socket||socket.readyState!==WebSocket.OPEN)return;
    const loading=window.FPRuntime169?.loading;
    const token=loading?.begin?.('connection');
    loading?.tag?.(token,'source','owner-event');
    loading?.tag?.(token,'syncRequired',false);
    loading?.result?.(token,'preserved-live-socket','no-break-old-socket-preserved');
    loading?.finish?.(token,'ok');
  },{passive:true});

  queueMicrotask(() => emit('ready', currentSocket));
})();
