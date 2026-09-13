/* Build 128: compatibility loader for stabilized pins plus isolated UI hotfixes. */
(() => {
  const current = document.currentScript;
  const suffix = (() => {
    try { return new URL(current?.src || '', window.location.href).search || '?v=128'; }
    catch { return '?v=128'; }
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

  if (!document.querySelector('script[data-fp-ui-hotfix128]')) {
    const hotfix = document.createElement('script');
    hotfix.src = `/ui-hotfix128.js${suffix}`;
    hotfix.dataset.fpUiHotfix128 = '1';
    document.body.appendChild(hotfix);
  }
})();