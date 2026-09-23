# Build 181 — Notification ownership contract

Base: Build 180.14, main SHA `f1ae894bf31211d037581becc9ecb656f5fbe109`.

## Goal

Add push delivery for personal FPChat system events, starting with `chat_request_received`, while preserving Build 180.14 message, room-system-event, mute, permission and service-worker behavior.

## Ownership

- **SystemEventStore** is the durable source of truth for personal system events. Push delivery never creates, resolves or marks a system event read.
- **NotificationManager181** is the single client owner for notification settings, browser permission, PushSubscription synchronization and device-level notification registration.
- **NotificationService181** is the single server executor for Web Push delivery and delivery deduplication.
- **sw.js** only renders a delivered notification and hands a click back to the client.
- **System Chat controller** renders and resolves system events; it does not own Web Push.
- **Chat Request owner** creates/resolves chat requests; it does not own Web Push.
- **FPRuntime169** may observe anonymous counters/errors only and never triggers notification work.

## Settings contract

Existing storage remains `fpchat:notif`.

`notifySystemEvents`:
- boolean;
- defaults to `true`;
- means **all FPChat system push notifications**;
- disabling it does not suppress creation, unread state, rendering or actions of system events.

Message settings remain unchanged:
- `enabled`
- `showText`
- `hideSender`
- `sound`

The settings UI label is **Получать системные уведомления**.

## Delivery classes

### Room notifications

Existing room subscriptions remain responsible for ordinary chat messages and existing room-scoped system messages such as participant join/leave.

### Device notifications

Build 181 adds device-level registration for personal FPChat system events that are not owned by a room membership. A chat request is the first required case because the target device is not yet a participant in the pending room.

A browser PushSubscription may be represented in room and device registration records, but one system event must not generate duplicate device pushes.

## Personal system-event flow

```text
business owner
  -> SystemEventStore.add(...)
  -> durable system_events row
  -> NotificationService181
  -> notifySystemEvents policy
  -> dedupe claim
  -> Web Push
  -> sw.js
  -> click handoff
  -> System Chat
```

The push path is secondary. Push failure must not roll back or remove the system event.

## Privacy

Personal system push payloads may include display-safe presentation text and routing identifiers:
- category/type
- event type
- refType
- refId / systemEventId

They must not include:
- roomSecret
- inviteCode
- recovery material
- encryption keys
- another user's private device identifier

## Click routing

A personal system push opens FPChat and requests the System Chat surface. It must not open a pending room before the chat request is accepted.

## Dedupe

For personal system push:

```text
one durable system_event + one target device = at most one successful delivery claim
```

Retries after a transport failure may release the claim. Repeated creation attempts that hit the SystemEventStore dedupe key must not create additional push work.

## Build 181 stages

1. **181.1** ownership/behavior contract.
2. **181.2** install NotificationManager181 and remove the legacy `window.fetch` notification-settings monkey patch.
3. **181.3** add NotificationService181 and device-level subscription/settings storage.
4. **181.4** bridge inserted personal SystemEventStore rows to NotificationService181.
5. **181.5** add service-worker/client routing for personal system notification clicks.
6. **181.6** finalize settings UI label/default and synchronization.
7. **181.7** regression/static acceptance and version bump.

## Acceptance invariants

- Existing ordinary message push behavior does not change.
- Existing room mute behavior does not change.
- Existing room join/leave push remains gated by `notifySystemEvents`.
- `notifySystemEvents=false` suppresses personal system push but not the System Chat event.
- A target with no membership in the pending request room can still receive a chat-request push if device push is registered.
- No second global fetch interceptor is introduced.
- NotificationManager181 has one PushSubscription setup promise and no independent retry queue.
- A notification click never exposes invite/recovery/encryption data.
- `main` is not modified by Build 181 development commits.
