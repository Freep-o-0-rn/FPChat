# FPChat Build 170 — граница реализации и приёмка

Build 170 выполняется только в `build/170-development`. `main` остаётся на стабильной Build 168.

## Реализовано

### RoomContext и защита устаревших async

- `FPRoomContext170` разделяет pending transition и активную комнату.
- Каждый переход имеет `roomId`, `generation` и `AbortSignal`.
- Новый переход отменяет предыдущий pending transition, но не закрывает текущую отображаемую комнату до commit новой.
- Явная навигация из чата/списка отменяет незавершённое открытие, поэтому поздний `/join` не может самопроизвольно открыть экран после ухода пользователя.
- Direct invite/join через `openChatWithJoinData` использует тот же RoomContext.
- Если Build 170 загружается после уже открытого чата, существующая комната принимается как active context без повторного открытия.

### Операции отправки

- Text send передан `text-send170`: в начале операции фиксируются `roomId`, room key, `deviceId`, reply и `clientMessageId`-совместимая текущая retry-механика.
- После `await` текст не использует новый `state.roomId/state.key`; шифрование выполняется ключом исходной комнаты, payload содержит исходный `roomId`.
- Media send передан `media-send170`: фото/video продолжают использовать существующий XHR progress/retry и тот же server API, но encryption/upload/message payload привязаны к исходным room/key/device.
- Text/media operations живут отдельно от видимого room context и не перенаправляются в другую комнату при навигации.
- `pendingTextSends` остаётся существующей оперативной retry-очередью; persistent queue в Build 170 не добавляется.
- Voice уже до Build 170 хранит `roomId/deviceId` внутри recording data и использует `getRoomKey(roomId)` при upload/send; формат и voice flow не переписываются.

### Lifecycle

- `FPLifecycle170` один раз нормализует browser lifecycle в `fpchat:lifecycle170`:
  - foreground/background;
  - online/offline;
  - focus/blur;
  - pageshow/pagehide.
- Новые/перенесённые слои используют этот поток вместо собственного периодического определения состояния там, где ownership уже передан.

### WebSocket lifecycle

- `FPConnection170` наблюдает единственный канонический `state.ws`.
- Он не вызывает `new WebSocket()` и не создаёт второй транспорт.
- Создание, reconnect, ack/read/unread и обработка core payload остаются существующей stable-WS логикой `app.js`.
- `FPConnection170` только сообщает о смене/open/close/error текущего сокета.

### Удалённый idle polling владельца WebSocket

Переведены на `fpchat:connection170` и больше не используют 500 мс attach polling:

- `typing.js`;
- `message-actions.js`;
- `message-pins.js`;
- `message-pins-screen115.js`.

### Reconciliation

`message-actions.js` сохраняет 30-секундный safety watchdog, но:

- одновременный `syncAllRooms` дедуплицируется;
- повторный старт в течение 1.5 секунды схлопывается;
- активная комната синхронизируется первой;
- foreground/online/pageshow приходят через `FPLifecycle170`;
- открытая комната получает отдельный targeted sync.

30-секундный watchdog намеренно не удаляется в Build 170: полное сокращение HTTP reconciliation допускается только после проверки WS-покрытия.

## Что Build 170 намеренно не меняет

- формат сообщений и API;
- E2EE-формат ciphertext/media;
- `pendingTextSends` retry semantics;
- read/received/unread/checkmarks;
- presence и block privacy;
- Storage 167/168 и `fpchat-media-v167`;
- scroll/lazy history/first unread;
- жесты, long-press и viewport;
- сервер/SQLite/bootstrap.

## Известные периодические задачи, которые НЕ являются вторым WS owner

Они не скрываются и не считаются исправленными Build 170:

- voice core/voice polish — legacy UI/room checks; перенос относится к дальнейшему Render/Layer cleanup после отдельной проверки voice UX;
- `user-blocks165` — legacy wrapper installation polling; удаляется вместе с wrapper-chain migration, а не вслепую;
- system/chat-request — 10-секундные safety refresh;
- message-actions — 30-секундный reconciliation watchdog;
- typing/voice activity heartbeat — активен только во время реального typing/media/recording activity и является частью transient presence protocol.

Build 170 не объявляет эти интервалы равными нулю.

## Статическая проверка

```bat
npm run check:170
```

Проверка:

- парсит изменённые JS-файлы без исполнения browser-кода;
- подтверждает Build 170;
- подтверждает, что `connection170` не создаёт второй `WebSocket`;
- проверяет наличие room-generation guard и late-boot adoption;
- проверяет, что text/media отправка использует operation context и захваченные room/key/device;
- проверяет отсутствие старых 500 мс WS attach loops в мигрированных модулях;
- проверяет сохранение cache-format `fpchat-media-v167`.

Это не заменяет ручной multi-device regression.

## Обязательная ручная приёмка перед merge

1. Обычный запуск и reload.
2. A → B → A при Slow 3G/искусственной задержке `/join`.
3. Открыть B и до ответа нажать «Назад»/другой раздел: B не должен открыться позже сам.
4. Direct join по invite и открытие созданной комнаты.
5. Background → foreground 10–30 секунд.
6. Offline → online и повторное подключение WS.
7. Text send + retry/reconnect + `clientMessageId` dedupe.
8. Начать text send и сразу перейти A → B: сообщение должно остаться привязано к A и не появиться как отправка в B.
9. Начать загрузку фото/video и перейти A → B: media upload/message должны сохранить исходную комнату A; прогресс/ошибка не должны ломать B.
10. Reply/edit/delete/reactions/pins.
11. Unread, first unread, lazy history, scroll restore, ✓/✓✓/синие ✓✓.
12. Typing/presence с обычными пользователями и с блокировкой.
13. Фото/video/file/voice, включая voice preview и повторную отправку.
14. Media cache/autoload/clear во время загрузки.
15. Long-press/context menu/selection/swipe navigation.
16. Клавиатура/viewport на iPhone PWA и слабом Android.
17. После многократного A → B → A не должно быть двойных edit/pin/typing updates или других признаков накопившихся обработчиков.

## Статус приёмки

Кодовая реализация Build 170 готова к regression-тестированию. Сборка не должна сливаться в `main`, пока ручная приёмка на реальных устройствах не пройдена.
