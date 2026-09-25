# Build 187.1 — Presence Privacy

**База:** Build 186.5 (`build/186-development`)  
**Ветка разработки:** `build/187-development`

## Цель

Добавить пользовательские настройки видимости presence без изменения канонического server-side состояния и без вмешательства в существующих владельцев Lifecycle/Connection/Room/Network.

## Каноническое состояние

Сервер по-прежнему всегда хранит и использует реальные:

- `participants.online`;
- `participants.last_seen_at`.

Privacy не изменяет эти поля и не участвует в `syncDevicePresence()`.

## Настройки

В существующую таблицу `user_privacy_settings` добавлены два поля с безопасным default `1`:

- `show_online_status`;
- `show_last_seen_exact`.

Существующие пользователи после миграции остаются в прежнем режиме FULL.

UI страницы **Конфиденциальность** получил два toggle:

- **Показывать статус онлайн/оффлайн**;
- **Показывать точное время посещения**.

## Режимы

Эффективный режим вычисляется из двух настроек:

| show_online_status | show_last_seen_exact | Режим |
|---|---|---|
| true | true | FULL |
| true | false | APPROXIMATE |
| false | true/false | PRIVATE |

### FULL

- online → `Онлайн`;
- offline → точное время: сегодня / вчера / дата и время.

### APPROXIMATE

- online → `Онлайн`;
- offline → только coarse state:
  - `< 3 суток` → `был недавно`;
  - `3–7 суток` → `был на этой неделе`;
  - `7–30 суток` → `был в этом месяце`;
  - `>= 30 суток` → `был давно`.

Точный timestamp viewer'у не передаётся.

### PRIVATE

- реальный online остаётся известен серверу;
- viewer не получает `online=true`;
- viewer не получает точный `lastSeenAt`;
- если subject сейчас online, projected state = `recently`;
- offline использует тот же coarse bucket.

Обычные raw online/offline переходы PRIVATE-пользователя не рассылаются через WebSocket. Изменение privacy-настройки выполняет один принудительный projected `presence:update`, чтобы peer увидел новое разрешённое состояние без reconnect.

## Архитектура

Новый `src/presence-privacy187.js` — pure policy/projector, а не Manager/Arbiter.

Он не создаёт:

- WebSocket;
- fetch/XHR;
- timer/polling;
- cache;
- lifecycle listener;
- отдельный store presence.

Поток:

```text
FPLifecycle170 / FPConnection170
          ↓
existing stable WS worker
          ↓
syncDevicePresence()
          ↓
RAW server presence
          ↓
fpUserBlocks165 block rule
          ↓
PresencePrivacy187 projector
          ↓
viewer-safe DTO
     ↙       ↓       ↘
participants[]  presence:update  room-status
```

Block visibility имеет более высокий приоритет, чем privacy. Если subject заблокировал viewer, результат остаётся `unavailable`.

## Совместимость

Сохраняются поля:

- `online`;
- `lastSeenAt`.

Добавлено:

- `presenceState`: `online | exact | recently | week | month | long_ago | unavailable`.

Для APPROXIMATE/PRIVATE exact timestamp отсутствует. Для PRIVATE `online` всегда false в viewer-safe DTO.

Старый клиент получает безопасный fallback и не получает скрытые raw-данные.

## Производительность

Новых циклов, watchdog, poller или transport нет. На projection используется prepared SQLite SELECT существующей privacy-таблицы. В FPChat диалог 1-на-1, поэтому количество чтений на presence event ограничено и не вводит новый scheduler.

## Проверка

Добавлен:

```bash
npm run test:187:presence-privacy
```

Он фиксирует:

- FULL / APPROXIMATE / PRIVATE;
- coarse boundaries 3 / 7 / 30 суток;
- отсутствие exact timestamp в APPROXIMATE/PRIVATE;
- скрытие raw Online в PRIVATE;
- приоритет block → unavailable;
- отсутствие WebSocket/fetch/timer в policy;
- сохранение raw server presence writer;
- подключение обоих toggle.

`npm run test:187` также включает релевантные Build 179/180 presence/block regressions и полный `test:186`.
