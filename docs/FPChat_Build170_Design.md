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

## Критерий приёмки

- A → B → A с искусственно задержанными ответами не смешивает DOM, ключи или state.
- Возврат из background не запускает параллельные волны одинаковой синхронизации.
- Нет второго независимого владельца WebSocket.
- После миграции конкретного polling подтверждено, что старый interval больше не управляет тем же ресурсом.
- Регрессия Build 168/169 по сообщениям, media, voice, unread, checkmarks, typing, presence, block, invite, gestures и viewport проходит без изменения UX.
