# FPChat Build 171 — Network Coordinator

Build 171 создаётся в `build/171-development` поверх `build/170-development`. Ветка Build 170 уже является прямым продолжением Build 169, поэтому Build 171 содержит изменения 169 + 170 без переноса в `main`.

`main` по-прежнему остаётся на стабильной Build 168 до ручной регрессии.

## Цель

Убрать зависимость сетевого поведения клиента от случайного порядка вложенных `window.fetch`-обёрток и передать глобальный `fetch` одному владельцу, не меняя пользовательскую механику FPChat.

## Реализовано

### Один владелец `window.fetch`

Добавлен `public/network171.js` — `FPNetwork171`.

Он устанавливается до `app.js` и становится единственным публичным владельцем `window.fetch`.

Новые запросы FPChat идут через:

```text
window.fetch
    ↓
FPNetwork171
    ↓
ordered transport pipeline
    ↓
native browser fetch
```

Сам `FPNetwork171` не создаёт новые HTTP-запросы и не меняет API. Он только определяет порядок существующих сетевых слоёв.

### Детерминированный pipeline

Старые транспортные слои больше не могут случайно становиться внешней `fetch`-обёрткой в зависимости от скорости загрузки скриптов.

Build 171 закрепляет порядок:

1. cache response copy (`storage167-cache-fix`);
2. media cleanup guard;
3. managed media cache;
4. voice block response feedback;
5. chat-request cooldown observer;
6. chat-request room owner;
7. room lifecycle push-settings extension;
8. typing/media activity transport observer;
9. native browser `fetch`.

Legacy-модули пока физически содержат старые присваивания `window.fetch = ...`, но в Build 171 они не заменяют глобальную функцию. `FPNetwork171` перехватывает их во время загрузки и регистрирует как именованные стадии pipeline с фиксированным приоритетом.

Это переходный слой: поведение старых модулей сохраняется, но глобальный ресурс уже имеет одного владельца.

### Почему сделано через adapter, а не массовую перепись восьми модулей

Одновременное переписывание `storage167`, cleanup guard, cache-fix, cooldown, request owner, room lifecycle, typing и voice feedback создало бы слишком большой регрессионный риск.

Build 171 сначала меняет владение ресурсом, сохраняя исполняемую логику этих модулей. После подтверждения регрессии отдельные legacy adapters можно по одному переводить на нативный API `FPNetwork171`, не меняя внешний контракт.

### Storage 167/168

Формат локального media cache не меняется:

```text
fpchat-media-v167
```

Build 171 не создаёт новый cache name и не удаляет старый кэш.

Сохраняются:

- cache hit;
- cache-fix с синхронным `Response.clone()` до передачи ответа caller;
- clear-cache guard;
- отмена media downloads при очистке;
- metadata cache;
- autoload;
- retention;
- Build 168 old-media accounting.

### Build 169/170 остаются активны

Build 171 не заменяет предыдущие оптимизационные слои:

- `FPRuntime169` остаётся диагностическим runtime;
- `FPRoomContext170` сохраняет generation/AbortSignal для комнат;
- `FPLifecycle170` остаётся lifecycle owner;
- `FPConnection170` остаётся владельцем наблюдения за единственным `state.ws`;
- guarded text/media send Build 170 сохраняются.

## Безопасность загрузки

`network171.js` загружается до `app.js`.

Если сам файл Network Coordinator по какой-либо причине не загрузился, bootstrap не блокирует FPChat навсегда: приложение запускается по прежней legacy-схеме. Ошибка при этом попадает в boot diagnostics.

## Диагностика

В консоли доступно:

```js
FPNetwork171.snapshot()
```

Snapshot показывает только технические данные:

- число запросов;
- число native fetch вызовов;
- ошибки;
- зарегистрированные transport layers;
- количество вызовов каждого слоя;
- попытки неизвестного кода заменить `window.fetch`.

Содержимое сообщений, ключи комнат, recovery-коды и media bytes не логируются.

## Статическая проверка

```bat
npm run check:171
```

Проверка подтверждает:

- `version.json = 171`;
- загрузку Network Coordinator перед app layers;
- стабильное владение `window.fetch`;
- отсутствие неизвестных fetch-replacement файлов;
- наличие восьми ожидаемых legacy adapters;
- детерминированный порядок pipeline независимо от порядка регистрации;
- сохранение `fpchat-media-v167`.

Проверка не заменяет ручную multi-device регрессию.

## Обязательная ручная регрессия

Перед переносом в `main` проверить минимум:

1. холодный запуск, reload и PWA reopen;
2. создание комнаты, invite, recovery;
3. text send/reply/edit/delete/reactions;
4. unread, read receipts и checkmarks;
5. typing/presence;
6. block/unblock и voice block feedback;
7. username chat request, cooldown и accept/reject/block;
8. photo/video/file/voice upload;
9. media autoload/cache hit;
10. очистку cache во время активной загрузки;
11. background → foreground;
12. offline → online;
13. A → B → A из Build 170;
14. iPhone PWA и Android.

## Статус

Build 171 находится только в `build/171-development` и готова к регрессионному тестированию. `main` не изменён.
