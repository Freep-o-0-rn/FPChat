/* Build 131: Telegram-like settings navigation layered over stable Build 129 mechanics. */
(() => {
  if (window.__fpSettings131LoaderStarted) return;
  window.__fpSettings131LoaderStarted = true;

  let attempts = 0;
  const start = () => {
    const ready = typeof renderSettings === 'function' && window.els?.content && document.getElementById('fpchat-settings-autosave-style');
    if (!ready) {
      if (attempts++ < 100) setTimeout(start, 50);
      return;
    }
    if (window.__fpSettings131Installed) return;
    window.__fpSettings131Installed = true;

    const baseRenderSettings = renderSettings;

  const STYLE_ID = 'fpchat-settings131-style';
  const BUILD = 131;
  let currentPage = 'main';
  let swipeCleanup = null;

  const svg = {
    profile: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"/></svg>`,
    appearance: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-.6-.5-1-1-1h-3.2a2.8 2.8 0 0 1-2.8-2.8V5c0-1.1-.9-2-2-2Z"/><path d="M7.5 10.5h.01M9.5 15h.01M6.5 14h.01"/></svg>`,
    notifications: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>`,
    storage: `<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>`,
    about: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7h.01"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`,
    back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`,
    github: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-2.85 17.54c.45.08.62-.2.62-.44v-1.73c-2.52.55-3.05-1.07-3.05-1.07-.41-1.05-1-1.33-1-1.33-.82-.56.06-.55.06-.55.91.06 1.39.94 1.39.94.81 1.38 2.12.98 2.64.75.08-.59.32-.98.57-1.25-2.01-.23-4.12-1-4.12-4.45 0-.98.35-1.79.93-2.42-.09-.23-.4-1.15.09-2.39 0 0 .76-.24 2.47.92A8.6 8.6 0 0 1 12 8.25a8.6 8.6 0 0 1 2.25.31c1.71-1.16 2.47-.92 2.47-.92.49 1.24.18 2.16.09 2.39.58.63.93 1.44.93 2.42 0 3.46-2.12 4.22-4.13 4.45.33.28.62.83.62 1.68v2.52c0 .24.17.52.62.44A9 9 0 0 0 12 3Z"/></svg>`
  };

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .fp-settings131 {
        --fp-settings-card: var(--panel);
        --fp-settings-border: rgba(0,0,0,.08);
        --fp-settings-muted: var(--muted);
        width: min(720px, 100%);
        margin: 0 auto;
        padding: 16px 16px calc(28px + env(safe-area-inset-bottom));
        box-sizing: border-box;
        touch-action: pan-y;
        -webkit-touch-callout: none;
        user-select: none;
        transform: translate3d(0,0,0);
        will-change: transform, opacity;
      }
      :root[data-theme='dark'] .fp-settings131 {
        --fp-settings-border: rgba(148,163,184,.18);
      }
      .fp-settings131 input,
      .fp-settings131 textarea,
      .fp-settings131 select,
      .fp-settings131 [contenteditable='true'] {
        -webkit-touch-callout: default;
        user-select: text;
      }
      .fp-settings131-header {
        display: grid;
        grid-template-columns: 44px 1fr 44px;
        align-items: center;
        min-height: 48px;
        margin-bottom: 12px;
      }
      .fp-settings131-title {
        margin: 0;
        text-align: center;
        font-size: 21px;
        line-height: 1.2;
        font-weight: 750;
      }
      .fp-settings131-back {
        appearance: none;
        border: 0;
        background: transparent;
        color: inherit;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        padding: 0;
        cursor: pointer;
      }
      .fp-settings131-back:active { background: rgba(127,145,165,.16); }
      .fp-settings131-back svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .fp-settings131-group {
        overflow: hidden;
        border: 1px solid var(--fp-settings-border);
        border-radius: 18px;
        background: var(--fp-settings-card);
        box-shadow: 0 8px 28px rgba(0,0,0,.08);
      }
      .fp-settings131-row {
        width: 100%;
        min-height: 70px;
        border: 0;
        border-bottom: 1px solid var(--fp-settings-border);
        background: transparent;
        color: inherit;
        padding: 10px 14px 10px 12px;
        display: grid;
        grid-template-columns: 44px minmax(0,1fr) auto 20px;
        gap: 12px;
        align-items: center;
        text-align: left;
        cursor: pointer;
        font: inherit;
      }
      .fp-settings131-row:last-child { border-bottom: 0; }
      .fp-settings131-row:active { background: rgba(127,145,165,.10); }
      .fp-settings131-icon {
        width: 38px;
        height: 38px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        color: #fff;
      }
      .fp-settings131-icon svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
      .fp-settings131-icon.profile { background: #3390ec; }
      .fp-settings131-icon.appearance { background: #8e5cf6; }
      .fp-settings131-icon.notifications { background: #f5a623; }
      .fp-settings131-icon.storage { background: #35b97f; }
      .fp-settings131-icon.about { background: #778899; }
      .fp-settings131-primary { min-width: 0; font-size: 16px; font-weight: 650; line-height: 1.25; }
      .fp-settings131-secondary { min-width: 0; color: var(--fp-settings-muted); font-size: 13px; line-height: 1.25; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .fp-settings131-value { color: var(--fp-settings-muted); font-size: 14px; white-space: nowrap; }
      .fp-settings131-chevron { display:grid; place-items:center; color: var(--fp-settings-muted); }
      .fp-settings131-chevron svg { width: 18px; height: 18px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
      .fp-settings131-card {
        border: 1px solid var(--fp-settings-border);
        border-radius: 18px;
        background: var(--fp-settings-card);
        padding: 16px;
        box-shadow: 0 8px 28px rgba(0,0,0,.08);
      }
      .fp-settings131-card + .fp-settings131-card { margin-top: 12px; }
      .fp-settings131-label { display:block; margin: 0 0 8px; font-size: 14px; font-weight: 650; }
      .fp-settings131 input,
      .fp-settings131 select {
        width: 100%;
        box-sizing: border-box;
      }
      .fp-settings131-hint { margin: 10px 0 0; color: var(--fp-settings-muted); font-size: 13px; line-height: 1.45; }
      .fp-settings131-dev {
        min-height: 180px;
        display: grid;
        place-items: center;
        text-align: center;
        color: var(--fp-settings-muted);
      }
      .fp-settings131-dev strong { display:block; color:inherit; font-size:16px; margin-bottom:6px; }
      .fp-settings131-about-head { text-align:center; padding: 8px 6px 18px; }
      .fp-settings131-about-logo {
        width: 72px;
        height: 72px;
        margin: 0 auto 12px;
        border-radius: 22px;
        display:grid;
        place-items:center;
        font-size: 24px;
        font-weight: 850;
        background: linear-gradient(145deg, #7b2cff, #3390ec);
        color:#fff;
        box-shadow: 0 10px 28px rgba(69,74,220,.28);
      }
      .fp-settings131-about-name { font-size: 22px; font-weight: 800; }
      .fp-settings131-about-version { margin-top: 4px; color: var(--fp-settings-muted); font-size: 14px; }
      .fp-settings131-link {
        margin-top: 12px;
        display:flex;
        align-items:center;
        gap: 10px;
        text-decoration:none;
        color:inherit;
        min-height: 48px;
        padding: 0 4px;
      }
      .fp-settings131-link svg { width:22px; height:22px; fill:currentColor; stroke:none; }
      .fp-settings131 .notification-settings {
        margin: 0;
        padding: 8px 16px 14px;
        border: 1px solid var(--fp-settings-border);
        border-radius: 18px;
        background: var(--fp-settings-card);
      }
      .fp-settings131 .notification-settings > h3 { display:none; }
      .fp-settings131 .notification-settings .notification-option { min-height: 52px; }
      .fp-settings131 .notification-settings .settings-hint { margin: 10px 0; }
      .fp-settings131 .notification-settings .btn { width: 100%; }
      .fp-settings131 .settings-section { margin-top: 0; }
      .fp-settings131-swipe { transition: transform .16s ease, opacity .16s ease; }
      @media (max-width: 700px) {
        .fp-settings131 { padding-left: 12px; padding-right: 12px; padding-top: 8px; }
        .fp-settings131-row { min-height: 66px; }
      }
    `;
    document.head.appendChild(style);
  }

  function themeValue() {
    return localStorage.getItem(STORAGE.theme) || 'auto';
  }

  function themeLabel(value = themeValue()) {
    if (value === 'light') return 'Светлая';
    if (value === 'dark') return 'Тёмная',
    return 'Авто';
  }

  function notificationLabel() {
    return state.notif?.enabled === false ? 'Выключены' : 'Включены';
  }

  function header(title) {
    return `<div class="fp-settings131-header"><button type="button" class="fp-settings131-back" data-fp-settings-back aria-label="Назад">${svg.back}</button><h2 class="fp-settings131-title">${safeText(title)}</h2><span></span></div>`;
  }

  function mount(title, bodyHtml, onBack) {
    swipeCleanup?.();
    els.content.innerHTML = `<div class="fp-settings131" data-fp-settings-page="${safeText(currentPage)}">${header(title)}<div class="fp-settings131-body">${bodyHtml}</div></div>`;
    const root = els.content.querySelector('.fp-settings131');
    root?.querySelector('[data-fp-settings-back]')?.addEventListener('click', onBack);
    installNativeLongPressBlock(root);
    swipeCleanup = installBackSwipe(root, onBack);
    return root;
  }

  function row(page, iconName, title, secondary, value = '') {
    return `<button type="button" class="fp-settings131-row" data-fp-settings-open="${page}"><span class="fp-settings131-icon ${iconName}">${svg[iconName]}</span><span><span class="fp-settings131-primary">${safeText(title)}</span>${secondary ? `<span class="fp-settings131-secondary">${safeText(secondary)}</span>` : ''}</span><span class="fp-settings131-value">${safeText(value)}</span><span class="fp-settings131-chevron">${svg.chevron}</span></button>`;
  }

  function renderMain() {
    currentPage = 'main';
    const root = mount('Настройки', `<div class="fp-settings131-group">
      ${row('profile', 'profile', 'Профиль', state.nick || '', '')}
      ${row('appearance', 'appearance', 'Оформление', '', themeLabel())}
      ${row('notifications', 'notifications', 'Уведомления',-���jם~�ۭ��