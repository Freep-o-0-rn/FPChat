# FPChat Build 169 — baseline и приёмка

Build 169 — диагностическая сборка. Она не должна менять пользовательскую механику Build 168.

## Клиент

После загрузки приложения в DevTools Console доступны:

```js
FPRuntime.snapshot()
FPRuntime.inspect()
FPRuntime.resourceSummary(60000)
```

`inspect()` дополнительно показывает статически подтверждённые legacy-владельцы/polling из аудита. Это карта технического долга, а не утверждение, что каждый ресурс активен в конкретную секунду.

### Покрытие

FPRuntime обязан честно показывать поле `coverage`.

- `timers` и `observers` — только зарегистрированные/известные; отсутствие записи не означает отсутствие ресурса.
- `memory` зависит от браузера; WebKit может не предоставлять JS heap metrics.
- `resourcesLastMinute` основан на Resource Timing и отражает завершённые сетевые ресурсы, которые браузер сохранил в performance buffer.
- `websocket` в 169 — snapshot текущего состояния, не новый владелец соединения.

FPRuntime не сохраняет текст сообщений, room secret, recovery code или deviceId.

## Сервер

Сэмплер по умолчанию выключен и не меняет production startup.

Для диагностического запуска:

```bat
set FPCHAT_DIAGNOSTICS=1
set FPCHAT_DIAGNOSTICS_INTERVAL_MS=10000
node -r ./scripts/server-runtime169.js -r ./src/message-actions-bootstrap.js server.js
```

В консоль выводятся строки `[FPDiag169]` с:

- RSS;
- heap used/total;
- external/ArrayBuffer memory;
- event-loop utilization;
- mean/p95/p99/max event-loop delay.

Сэмплер не перехватывает HTTP/WS/SQLite и активируется только через `FPCHAT_DIAGNOSTICS=1`.

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
- `bootReadyMs`, если событие поймано;
- completed resources/min по категориям;
- long task count/duration;
- DOM node count и число message bubbles;
- JS heap, если поддерживается;
- errors/unhandled rejections;
- websocket readyState.

Сервер при включённом sampler:

- RSS/external/arrayBuffers;
- event-loop delay;
- event-loop utilization;
- поведение памяти до/после media upload.

DB query count/timing в первом диагностическом этапе не выдаётся как «0»: полноценная DB instrumentation должна быть добавлена отдельно и не должна monkey-patch'ить рабочую БД без необходимости.

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
- Диагностика не публикует приватные данные.
- В baseline нет новых стабильных JS errors/rejections.
- Измерения имеют указанное покрытие; неизвестное не показывается как ноль.
- Есть сохранённые baseline-результаты минимум для ПК и одного мобильного устройства; перед Build 170 желательно добавить iPhone PWA и слабый Android.
