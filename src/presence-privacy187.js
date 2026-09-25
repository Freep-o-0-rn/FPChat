/* Build 187: viewer-safe presence projection. Server raw presence remains canonical and unmasked. */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SETTINGS = Object.freeze({
  showOnlineStatus: true,
  showLastSeenExact: true
});

function parseServerTimeMs(value) {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  const text = String(value).trim();
  if (!text) return NaN;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  return Date.parse(normalized);
}

function coarsePresenceState(lastSeenAt, nowMs = Date.now()) {
  const seenMs = parseServerTimeMs(lastSeenAt);
  if (!Number.isFinite(seenMs)) return 'long_ago';
  const ageMs = Math.max(0, Number(nowMs) - seenMs);
  if (ageMs < 3 * DAY_MS) return 'recently';
  if (ageMs < 7 * DAY_MS) return 'week';
  if (ageMs < 30 * DAY_MS) return 'month';
  return 'long_ago';
}

function createPresencePrivacy187(db) {
  if (!db) throw new Error('presence privacy database is required');

  const privacyByDevice = db.prepare(`
    SELECT show_online_status, show_last_seen_exact
    FROM user_privacy_settings
    WHERE device_id=?
  `);

  function settingsFor(deviceId) {
    const id = String(deviceId || '').trim();
    const row = id ? privacyByDevice.get(id) : null;
    return {
      showOnlineStatus: row ? Number(row.show_online_status) !== 0 : DEFAULT_SETTINGS.showOnlineStatus,
      showLastSeenExact: row ? Number(row.show_last_seen_exact) !== 0 : DEFAULT_SETTINGS.showLastSeenExact
    };
  }

  function project(item, viewerId, { hidden = false, toIsoUtc = null, nowMs = Date.now() } = {}) {
    const subjectId = String(item?.device_id ?? item?.deviceId ?? '').trim();
    const viewer = String(viewerId || '').trim();

    if (hidden && subjectId !== viewer) {
      return {
        online: false,
        lastSeenAt: null,
        presenceState: 'unavailable',
        statusUnavailable: true
      };
    }

    const rawOnline = Boolean(item?.online);
    const rawLastSeen = item?.last_seen_at ?? item?.lastSeenAt ?? null;
    const settings = subjectId && subjectId === viewer ? DEFAULT_SETTINGS : settingsFor(subjectId);

    if (!settings.showOnlineStatus) {
      return {
        online: false,
        lastSeenAt: null,
        presenceState: rawOnline ? 'recently' : coarsePresenceState(rawLastSeen, nowMs)
      };
    }

    if (rawOnline) {
      return {
        online: true,
        lastSeenAt: null,
        presenceState: 'online'
      };
    }

    if (settings.showLastSeenExact) {
      const exact = rawLastSeen
        ? (typeof toIsoUtc === 'function' ? toIsoUtc(rawLastSeen) : rawLastSeen)
        : null;
      return {
        online: false,
        lastSeenAt: exact || null,
        presenceState: exact ? 'exact' : 'long_ago'
      };
    }

    return {
      online: false,
      lastSeenAt: null,
      presenceState: coarsePresenceState(rawLastSeen, nowMs)
    };
  }

  return {
    settingsFor,
    project
  };
}

module.exports = {
  DAY_MS,
  DEFAULT_SETTINGS,
  parseServerTimeMs,
  coarsePresenceState,
  createPresencePrivacy187
};
