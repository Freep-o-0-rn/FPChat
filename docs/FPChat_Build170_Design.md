# FPChat Build 170 — RoomContext, Lifecycle и WebSocket

Ветка Build 170 создана от завершённой Build 169. `main` остаётся на стабильной Build 168.

## Цель

Устранить гонки устаревших async-операций и передать lifecycle/WS одному владельцу без изменения пользовательской механики.

## Инварианты

- Запоздалый результат комнаты A не может изменить открытую комнату B.
- Ключ комнаты используется только в контексте той комнаты, для которой был получен.
- Отправка/upload, уже принятые в работу, не отменяются только из-за ухода пользователя с экрана; для них используется отдельный operation context.
- Один актуальный WebSocket остаётся источником realtime-событий.
- Существующие reconnect/retry/read/unread/presence/typing semantics сохраняются.
- Старые 500 мс проверки удаляются только после доказательства, что новый lifecycle/connection owner полностью заменил их работу.

## План реализации

1. Ввести `FPRoomContext170`: `roomId`, `generation`, `AbortController`, проверка актуальности и завершение контекста.
2. Подключить context к открытию/переключению комнаты и критичным async continuation после `await`.
3. Ввести lifecycle owner для foreground/background/online/offline/view/room transitions.
4. Развить существующий stable WS path до явного Connection owner без создания второго сокета.
5. Перевести legacy attach-WS polling на события по одному модулю за раз.
6. Дедуплицировать reconnect/resume sync и дать активной комнате приоритет.

## Выполнено

### 170.1 — Room transition owner

- `FPRoomContext170` разделяет `pending transition` и реально активную комнату.
- Новый запрос на открытие отменяет только предыдущий незавершённый transition; уже отображаемая комната остаётся действующей до успешного commit новой.
- Добавлены отдельные operation context для send/upload, чтобы навигация не отменяла их автоматически.
- `openChat` передан `room-open170`: secret и derived key держатся локально до успешного `/join`; после каждого критичного `await` проверяется generation.
- Старый `openChat` больше не выполняет открытие комнаты независимо после установки `room-open170`; `openChatWithJoinData`, renderer, scroll и WebSocket пока остаются существующими владельцами.
- Сценарий A → B → A получает отдельное поколение для каждого вызова; устаревший `/join` не доходит до commit UI.

### 170.2 — Lifecycle signal owner

- Добавлен `FPLifecycle170` без polling.
- Он нормализует visibility, online/offline, focus/blur и page show/hide в один поток `fpchat:lifecycle170`.
- На этом этапе lifecycle owner только публикует сигналы. Старые обработчики ещё не удалены и продолжают выполнять рабочую логику до поэтапной миграции.

## Следующие шаги

1. Проверить A → B → A с искусственно задержанными `/join` и history responses.
2. Перенести reconnect/resume координацию на `FPLifecycle170`, не создавая новый WebSocket.
3. Добавить явный Connection owner поверх существующего `ensureStableWsConnected/connectStableWs`.
4. Переводить `attachCurrentWs` polling по одному модулю и после каждого переноса подтверждать отсутствие старого независимого владельца.
5. Только после этого объединять повторные resume/reconnect sync.

## Критерий приёмки

- A → B → A с искусственно задержанными ответами не смешивает DOM, ключи или state.
- Возврат из background не запускает параллельные волны одинаковой синхронизации.
- Нет второго независимого владельца WebSocket.
- После миграции конкретного polling подтверждено, что старый interval больше не управляет тем же ресурсом.
- Регрессия Build 168/169 по сообщениям, media, voice, unread, checkmarks, typing, presence, block, invite, gestures и viewport проходит без изменения UX.
