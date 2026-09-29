/* Build 170: centralized browser lifecycle owner.
   This layer only normalizes lifecycle signals. It does not perform network sync,
   reconnect WebSocket, render UI or cancel room operations by itself. */
(() => {
  if (window.FPLifecycle170) return;

  const subscribers = new Set();
  let resumeDiagnostic = null;

  function diagnostic() { return window.FPRuntime169?.loading || null; }
  function finishResumeDiagnostic(status = 'ok', outcome = 'ready', reason = '') {
    const current = resumeDiagnostic;
    if (!current) return;
    if (current.raf) cancelAnimationFrame(current.raf);
    diagnostic()?.annotate(current.token,{outcome,reason,actualResultVerified:status==='ok'});
    diagnostic()?.finish(current.token,status);
    resumeDiagnostic = null;
  }
  function maybeFinishResumeDiagnostic() {
    const current = resumeDiagnostic;
    if (!current || !current.uiReady || !current.syncDone) return;
    finishResumeDiagnostic(current.syncOk === false ? 'error' : 'ok', current.syncOk === false ? 'sync-failed' : 'ready', current.syncReason || '');
  }
  function beginResumeDiagnostic(source = 'foreground') {
    if (resumeDiagnostic) return resumeDiagnostic.token;
    const token = diagnostic()?.begin('resume',{syncRequired:true,ui:source});
    if (!token) return null;
    resumeDiagnostic = {token,raf:0,uiReady:false,syncDone:false,syncOk:null,syncReason:''};
    diagnostic()?.step(token,'visible');
    if (document.visibilityState === 'visible') {
      resumeDiagnostic.raf=requestAnimationFrame(()=>{
        const current=resumeDiagnostic;
        if(!current||current.token?.id!==token.id)return;
        current.raf=0;current.uiReady=true;
        diagnostic()?.step(token,'ui-ready');
        maybeFinishResumeDiagnostic();
      });
    } else {
      diagnostic()?.annotate(token,{reason:'visibility-not-visible'});
    }
    return token;
  }
  function noteDiagnosticSyncStart() {
    const token=resumeDiagnostic?.token||null;
    diagnostic()?.step(token,'sync-start');
    return token;
  }
  function noteDiagnosticSyncReady(ok = true, reason = '') {
    const current=resumeDiagnostic;
    if(!current)return false;
    current.syncDone=true;current.syncOk=ok!==false;current.syncReason=String(reason||'').slice(0,64);
    diagnostic()?.step(current.token,'sync-ready');
    diagnostic()?.annotate(current.token,{sync:current.syncOk?'complete':'failed',reason:current.syncReason});
    maybeFinishResumeDiagnostic();
    return true;
  }

  const state = {
    visibility: document.visibilityState,
    online: navigator.onLine !== false,
    focused: typeof document.hasFocus === 'function' ? document.hasFocus() : true,
    pageActive: true,
    sequence: 0,
    lastType: 'init',
    lastAt: Date.now()
  };

  function snapshot() {
    return { ...state };
  }

  function emit(type, detail = {}) {
    state.sequence += 1;
    state.lastType = String(type || 'unknown');
    state.lastAt = Date.now();
    const payload = Object.freeze({ ...snapshot(), ...detail });

    for (const listener of [...subscribers]) {
      try { listener(payload); } catch (error) { console.warn('FPLifecycle170 subscriber failed', error); }
    }

    try {
      window.dispatchEvent(new CustomEvent('fpchat:lifecycle170', { detail: payload }));
    } catch {}
  }

  function onVisibility() {
    const next = document.visibilityState;
    if (state.visibility === next) return;
    state.visibility = next;
    if (next === 'visible') beginResumeDiagnostic('foreground');
    else if (resumeDiagnostic) finishResumeDiagnostic('cancelled','cancelled','background-before-ready');
    emit(next === 'visible' ? 'foreground' : 'background');
  }

  function onOnline() {
    if (state.online) return;
    state.online = true;
    emit('online');
  }

  function onOffline() {
    if (!state.online) return;
    state.online = false;
    emit('offline');
  }

  function onFocus() {
    if (state.focused) return;
    state.focused = true;
    emit('focus');
  }

  function onBlur() {
    if (!state.focused) return;
    state.focused = false;
    emit('blur');
  }

  function onPageShow(event) {
    state.pageActive = true;
    state.visibility = document.visibilityState;
    state.online = navigator.onLine !== false;
    if (state.visibility === 'visible') beginResumeDiagnostic(event?.persisted ? 'pageshow-bfcache' : 'pageshow');
    emit('pageshow', { persisted: Boolean(event?.persisted) });
  }

  function onPageHide(event) {
    state.pageActive = false;
    if (resumeDiagnostic) finishResumeDiagnostic('cancelled','cancelled','pagehide-before-ready');
    emit('pagehide', { persisted: Boolean(event?.persisted) });
  }

  const onBeforeUnload=()=>emit('beforeunload');
  window.addEventListener('beforeunload',onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibility, { passive: true });
  window.addEventListener('online', onOnline, { passive: true });
  window.addEventListener('offline', onOffline, { passive: true });
  window.addEventListener('focus', onFocus, { passive: true });
  window.addEventListener('blur', onBlur, { passive: true });
  window.addEventListener('pageshow', onPageShow, { passive: true });
  window.addEventListener('pagehide', onPageHide, { passive: true });

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function destroy() {
    window.removeEventListener('beforeunload',onBeforeUnload);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onPageHide);
    subscribers.clear();
    if (resumeDiagnostic) finishResumeDiagnostic('cancelled','cancelled','lifecycle-destroyed');
  }

  window.FPLifecycle170 = Object.freeze({
    snapshot,
    subscribe,
    diagnosticResumeToken: () => resumeDiagnostic?.token || null,
    noteDiagnosticSyncStart,
    noteDiagnosticSyncReady,
    destroy
  });

  try {
    window.FPRuntime?.registerOwner?.('lifecycle170', {
      role: 'lifecycle-normalizer',
      mode: 'active-signal-owner'
    });
  } catch {}

  queueMicrotask(() => emit('ready'));
})();
