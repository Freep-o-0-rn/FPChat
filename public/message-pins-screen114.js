/* Build 156: compatibility loader for stabilized pins plus isolated UI layers. */
(() => {
  const current = document.currentScript;
  const suffix = (() => {
    try { return new URL(current?.src || '', window.location.href).search || '?v=156'; }
    catch { return '?v=156'; }
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

  if (!document.querySelector('script[data-fp-room-menu-touch151]')) {
    const roomMenuTouch = document.createElement('script');
    roomMenuTouch.src = `/room-menu-touch151.js${suffix}`;
    roomMenuTouch.dataset.fpRoomMenuTouch151 = '1';
    document.body.appendChild(roomMenuTouch);
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

  if (!document.querySelector('script[data-fp-username-profile140]')) {
    const usernameProfile = document.createElement('script');
    usernameProfile.src = `/username-profile140.js${suffix}`;
    usernameProfile.dataset.fpUsernameProfile140 = '1';
    document.body.appendChild(usernameProfile);
  }

  // Build 147 request sending must initialize the hidden sender-owned room layer
  // before the username search UI can submit a request.
  if (!document.querySelector('script[data-fp-chat-request-owner147]')) {
    const requestOwner = document.createElement('script');
    requestOwner.src = `/chat-request-owner147.js${suffix}`;
    requestOwner.dataset.fpChatRequestOwner147 = '1';
    requestOwner.onload = () => {
      if (!document.querySelector('script[data-fp-username-search143]')) {
        const usernameSearch = document.createElement('script');
        usernameSearch.src = `/username-search143.js${suffix}`;
        usernameSearch.dataset.fpUsernameSearch143 = '1';
        document.body.appendChild(usernameSearch);
      }
    };
    document.body.appendChild(requestOwner);
  } else if (!document.querySelector('script[data-fp-username-search143]')) {
    const usernameSearch = document.createElement('script');
    usernameSearch.src = `/username-search143.js${suffix}`;
    usernameSearch.dataset.fpUsernameSearch143 = '1';
    document.body.appendChild(usernameSearch);
  }

  // Build 156 only decorates the existing global search field. It does not
  // replace local filtering or the exact @username lookup mechanics.
  if (!document.querySelector('script[data-fp-global-search156]')) {
    const globalSearch = document.createElement('script');
    globalSearch.src = `/global-search156.js${suffix}`;
    globalSearch.dataset.fpGlobalSearch156 = '1';
    document.body.appendChild(globalSearch);
  }

  if (!document.querySelector('script[data-fp-system-chat144]')) {
    const systemChat = document.createElement('script');
    systemChat.src = `/system-chat144.js${suffix}`;
    systemChat.dataset.fpSystemChat144 = '1';
    systemChat.onload = () => {
      if (!document.querySelector('script[data-fp-chat-request-system147]')) {
        const requestSystem = document.createElement('script');
        requestSystem.src = `/chat-request-system147.js${suffix}`;
        requestSystem.dataset.fpChatRequestSystem147 = '1';
        document.body.appendChild(requestSystem);
      }
    };
    document.body.appendChild(systemChat);
  } else if (!document.querySelector('script[data-fp-chat-request-system147]')) {
    const requestSystem = document.createElement('script');
    requestSystem.src = `/chat-request-system147.js${suffix}`;
    requestSystem.dataset.fpChatRequestSystem147 = '1';
    document.body.appendChild(requestSystem);
  }

  const loadSystemUi148 = () => {
    if (document.querySelector('script[data-fp-system-ui148]')) return;
    const systemUi = document.createElement('script');
    systemUi.src = `/system-ui148.js${suffix}`;
    systemUi.dataset.fpSystemUi148 = '1';
    document.body.appendChild(systemUi);
  };

  if (!document.querySelector('script[data-fp-gesture-manager135]')) {
    const gestures = document.createElement('script');
    gestures.src = `/gesture-manager135.js${suffix}`;
    gestures.dataset.fpGestureManager135 = '1';
    gestures.onload = loadSystemUi148;
    document.body.appendChild(gestures);
  } else {
    loadSystemUi148();
  }

  if (!document.querySelector('script[data-fp-viewport-layout136]')) {
    const viewportLayout = document.createElement('script');
    viewportLayout.src = `/viewport-layout136.js${suffix}`;
    viewportLayout.dataset.fpViewportLayout136 = '1';
    document.body.appendChild(viewportLayout);
  }

  if (!document.querySelector('link[data-fp-media-gallery134]')) {
    const galleryCss = document.createElement('link');
    galleryCss.rel = 'stylesheet';
    galleryCss.href = `/media-gallery134.css${suffix}`;
    galleryCss.dataset.fpMediaGallery134 = '1';
    document.head.appendChild(galleryCss);
  }

  if (!document.querySelector('script[data-fp-media-gallery134]')) {
    const gallery = document.createElement('script');
    gallery.src = `/media-gallery134.js${suffix}`;
    gallery.dataset.fpMediaGallery134 = '1';
    document.body.appendChild(gallery);
  }

  // Build 152/153 does not reorder or replace any existing layer. It only waits
  // for the current startup stack to become ready before removing the cold-start gate.
  if (!document.querySelector('script[data-fp-boot-ready152]')) {
    const bootReady = document.createElement('script');
    bootReady.src = `/boot-ready152.js${suffix}`;
    bootReady.dataset.fpBootReady152 = '1';
    document.body.appendChild(bootReady);
  }
})();
