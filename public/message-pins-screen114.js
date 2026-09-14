/* Build 131: compatibility loader for stabilized pins plus isolated UI layers. */
(() => {
  const current = document.currentScript;
  const suffix = (() => {
    try { return new URL(current?.src || '', window.location.href).search || '?v=131'; }
    catch { return '?v=131'; }
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

  if (!document.querySelector('script[data-fp-chat-opening129]')) {
    const opening = document.createElement('script');
    opening.src = `/chat-opening129.js${suffix}`;
    opening.dataset.fpChatOpening129 = '1';
    document.body.appendChild(opening);
  }

  if (!document.querySelector('link[data-fp-settings-ui131]')) {
    const settingsCss = document.createElement('link');
    settingsCss.rel = 'stylesheet';
    settingsCss.href = `/settings-ui131.css${suffix}`;
    settingsCss.dataset.fpSettingsUi131 = '1';
    document.head.appendChild(settingsCss);
  }

  if (!document.querySelector('script[data-fp-settings-ui131]')) {
    const settings = document.createElement('script');
    settings.src = `/settings-ui131.js${suffix}`;
    settings.dataset.fpSettingsUi131 = '1';
    document.body.appendChild(settings);
  }
})();
