# FPChat Build 171 — Network, media cache and memory ownership

Build 171 разрабатывается только в `build/171-development` поверх Build 170. Ветка содержит всю цепочку Build 169 → 170 → 171. `main` остаётся на стабильной Build 168 до ручной регрессии.

## Цель

Передать клиентскую сеть, XHR upload, физические изменения managed media cache и ограничение ресурсоёмких media-download одному согласованному владельцу, не меняя пользовательскую механику FPChat.

Главное правило приёмки Build 171:

> Старая функция может временно остаться compatibility adapter, но она больше не должна независимо владеть глобальным transport/cache ресурсом.

## Реализовано

### 1. Один владелец `window.fetch`

Добавлен `public/network171.js` — `FPNetwork171`.

Он загружается до `app.js` и становится публичным владельцем `window.fetch`.

Существующие legacy-обёртки не удалены одним рискованным коммитом. Во время их загрузки Build 171 регистрирует их как именованные стадии фиксированного pipeline. Порядок больше не зависит от скорости загрузки скриптов.

Сохраняются compatibility stages для:

- Storage 167 cache-copy;
- clear-cache guard;
- managed media cache;
- voice-block feedback;
- chat-request cooldown;
- chat-request owner;
- room lifecycle;
- typing/activity transport.

Новый код может использовать `FPNetwork171.use(...)` без создания очередного `window.fetch = ...`.

### 2. Один владелец XMLHttpRequest transport

Build 171 также владеет `XMLHttpRequest.prototype.open/send`.

Это важно, потому что media upload в FPChat использует XHR ради progress events.

Существующий XHR typing/activity слой подключается как compatibility adapter, а новый код получает:

```js
FPNetwork171.upload(...)
```

Поддерживаются:

- upload progress;
- AbortSignal;
- timeout;
- responseType;
- headers;
- существующая семантика ошибок XHR.

Прямые существующие XHR upload-вызовы продолжают работать через тот же владелец.

### 3. Ограничение параллельных media-download

GET-запросы:

```text
/api/media/<id>/blob
/api/media/<id>/thumb
```

проходят через общий media budget.

Текущий предел — 4 одновременно активных media-download. Остальные ожидают свободный слот. AbortSignal отменяет ожидание до запуска запроса.

Это ограничивает всплески одновременной загрузки фото, видео, голосовых и превью, не меняя серверные API и формат данных.

### 4. Один physical owner managed media cache

Формат кэша не изменён:

```text
fpchat-media-v167
```

Build 171 не создаёт `fpchat-media-v171`.

Для этого cache name установлен единый mutation gate на `Cache.put/delete`:

- одинаковые одновременные записи одного URL объединяются;
- уже существующая запись не записывается повторно;
- во время clear-cache новые физические записи не выполняются;
- delete ждёт уже начатую запись того же ключа;
- ошибки и количество операций попадают только в техническую диагностику.

Legacy Storage 167/cache-fix временно остаются адаптерами, но физическое изменение managed cache проходит через одного владельца.

### 5. Очистка памяти media viewer

Галерея Build 134 уже использует bounded asset window и отзывает старые ObjectURL через `URL.revokeObjectURL()`.

В Build 171 дополнительно исправлен voice playback cache:

- `voiceBlobCache` ограничен 6 записями;
- используется LRU-подобное обновление порядка;
- при вытеснении ObjectURL отзывается;
- при смене комнаты blob cache очищается;
- `voiceMessages` очищается при смене комнаты;
- при `pagehide` playback останавливается и blob URLs освобождаются;
- активный playback не удаляется из-под проигрывания.

Для диагностики доступны:

```js
FPVoice.memorySnapshot()
FPVoice.clearBlobCache()
```

### 6. Диагностика

```js
FPNetwork171.snapshot()
```

показывает:

- fetch requests/native calls/errors;
- зарегистрированные fetch layers;
- XHR ownership и legacy XHR layers;
- uploads/errors;
- media concurrency: active/queued/peak/completed/cancelled;
- media cache writes/joined/skipped/deletes/failures;
- попытки неизвестного кода заменить transport owner.

Содержимое сообщений, room keys, recovery-коды, deviceId и media bytes не логируются.

Build 169 FPRuntime и Build 170 RoomContext/Lifecycle/Connection остаются активны.

## Автоматическая статическая проверка

```bat
npm run check:171
```

Проверяет:

- `version.json = 171`;
- загрузку `network171.js` перед app;
- ownership `window.fetch`;
- ownership XHR open/send;
- наличие общего XHR upload API;
- фиксированный legacy fetch pipeline;
- отсутствие неизвестных fetch/XHR replacement;
- сохранение `fpchat-media-v167`;
- наличие единого media cache mutation gate;
- bounded voice blob cache;
- обязательный `URL.revokeObjectURL` при eviction;
- очистку voice cache при смене комнаты.

Эта проверка не заменяет тестирование в браузерах.

## Обязательная ручная регрессия перед merge в main

Проверить минимум:

1. холодный запуск, reload, PWA reopen;
2. создание комнаты, invite и recovery;
3. A → B → A с задержанными запросами;
4. text send/reply/edit/delete/reactions;
5. unread/read/checkmarks;
6. typing/presence;
7. block/unblock и voice-block feedback;
8. username requests/cooldown/accept/reject/block;
9. photo/video/file upload с progress;
10. отмену media upload;
11. voice record/preview/send/playback/seek;
12. последовательное воспроизведение большого числа голосовых;
13. photo/video gallery и многократное открытие media;
14. media autoload/cache hit;
15. clear cache во время активной media загрузки;
16. background → foreground;
17. offline → online;
18. ПК, слабый Android и iPhone PWA.

## Статус

Кодовая часть Build 171 завершена в `build/171-development`.

До переноса в `main` остаётся только ручная multi-device регрессия. CI в репозитории не настроен, поэтому отсутствие CI-проверки не считается подтверждением работоспособности на реальных устройствах.
