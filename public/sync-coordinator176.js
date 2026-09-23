/* Build 176.18/176.19: thin SyncCoordinator adapter over existing sync entry points.
   No sync state, queue, retry, polling or request algorithm is owned here. */
(() => {
  if (window.FPSyncCoordinator176) return;

  function syncAfterReconnect(deviceId) {
    return syncAllRoomsAfterReconnect(deviceId);
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
