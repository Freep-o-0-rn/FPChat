/* Build 176.18/176.19: thin SyncCoordinator adapter over existing sync entry points.
   No sync state, queue, retry, polling or request algorithm is owned here. */
(() => {
  if (window.FPSyncCoordinator176) return;

  async function syncAfterReconnect(deviceId) {
    window.FPConnection170?.noteDiagnosticSyncStart?.();
    try {
      const result=await syncAllRoomsAfterReconnect(deviceId);
      window.FPConnection170?.noteDiagnosticSyncReady?.(result!==false,result===undefined?'sync-complete-no-explicit-result':'');
      return result;
    } catch (error) {
      window.FPConnection170?.noteDiagnosticSyncReady?.(false,'sync-after-reconnect-failed');
      throw error;
    }
  }

  async function syncAfterResume() {
    window.FPLifecycle170?.noteDiagnosticSyncStart?.();
    window.FPConnection170?.noteDiagnosticSyncStart?.();
    try {
      const result=await startAppSessionSync();
      const ok=result!==false;
      const reason=result===undefined?'sync-not-required-or-no-explicit-result':'';
      window.FPLifecycle170?.noteDiagnosticSyncReady?.(ok,reason);
      window.FPConnection170?.noteDiagnosticSyncReady?.(ok,reason);
      return result;
    } catch (error) {
      window.FPLifecycle170?.noteDiagnosticSyncReady?.(false,'sync-after-resume-failed');
      window.FPConnection170?.noteDiagnosticSyncReady?.(false,'sync-after-resume-failed');
      throw error;
    }
  }

  window.FPSyncCoordinator176 = Object.freeze({
    syncAfterReconnect,
    syncAfterResume
  });

  try {
    window.FPRuntime?.registerOwner?.('sync-coordinator176', {
      role: 'sync-trigger-coordinator',
      mode: 'thin-adapter',
      workers: 'app.js syncAllRoomsAfterReconnect + startAppSessionSync'
    });
  } catch {}
})();
