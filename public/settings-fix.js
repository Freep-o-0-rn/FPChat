/* Build 98: settings autosave, toggle layout, join/leave push preference. */
(() => {
  const STYLE_ID = 'fpchat-settings-autosave-style';
  let notificationEnableSequence = 0;

  function installSettingsStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .notification-settings .notification-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        width: 100%;
        min-height: 48px;
        margin: 0;
        cursor: pointer;
      }
      .notification-settings .notification-option + .notification-option { margin-top: 2px; }
      .notification-settings .notification-option-text {
        flex: 1 1 auto;
        min-width: 0;
        white-space: normal;
        overflow-wrap: anywhere;
        line-height: 1.3;
      }
      .notification-settings .toggle-control {
        position: relative;
        width: 50px;
        height: 28px;
        flex: 0 0 50px;
      }
      .notification-settings .toggle-input {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        opacity: 0;
        cursor: pointer;
        z-index: 2;
      }
      .notification-settings .toggle-ui {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: rgba(144, 161, 181, .42);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .08);
        transition: background .18s ease, box-shadow .18s ease, opacity .18s ease;
        pointer-events: none;
      }
      .notification-settings .toggle-ui::after {
        content: '';
        position: absolute;
        top: 3px;
        left: 3px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 4px rgba(0, 0, 0, .28);
        transition: transform .18s ease;
      }
      .notification-settings .toggle-input:checked + .toggle-ui { background: var(--accent, #3390ec); }
      .notification-settings .toggle-input:checked + .toggle-ui::after { transform: translateX(22px); }
      .notification-settings .toggle-input:focus-visible + .toggle-ui { box-shadow: 0 0 0 3px var(--accent-soft, rgba(51, 144, 236, .22)); }
      .notification-settings .toggle-input:disabled { cursor: default; }
      .notification-settings .toggle-input:disabled + .toggle-ui { opacity: .45; }
      .notification-settings .notification-option:has(.toggle-input:disabled) .notification-option-text { opacity: .55; }
    `;
    document.head.appendChild(style);
  }

  function readNotificationSettingsFromForm() {
    return normalizeNotificationSettings({
      enabled: document.getElementById('nEnabled')?.checked,
      showText: document.getElementById('nText')?.checked,
      hideSender: document.getElementById('nSender')?.checked,
      sound: document.getElementById('nSound')?.checked,
      notifySystemEvents: document.getElementById('nSystemEvents')?.checked,
    });
  }

  function saveNotificationSettingsLocal() {
    state.notif = readNotificationSettingsFromForm();
    STORAGE.set(STORAGE.notif, state.notif);
    return state.notif;
  }

  async function syncPushPresentationSettings() {
    if (!state.notif.enabled) return;
    if (getNotificationPermission() === 'granted') {
      const subscription = await ensurePushSubscription({ requestPermission: false });
      if (subscription) await syncAllPushSubscriptions({ subscription });
    }
    await updateAllPushSettings();
  }

  installSettingsStyles();
  state.notif = normalizeNotificationSettings(state.notif);
  STORAGE.set(STORAGE.notif, state.notif);

  renderSettings = function renderSettingsAutoSave() {
    els.content.innerHTML = `<div class='panel'><h2>Настройки</h2><label>Ваш ник</label><input id="nick" value="${safeText(state.nick)}"/><label>Тема</label><select id='theme'><option value='auto'>Авто</option><option value='light'>Светлая</option><option value='dark'>Тёмная</option></select><div class='settings-section notification-settings'><h3>Уведомления</h3><label class='notification-option'><span class='notification-option-text'>Включить уведомления</span><span class='toggle-control'><input class='toggle-input' type='checkbox' id='nEnabled' ${state.notif.enabled?'checked':''}/><span class='toggle-ui' aria-hidden='true'></span></span></label><label class='notification-option'><span class='notification-option-text'>Показывать текст сообщения</span><span class='toggle-control'><input class='toggle-input' type='checkbox' id='nText' ${state.notif.showText?'checked':''}/><span class='toggle-ui' aria-hidden='true'></span></span></label><label class='notification-option'><span class='notification-option-text'>Скрывать отправителя</span><span class='toggle-control'><input class='toggle-input' type='checkbox' id='nSender' ${state.notif.hideSender?'checked':''}/><span class='toggle-ui' aria-hidden='true'></span></span></label><label class='notification-option'><span class='notification-option-text'>Звук нового сообщения</span><span class='toggle-control'><input class='toggle-input' type='checkbox' id='nSound' ${state.notif.sound?'checked':''}/><span class='toggle-ui' aria-hidden='true'></span></span></label><label class='notification-option'><span class='notification-option-text'>Уведомлять о входе и выходе</span><span class='toggle-control'><input class='toggle-input' type='checkbox' id='nSystemEvents' ${state.notif.notifySystemEvents!==false?'checked':''}/><span class='toggle-ui' aria-hidden='true'></span></span></label><p id='notificationPermissionStatus' class='settings-hint'></p><button id='requestNotificationsBtn' type='button' class='btn btn-secondary'>Разрешить уведомления</button></div><div class='settings-section'><h3>Установка приложения</h3><p id='installHelpText' class='settings-hint'></p><button id='installPwaBtn' class='btn btn-secondary'>Установить FPChat</button></div><div id='settingsVersion' class='sys'>${settingsVersionInfo}</div><div class='panel-actions'><button id='backBtn' class='btn btn-secondary'>Назад</button></div></div>`;

    void refreshSettingsVersionLine();

    const nick = document.getElementById('nick');
    nick?.addEventListener('input', () => {
      const value = nick.value.trim();
      if (!value) return;
      state.nick = value;
      localStorage.setItem(STORAGE.nick, state.nick);
    });
    nick?.addEventListener('blur', () => { if (!nick.value.trim()) nick.value = state.nick; });

    const theme = document.getElementById('theme');
    if (theme) {
      theme.value = localStorage.getItem(STORAGE.theme) || 'auto';
      theme.onchange = () => applyTheme(theme.value);
    }

    const enabled = document.getElementById('nEnabled');
    const text = document.getElementById('nText');
    const sender = document.getElementById('nSender');
    const sound = document.getElementById('nSound');
    const systemEvents = document.getElementById('nSystemEvents');

    const refreshNotificationUi = () => {
      updateNotificationOptionControls();
      if (systemEvents) systemEvents.disabled = !enabled.checked;
      renderNotificationPermissionStatus();
    };

    enabled.onchange = async () => {
      const sequence = ++notificationEnableSequence;
      const settings = saveNotificationSettingsLocal();
      refreshNotificationUi();
      if (!settings.enabled) {
        await unsubscribeAllPushDevices();
        if (sequence === notificationEnableSequence) renderNotificationPermissionStatus();
        return;
      }
      const subscription = await ensurePushSubscription({ requestPermission: true, showErrors: true });
      if (sequence !== notificationEnableSequence || !state.notif.enabled) return;
      if (subscription) {
        await syncAllPushSubscriptions({ subscription });
        await updateAllPushSettings();
      }
      renderNotificationPermissionStatus();
    };

    const saveSecondaryNotificationOption = (syncPushSettings) => {
      saveNotificationSettingsLocal();
      refreshNotificationUi();
      if (syncPushSettings) void syncPushPresentationSettings();
    };

    text.onchange = () => saveSecondaryNotificationOption(true);
    sender.onchange = () => saveSecondaryNotificationOption(true);
    sound.onchange = () => saveSecondaryNotificationOption(false);
    systemEvents.onchange = () => saveSecondaryNotificationOption(true);

    refreshNotificationUi();
    bindClick('requestNotificationsBtn', async () => {
      await enableNotificationsFromSettings();
      saveNotificationSettingsLocal();
      refreshNotificationUi();
    });
    bindClick('installPwaBtn', handleInstallClick);
    updateInstallUi();
    document.getElementById('backBtn').onclick = () => setView('chats');
  };
})();
