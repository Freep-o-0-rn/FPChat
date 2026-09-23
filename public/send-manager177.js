/* Build 177.17: stateless dispatcher over existing send executors.
   Owns no submit listener, retry, queue, pending state, operation context or activity. */
(() => {
  if (window.FPSendManager177) return;

  function dispatch(executor) {
    if (typeof executor !== 'function') return false;
    return executor();
  }

  window.FPSendManager177 = Object.freeze({ dispatch });

  try {
    window.FPRuntime?.registerOwner?.('send-manager177', {
      role: 'send-dispatch',
      mode: 'thin-adapter',
      owns: 'no transport/retry/pending/activity'
    });
  } catch {}
})();
