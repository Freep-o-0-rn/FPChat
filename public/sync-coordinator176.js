/* Build 176.18/176.19: thin SyncCoordinator adapter over existing sync entry points.
   No sync state, queue, retry, polling or request algorithm is owned here. */
(() => {
  if (window.FPSyncCoordinator176) return;

  function syncAfterReconnect(deviceId) {
    const connection=window.FPConnection170;
    const loading=window.FPRuntime169?.loading;
    const trace=connection?.diagnosticReconnectToken?.()||null;
    loading?.step?.(trace,'sync-start');
    let work;
    try{work=syncAllRoomsAfterReconnect(deviceId);}
    catch(error){
      loading?.result?.(trace,'error','owner-error');loading?.finish?.(trace,'error');connection?.clearDiagnosticReconnect?.(trace);
      throw error;
    }
    return Promise.resolve(work).then((value)=>{
      loading?.step?.(trace,'sync-ready');
      loading?.result?.(trace,'reconnected','none');
      loading?.finish?.(trace,'ok');
      connection?.clearDiagnosticReconnect?.(trace);
      return value;
    },(error)=>{
      loading?.result?.(trace,'error','owner-error');loading?.finish?.(trace,'error');connection?.clearDiagnosticReconnect?.(trace);
      throw error;
    });
  }

  function syncAfterResume() {
    return startAppSessionSync();
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
