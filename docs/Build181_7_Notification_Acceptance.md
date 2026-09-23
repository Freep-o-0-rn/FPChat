# Build 181.7 — notification acceptance

Base: Build 180.14 (`f1ae894bf31211d037581becc9ecb656f5fbe109`)

## Implemented

- Client notification ownership moved to `NotificationManager181`.
- Removed the legacy `room-lifecycle.js` global `window.fetch` patch used to inject `notifySystemEvents`.
- Existing `fpchat:notif` storage remains the only client notification settings store.
- `notifySystemEvents` defaults to `true` and the UI label is **Получать системные уведомления**.
- Added device-level PushSubscription registration for personal FPChat system events.
- Server Web Push execution moved behind `NotificationService181`.
- Existing room message push and participant join/leave push keep their previous room subscription/dedupe path.
- Durable `SystemEventStore.add()` inserts publish a post-insert observer signal.
- NotificationService re-reads the durable `system_events` row before personal push, preventing push from a rolled-back outer transaction.
- Added device/system-event dedupe: one `system_event_id + device_id` claim.
- Added personal system push formatting for chat request received/accepted/rejected/expired and generic future system events.
- Service worker routes personal system notification clicks to System Chat rather than a pending room.
- System Chat can focus the selected `systemEventId`.

## Static acceptance

The Build 181.7 regression checks:
- JavaScript syntax for all changed JS files;
- owner load order;
- absence of the old fetch monkey-patch;
- default/system setting contract;
- device subscription endpoints;
- room push delegation;
- durable-event re-read;
- system-event observer bridge;
- system push dedupe;
- absence of invite/recovery/encryption secrets in personal system payload construction;
- service-worker `open-system` routing;
- System Chat event targeting.

Command:

```bash
npm run test:181:notifications
```

## Physical acceptance still required

Static acceptance does **not** prove browser push delivery. Before release to production, physically verify at least:

1. Device B has notifications enabled and **Получать системные уведомления = ON**.
2. Device A sends a new chat request to B.
3. B receives exactly one push even though B is not yet a participant in the pending room.
4. Tapping the push opens System Chat and focuses the request; it does not enter the pending room.
5. Rejecting/accepting/blocking still uses the existing chat-request behavior.
6. With **Получать системные уведомления = OFF**, the System Chat event/unread remains but no personal system push is shown.
7. Re-enable the toggle and verify push resumes without recreating the account/profile.
8. Ordinary message push, room mute, participant join/leave push and foreground-room suppression remain as in Build 180.14.
9. Restart/PWA reload does not create duplicate push delivery for one system event.
10. Test at least desktop Chromium and the installed iPhone PWA path used for FPChat.

Production/main is not changed automatically.
