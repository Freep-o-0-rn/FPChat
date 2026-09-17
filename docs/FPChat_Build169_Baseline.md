# FPChat Build 169 — baseline и приёмка

Build 169 — диагностическая сборка. Она не должна менять пользовательскую механику Build 168.

## Клиент

После загрузки приложения в DevTools Console доступны:

```js
FPRuntime.snapshot()
FPRuntime.inspect()
FPRuntime.resourceSummary(60000)
FPRuntime.capture('idle-list')
await FPRuntime.sampleMemory()
```

Для ручного замера операции, которая ещё не имеет собственного владельца:

```js
const t = FPRuntime.startMeasure('manual-room-open');
// выполнить действие
FPRuntime.endMeasure(t);
FPRuntime.measurementSummary();
```

`inspect()` дополнительно показывает статически подтверждённые legacy-владельцы/polling из аудита. Это карта технического долга, а не утверждение, что каждый ресурс активен в конкретную секунду.

### Покрытие

FPRuntime обязан честно показывать поле `coverage`.

- `timers` и `observers` — статически известные и явно зарегистрированные; отсутствие записи не означает отсутствие ресурса.
- `knownLegacyCounts` показывает только подтверждённые аудитом механизмы, а не полный runtime count.
- `memory` зависит от браузера; WebKit может не предоставлять JS heap metrics.
- `resourcesLastMinute` основан на Resource Timing и отражает завершённые сетевые ресурсы, которые браузер сохранил в performance buffer.
- `websocket` в 169 — snapshot текущего состояния, не новый владелец соединения.
- точное время открытия комнаты/reconnect до Build 170 не объявляется автоматически полным измерением; для этого есть ручной measurement API.

FPRuntime не сохраняет текст сообщений, room secret, recovery code или deviceId.

## Сервер

Production-команда `npm start` не изменена.

Для диагностического запуска:

```bat
npm run start:diag169
```

По умолчанию sampler пишет строку каждые 10 секунд. Интервал можно изменить переменной `FPCHAT_DIAGNOSTICS_INTERVAL_MS`.

В консоль выводятся строки `[FPDiag169]` с:

- RSS;
- heap used/total;
- external/ArrayBuffer memory;
- event-loop utilization;
- mean/p95/p99/max event-loop delay.

Сэмплер не перехватывает HTTP/WS/SQLite и запускается только через отдельную диагностическую команду.

### Read-only DB baseline

Для агрегированной проверки текущей SQLite базы:

```bat
npm run db:diag169
```

Команда открывает БД read-only и выводит только:

- количество строк по основным таблицам;
- время выполнения агрегированных `COUNT(*)`;
- список явных индексов;
- `EXPLAIN QUERY PLAN` для history latest/before/after и media-by-message.

Текст сообщений, nick, username, deviceId, ключи и содержимое media не выводятся.

## Сценарии baseline

Каждый сценарий выполняется минимум 3 раза на одинаковых данных. Фиксируются медиана и худший результат.

1. Холодный запуск приложения.
2. Тёплый reload.
3. Открытие комнаты с ~100 последними сообщениями.
4. Быстрое A → B → A.
5. 60 секунд idle на экране списка чатов.
6. 60 секунд idle в открытой комнате.
7. Отправка текста + reply + edit + delete.
8. Фото/voice: открытие, повторное открытие, закрытие.
9. Background → foreground через 10–30 секунд.
10. Потеря сети → восстановление.
11. Длинная история: несколько lazy-load страниц вверх.
12. Очистка media cache во время активной загрузки.

## Что записываем

Клиент:

- navigation timings;
- точный `bootReadyMs`, когда marker Build 169 доступен;
- completed resources/min по категориям;
- long task count/duration;
- DOM node count и число message bubbles;
- JS heap, если поддерживается;
- errors/unhandled rejections;
- websocket readyState;
- статически известные legacy polling/observer/owner counts;
- повторные `capture()` в одинаковых контрольных точках.

Сервер при диагностическом запуске:

- RSS/external/arrayBuffers;
- event-loop delay;
- event-loop utilization;
- поведение памяти до/после media upload.

SQLite read-only baseline:

- row counts;
- explicit indexes;
- query plans для основных history/media запросов.

Полноценный runtime DB query count/timing в Build 169 не выдаётся как `0`: его нет без отдельной инструментализации рабочих statements.

## Обязательная регрессия Build 168

До принятия Build 169 вручную проверить:

- text send/reconnect/retry;
- reply;
- edit/delete/reactions;
- unread, received/read checkmarks;
- typing/presence и их block privacy;
- block/unblock;
- invite и системные события;
- photo/video/file/voice;
- media cache/autoload/clear;
- lazy history/scroll restoration/first unread;
- long-press/context menu/selection;
- swipe navigation;
- keyboard/viewport на мобильном.

## Критерий принятия 169

- UX и логика соответствуют Build 168.
- FPRuntime работает в shadow mode и не становится владельцем существующих механизмов.
- Production `npm start` остаётся прежним.
- Диагностика не публикует приватные данные.
- В baseline нет новых стабильных JS errors/rejections.
- Измерения имеют указанное покрытие; неизвестное не показывается как ноль.
- Есть сохранённые baseline-результаты минимум для ПК и одного мобильного устройства; перед Build 170 желательно добавить iPhone PWA и слабый Android.
