/* Build 95: settings are saved immediately; notification checkbox stays left of text. */
(() => {
  const STYLE_ID = "fpchat-settings-autosave-style";
  let notificationEnableSequence = 0;

  function installSettingsStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .notification-settings .notification-option {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 12px;
        width: 100%;
        min-height: 44px;
        margin: 0;
      }
      .notification-settings .notification-option + .notification-option {
        margin-top: 2px;
      }
      .notification-settings .notification-option > span {
        flex: 1 1 auto;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .notification-settings .notification-option > input[type="checkbox"] {
        width: 24px;
        height: 24px;
        flex: 0 0 24px;
        margin: 0;
      }
    `;
    document.head.appendChild(style);
  }

  function readNotificationSettingsFromForm() {
    return normalizeNotificationSettings({
      enabled: document.getElementById("nEnabled")?.checked,
      showText: document.getElementById("nText")?.checked,
      hideSender: document.getElementById("nSender")?.checked,
      sound: document.getElementById("nSound")?.checked,
    });
  }

  function saveNotificationSettingsLocal() {
    state.notif = readNotificationSettingsFromForm();
    STORAGE.set(STORAGE.notif, state.notif);
    return state.notif;
  }

  async function syncPushPresentationSettings() {
    if (!state.notif.enabled) return;

    // Do not trigger a permission prompt for secondary options. If push is
    // already available, keep the server subscription/settings in sync.
    if (getNotificationPermission() === "granted") {
      const subscription = await ensurePushSubscription({ requestPermission: false });
      if (subscription) await syncAllPushSubscriptions({ subscription });
    }
    await updateAllPushSettings();
  }

  installSettingsStyles();

  renderSettings = function renderSettingsAutoSave() {
    els.content.innerHTML = `<div class='panel'><h2>Настройки</h2><label>Ваш ник</label><input id="nick" value="${safeText(state.nick)}"/><label>Тема</label><select id='theme'><option value='auto'>Авто</option><option value='light'>Светлая</option><option value='dark'>Тёмная</option></select><div class='settings-section notification-settings'><h3>Уведомления</h3><label class='notification-option'><input type='checkbox' id='nEnabled' ${state.notif.enabled?'checked':''}/><span>Включить уведомления</span></label><label class='notification-option'><input type='checkbox' id='nText' ${state.notif.showText?'checked':''}/><span>Показывать текст сообщения</span></label><label class='notification-option'><input type='checkbox' id='nSender' ${state.notif.hideSender?'checked':''}/><span>Скрывать отправителя</span></label><label class='notification-option'><input type='checkbox' id='nSound' ${state.notif.sound?'checked':''}/><span>Звук нового сообщения</span></label><p id='notificationPermissionStatus' class='settings-hint'></p><button id='requestNotificationsBtn' type='button' class='btn btn-secondary'>Разрешить уведомления</button></div><div class='settings-section'><h3>Установка приложения</h3><p id='installHelpText' class='settings-hint'></p><button id='installPwaBtn' class='btn btn-secondary'>Установить FPChat</button></div><div id='settingsVersion' class='sys'>${settingsVersionInfo}</div><div class='panel-actions'><button id='backBtn' class='btn btn-secondary'>Назад</button></div></div>`;

    void refreshSettingsVersionLine();

    const nick = document.getElementById("nick");
    nick?.addEventListener("input", () => {
      const value = nick.value.trim();
      if (!value) return;
      state.nick = value;
      localStorage.setItem(STORAGE.nick, state.nick);
    });
    nick?.addEventListener("blur", () => {
      if (!nick.value.trim()) nick.value = state.nick;
    });

    const theme = document.getElementById("theme");
    if (theme) {
      theme.value = localStorage.getItem(STORAGE.theme) || "auto";
      theme.onchange = () => applyTheme(theme.value);
    }

    const enabled = document.getElementById("nEnabled");
    const text = document.getElementById("nText");
    const sender = document.getElementById("nSender");
    const sound = document.getElementById("nSound");

    const refreshNotificationUi = () => {
      updateNotificationOptionControls();
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

    refreshNotificationUi();
    bindClick("requestNotificationsBtn", async () => {
      await enableNotificationsFromSettings();
      saveNotificationSettingsLocal();
      refreshNotificationUi();
    });
    bindClick("installPwaBtn", handleInstallClick);
    updateInstallUi();
    document.getElementById("backBtn").onclick = () => setView("chats");
  };
})();
