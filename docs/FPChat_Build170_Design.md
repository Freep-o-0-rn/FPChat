# FPChat Build 170 — RoomContext, Lifecycle и WebSocket

Ветка Build 170 создана от завершённой Build 169. `main` остаётся на стабильной Build 168.

## Цель

Устранить гонки устаревших async-операций и централизовать сигналы lifecycle/смены WebSocket без изменения пользовательской механики.

## Инварианты

- Запоздалый результат комнаты A не может изменить открытую комнату B.
- Ключ комнаты используется только в контексте той комнаты, для которой был получен.
- Отправка/upload, уже принятые в работу, не отменяются только из-за ухода пользователя с экрана; для них используется отдельный operation context.
- В приложении создаётся только один актуальный WebSocket существующим stable-WS путём `app.js`.
- Существующие reconnect/retry/read/unread/presence/typing semantics сохраняются.
- Старый механизм удаляется только после появления и проверки нового владельца того же ресурса.

## Реализация

### 170.1 — Room transition owner

`FPRoomContext170` разделяет:

- pending transition;
- активную комнату;
- независимые долгие operations.

Новый запрос на открытие отменяет только предыдущий pending transition. Текущая отображаемая комната остаётся действующей до успешного commit новой.

`room-open170` передаёт публичный `openChat` новому entry owner:

1. создаётся generation;
2. secret/key остаются локальными до подтверждения `/join`;
3. после критичных `await` проверяется актуальность transition;
4. только актуальный transition выполняет commit;
5. затем используется существующий `openChatWithJoinData`/renderer.

Direct invite/join также проходит через RoomContext. Явный уход/переход в другой раздел отменяет незавершённое открытие, даже если `state.roomId` ещё не был установлен.

### 170.2 — Lifecycle owner

`FPLifecycle170` без polling нормализует:

- visibility;
- online/offline;
- focus/blur;
- pageshow/pagehide.

Он публикует один поток `fpchat:lifecycle170`. Сам owner не выполняет сетевые запросы, не создаёт WebSocket и не меняет UI.

### 170.3 — Connection owner

`FPConnection170` наблюдает канонический `state.ws`.

Ключевое ограничение: `connection170.js` не содержит и не вызывает `new WebSocket()`. Создание/reconnect остаётся существующей stable-WS реализацией `app.js`. Новый слой отвечает только за достоверный сигнал о смене/open/close/error текущего socket.

Событие: `fpchat:connection170`.

### 170.4 — миграция attach polling

Убраны legacy 500 мс attach loops из:

- `typing.js`;
- `message-actions.js`;
- `message-pins.js`;
- `message-pins-screen115.js`.

Эти модули теперь переподключают собственные message listeners при `fpchat:connection170`. Старый interval в перечисленных модулях больше не является параллельным владельцем той же работы.

### 170.5 — reconciliation burst control

`message-actions` сохраняет редкий 30-секундный safety watchdog, но:

- одновременный `syncAllRooms` объединяется;
- близкие повторные старты имеют cooldown;
- активная комната обслуживается первой;
- room-ready получает targeted sync;
- foreground/online/pageshow используют нормализованный lifecycle signal.

Полное удаление HTTP safety reconciliation в Build 170 не выполняется: это можно делать только после подтверждения полного WS coverage.

## Что остаётся legacy после 170

Оставшиеся periodic jobs не маскируются как исправленные:

- voice/voice-polish UI/room checks;
- wrapper-install polling в `user-blocks165`;
- system/chat-request 10-секундные safety refresh;
- 30-секундный message-actions watchdog;
- activity/countdown timers, которые активны только при реальном пользовательском действии.

Они не создают второй WebSocket owner и будут разбираться в соответствующих следующих слоях плана, а не удаляться вслепую.

## Проверка

Статическая проверка:

```bat
npm run check:170
```

Она проверяет синтаксис изменённых файлов и критические ownership-инварианты. Ручная multi-device приёмка описана в `docs/FPChat_Build170_Complete.md`.

## Критерий приёмки

- A → B → A с задержанными ответами не смешивает DOM, ключи или state.
- Уход со страницы во время pending open инвалидирует поздний ответ.
- Нет второго создателя/reconnector WebSocket.
- Мигрированные модули не имеют старого 500 мс attach polling.
- Reconnect/resume не создаёт параллельные экземпляры одной и той же action-sync задачи.
- Регрессия Build 168/169 по сообщениям, media, voice, unread, checkmarks, typing, presence, block, invite, gestures и viewport проходит без изменения UX.
