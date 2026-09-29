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
  let connectionDiagnostic = null;

  function diagnostic() { return window.FPRuntime169?.loading || null; }
  function beginConnectionDiagnostic(source = 'connection') {
    if (connectionDiagnostic) return connectionDiagnostic.token;
    const token = diagnostic()?.begin('connection',{syncRequired:true});
    if (!token) return null;
    connectionDiagnostic = {
      token,
      source:String(source||'connection').slice(0,40),
      oldSocket:currentSocket || null,
      breakConfirmed:false,
      restored:false
    };
    return token;
  }
  function finishConnectionDiagnostic(status='ok', outcome='ready', reason='') {
    const current=connectionDiagnostic;
    if(!current)return false;
    diagnostic()?.annotate(current.token,{outcome,reason,actualResultVerified:status==='ok'});
    diagnostic()?.finish(current.token,status);
    connectionDiagnostic=null;
    return true;
  }
  function noteDiagnosticSyncStart() {
    const token=connectionDiagnostic?.token||null;
    diagnostic()?.step(token,'sync-start');
    return token;
  }
  function noteDiagnosticSyncReady(ok=true,reason='') {
    const current=connectionDiagnostic;
    if(!current)return false;
    diagnostic()?.step(current.token,'sync-ready');
    diagnostic()?.annotate(current.token,{sync:ok===false?'failed':'complete',reason:String(reason||'').slice(0,64)});
    const preserved=current.breakConfirmed===false&&current.oldSocketPreserved===true;
    const outcome=preserved?'socket-preserved':(current.breakConfirmed?'reconnected':'sync-complete');
    return finishConnectionDiagnostic(ok===false?'error':'ok',outcome,reason||(preserved?'old-socket-preserved':''));
  }

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
      const current=connectionDiagnostic;
      if(current){
        diagnostic()?.step(current.token,'socket-open');
        diagnostic()?.annotate(current.token,{reconnect:current.breakConfirmed?'confirmed':'unknown'});
      }
      emit('open', socket);
    };
    const onClose = () => {
      if (socket !== currentSocket) return;
      if(!manualClose){
        const token=beginConnectionDiagnostic('socket-close');
        if(connectionDiagnostic){connectionDiagnostic.breakConfirmed=true;connectionDiagnostic.oldSocket=socket;}
        diagnostic()?.step(token,'socket-break');
        diagnostic()?.annotate(token,{reconnect:'pending'});
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
    if(manualClose&&connectionDiagnostic)finishConnectionDiagnostic('cancelled','cancelled','manual-close');
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
    diagnosticConnectionToken: () => connectionDiagnostic?.token || null,
    noteDiagnosticSyncStart,
    noteDiagnosticSyncReady
  });

  window.addEventListener('fpchat:lifecycle170',(event)=>{
    const type=String(event?.detail?.lastType||'');
    if(type==='offline'){
      if(connectionDiagnostic)finishConnectionDiagnostic('cancelled','superseded','new-offline-cycle');
      const token=beginConnectionDiagnostic('offline');
      if(connectionDiagnostic)connectionDiagnostic.oldSocket=currentSocket||null;
      diagnostic()?.annotate(token,{reconnect:'unknown'});
      return;
    }
    if(type!=='online')return;
    const current=connectionDiagnostic;
    if(!current)return;
    diagnostic()?.step(current.token,'network-restored');
    const old=current.oldSocket;
    if(old&&old===currentSocket&&old.readyState===WebSocket.OPEN&&!current.breakConfirmed){
      current.oldSocketPreserved=true;
      diagnostic()?.annotate(current.token,{oldSocketPreserved:true,reconnect:'none',reason:'old-socket-preserved'});
    }else if(!current.breakConfirmed){
      diagnostic()?.annotate(current.token,{reconnect:'unknown',reason:old?'socket-state-changed-without-close-event':'no-active-socket-at-offline'});
    }
  },{passive:true});

  try {
    window.FPRuntime?.registerOwner?.('connection170', {
      role: 'websocket-current-reconnect',
      mode: 'active-owner',
      transportWorker: 'app.js stableWs'
    });
  } catch {}

  queueMicrotask(() => emit('ready', currentSocket));
})();
