/* Build 176.18: thin SyncCoordinator adapter over the existing reconnect sync worker.
   No sync state, queue, retry, polling or request algorithm is owned here. */
(() => {
  if (window.FPSyncCoordinator176) return;

  function syncAfterReconnect(deviceId) {
    return syncAllRoomsAfterReconnect(deviceId);
  }

  window.FPSyncCoordinator176 = Object.freeze({
    syncAfterReconnect
  });

  try {
    window.FPRuntime?.registerOwner?.('sync-coordinator176', {
      role: 'sync-trigger-coordinator',
      mode: 'thin-adapter',
      worker: 'app.js syncAllRoomsAfterReconnect'
    });
  } catch {}
})();
