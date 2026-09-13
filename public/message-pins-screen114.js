/* Build 115: compatibility loader for the stabilized pinned-messages screen. */
(() => {
  const current = document.currentScript;
  const suffix = (() => {
    try { return new URL(current?.src || '', window.location.href).search || '?v=115'; }
    catch { return '?v=115'; }
  })();

  if (!document.querySelector('link[data-fp-pins-screen115]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `/message-pins-screen115.css${suffix}`;
    css.dataset.fpPinsScreen115 = '1';
    document.head.appendChild(css);
  }

  if (!document.querySelector('script[data-fp-pins-screen115]')) {
    const script = document.createElement('script');
    script.src = `/message-pins-screen115.js${suffix}`;
    script.dataset.fpPinsScreen115 = '1';
    document.body.appendChild(script);
  }
})();