/* Build 181.2: single client owner for notification policy and PushSubscription synchronization. */
(() => {
  if (window.FPNotification181) return;

  const baseNormalize = normalizeNotificationSettings;
  let setupInFlight = null;
  let configCache = null;
  let configPromise = null;

  function normalize(value) {
    const normalized = baseNormalize(value);
    const raw = value && typeof value === 'object' ? value : {};
    return { ...normalized, notifySystemEvents: raw.notifySystemEvents !== false };
  }

  function canUsePush() {
    return typeof navigator !== 'undefined'
      && 'serviceWorker' in navigator
      && typeof window !== 'undefined'
      && 'PushManager' in window
      && typeof Notification !== 'undefined';
  }

  function permission() {
    return canUsePush() ? Notification.permission : 'unsupported';
  }

  async function pushConfig() {
    if (configCache) return configCache;
    if (configPromise) return configPromise;
    configPromise = fetch('/api/push/vapid-public-key', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return { enabled: false };
        const payload = await response.json();
        return payload?.enabled && typeof payload.publicKey === 'string' && payload.publicKey
          ? { enabled: true, publicKey: payload.publicKey }
          : { enabled: false };
      })
      .catch(() => ({ enabled: false }))
      .then((config) => {
        configCache = config;
        return config;
      })
      .finally(() => { configPromise = null; });
    return configPromise;
  }

  async function ensureSubscription({ requestPermission = false, showErrors = false } = {}) {
    if (setupInFlight) return setupInFlight;
    const run = async () => {
      const fail = (message) => {
        if (showErrors && message) alert(message);
        return null;
      };
      if (!canUsePush()) return fail('Push-уведомления недоступны в этом браузере или на этом устройстве.');
      if (configCache && !configCache.enabled) return fail('Push-уведомления сейчас недоступны на сервере.');
      let currentPermission = Notification.permission;
      if (currentPermission === 'denied') return fail('Уведомления запрещены браузером. Разрешите их для сайта в настройках браузера.');
      if (currentPermission === 'default') {
        if (!requestPermission) return null;
        try {
          currentPermission = await Notification.requestPermission();
        } catch {
          return fail('Не удалось запросить разрешение на уведомления.');
        }
        if (currentPermission !== 'granted') {
          return fail(currentPermission === 'denied'
            ? 'Уведомления запрещены браузером. Разрешите их для сайта в настройках браузера.'
            : 'Разрешение на уведомления не предоставлено.');
        }
      }
      if (currentPermission !== 'granted') return null;
      const cfg = await pushConfig();
      if (!cfg.enabled || !cfg.publicKey) return fail('Push-уведомления сейчас недоступны на сервере.');
      try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(cfg.publicKey)
          });
        }
        return subscription;
      } catch (error) {
        console.warn('Push subscription failed', error);
        return fail('Не удалось включить push-уведомления. Попробуйте ещё раз.');
      }
    };
    const pending = run();
    setupInFlight = pending;
    try {
      return await pending;
    } finally {
      if (setupInFlight === pending) setupInFlight = null;
    }
  }

  function serialized(subscription) {
    if (!subscription) return null;
    try {
      return typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
    } catch {
      return null;
    }
  }

  function settingsPayload() {
    return {
      showText: state.notif.showText,
      hideSender: state.notif.hideSender,
      notifySystemEvents: state.notif.notifySystemEvents !== false
    };
  }

  function deviceSettingsPayload() {
    return {
      hideSender: state.notif.hideSender,
      notifySystemEvents: state.notif.notifySystemEvents !== false
    };
  }

  async function syncDevice({ subscription = null, requestPermission = false, showErrors = false } = {}) {
    if (!state.notif.enabled) return false;
    const pushSubscription = subscription || await ensureSubscription({ requestPermission, showErrors });
    const bodySubscription = serialized(pushSubscription);
    const deviceId = String(getOrCreateDeviceId() || '').trim();
    if (!bodySubscription || !deviceId) return false;
    try {
      const response = await fetch('/api/push/device/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          subscription: bodySubscription,
          settings: deviceSettingsPayload()
        })
      });
      if (response.status === 404) return false;
      if (!response.ok && showErrors) console.warn('Device push subscription sync failed', response.status);
      return response.ok;
    } catch (error) {
      if (showErrors) console.warn('Device push subscription sync failed', error);
      return false;
    }
  }

  async function syncRoom(roomId, { requestPermission = false, showErrors = false, subscription = null } = {}) {
    if (!state.notif.enabled || state.roomMute[roomId]) return false;
    const persisted = STORAGE.get(STORAGE.roomState(roomId));
    if (!persisted?.deviceId) return false;
    const pushSubscription = subscription || await ensureSubscription({ requestPermission, showErrors });
    const bodySubscription = serialized(pushSubscription);
    if (!bodySubscription) return false;
    try {
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          deviceId: persisted.deviceId,
          subscription: bodySubscription,
          settings: settingsPayload()
        })
      });
      if (!response.ok && showErrors) alert('Не удалось сохранить подписку на уведомления для этого чата.');
      if (response.ok) void syncDevice({ subscription: pushSubscription });
      return response.ok;
    } catch {
      if (showErrors) alert('Не удалось подключиться для сохранения уведомлений.');
      return false;
    }
  }

  async function syncAll({ requestPermission = false, showErrors = false, subscription = null } = {}) {
    if (!state.notif.enabled) return false;
    const pushSubscription = subscription || await ensureSubscription({ requestPermission, showErrors });
    const bodySubscription = serialized(pushSubscription);
    if (!bodySubscription) return false;
    let synced = false;
    for (const { roomId, deviceId } of getLocalRoomDevicePairs()) {
      if (state.roomMute[roomId]) continue;
      try {
        const response = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            deviceId,
            subscription: bodySubscription,
            settings: settingsPayload()
          })
        });
        if (response.ok) synced = true;
        else if (showErrors) console.warn('Push subscription sync failed', roomId, response.status);
      } catch (error) {
        if (showErrors) console.warn('Push subscription sync failed', roomId, error);
      }
    }
    const deviceSynced = await syncDevice({ subscription: pushSubscription, showErrors });
    return synced || deviceSynced;
  }

  async function updateAllSettings({ showErrors = false } = {}) {
    let updated = false;
    for (const { roomId, deviceId } of getLocalRoomDevicePairs()) {
      try {
        const response = await fetch('/api/push/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, deviceId, ...settingsPayload() })
        });
        if (response.ok) updated = true;
        else if (showErrors) console.warn('Push settings update failed', roomId, response.status);
      } catch (error) {
        if (showErrors) console.warn('Push settings update failed', roomId, error);
      }
    }
    try {
      const response = await fetch('/api/push/device/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: getOrCreateDeviceId(), ...deviceSettingsPayload() })
      });
      if (response.ok) updated = true;
      else if (response.status !== 404 && showErrors) console.warn('Device push settings update failed', response.status);
    } catch (error) {
      if (showErrors) console.warn('Device push settings update failed', error);
    }
    return updated;
  }

  async function unsubscribeAll() {
    const deviceIds = [...new Set(getLocalRoomDevicePairs().map((pair) => pair.deviceId))];
    let unsubscribed = false;
    for (const deviceId of deviceIds) {
      try {
        const response = await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId })
        });
        if (response.ok) unsubscribed = true;
      } catch {}
    }
    try {
      const response = await fetch('/api/push/device/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: getOrCreateDeviceId() })
      });
      if (response.ok) unsubscribed = true;
    } catch {}
    return unsubscribed;
  }

  async function initialize() {
    if (!state.notif.enabled || permission() !== 'granted') return false;
    return syncAll();
  }

  async function requestFromGesture({ force = false } = {}) {
    if (!state.notif.enabled || !canUsePush()) return null;
    const currentPermission = Notification.permission;
    if (currentPermission === 'granted') return null;
    if (currentPermission !== 'default') return null;
    if (!force && localStorage.getItem(NOTIFICATION_PROMPTED_KEY) === '1') return null;
    if (!force) localStorage.setItem(NOTIFICATION_PROMPTED_KEY, '1');
    const subscription = await ensureSubscription({ requestPermission: true });
    if (subscription) await syncAll({ subscription });
    renderNotificationPermissionStatus();
    return subscription;
  }

  async function enableFromSettings() {
    const checkbox = document.getElementById('nEnabled');
    if (checkbox) checkbox.checked = true;
    state.notif = { ...normalize(state.notif), enabled: true };
    STORAGE.set(STORAGE.notif, state.notif);
    updateNotificationOptionControls();
    const subscription = await ensureSubscription({ requestPermission: true, showErrors: true });
    if (subscription) {
      await syncAll({ subscription });
      await updateAllSettings();
    }
    renderNotificationPermissionStatus();
  }

  const persisted = STORAGE.get(STORAGE.notif) || {};
  state.notif = normalize({ ...state.notif, notifySystemEvents: persisted.notifySystemEvents });
  STORAGE.set(STORAGE.notif, state.notif);

  normalizeNotificationSettings = normalize;
  getNotificationPermission = permission;
  ensurePushSubscription = ensureSubscription;
  syncRoomPushSubscription = syncRoom;
  syncAllPushSubscriptions = syncAll;
  updateAllPushSettings = updateAllSettings;
  unsubscribeAllPushDevices = unsubscribeAll;
  initializeNotifications = initialize;
  maybeRequestNotificationsFromUserGesture = requestFromGesture;
  enableNotificationsFromSettings = enableFromSettings;

  window.FPNotification181 = Object.freeze({
    normalize,
    canUsePush,
    permission,
    ensureSubscription,
    syncRoom,
    syncAll,
    syncDevice,
    updateAllSettings,
    unsubscribeAll,
    initialize,
    owner: 'NotificationManager181'
  });

  if (state.notif.enabled && permission() === 'granted') {
    queueMicrotask(() => { void syncAll(); });
  }
})();
