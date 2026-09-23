# FPChat Build 172 — MessageStore, reply dependencies и merge rules

Build 172 разрабатывается только в `build/172-development` поверх завершённой кодовой Build 171. Ветка содержит всю цепочку Build 169 → 170 → 171 → 172. `main` остаётся на стабильной Build 168 до отдельной ручной регрессии.

## Цель

Передать изменяемое состояние сообщений единому владельцу, не меняя пользовательскую механику отправки, retry, `clientMessageId`, unread, checkmarks, edit/delete, reply, media и voice.

Новая persistent offline-очередь в Build 172 **не добавляется**.

## Реализовано

### 1. Канонический MessageStore

Добавлен:

```text
public/message-store172.js
```

Глобальный владелец:

```js
FPMessageStore172
```

Для каждой комнаты он хранит:

- server message id;
- `clientMessageId`;
- status;
- decrypted presentation text/preview;
- type/kind;
- reply dependency;
- edit revision;
- deletion tombstone;
- источник и версию канонического состояния.

Старый `messageCache` больше не является независимым Map при нормальной загрузке Build 172. Он остаётся compatibility adapter к текущей комнате MessageStore.

Если asset Build 172 не загрузился, bootstrap оставляет legacy fallback, чтобы приложение не зависло на экране запуска.

### 2. Reply dependencies

При поступлении reply MessageStore записывает связь:

```text
reply_to_message_id → dependent messages
```

Если reply появился раньше исходного сообщения, состояние явно считается `missing`.

Когда исходное сообщение позже появляется, редактируется или удаляется, событие:

```text
fpchat:message-store172-changed
```

обновляет reply preview в уже смонтированном чате.

Draft reply bar тоже повторно разрешает metadata через MessageStore, поэтому временное:

```text
Неизвестно
Сообщение недоступно
```

не должно оставаться навсегда, если исходное сообщение уже появилось в каноническом состоянии.

### 3. Merge rules

Build 172 фиксирует правила объединения сообщений.

#### Edit

Более новый edit имеет более высокий content revision.

Поздний history response со старой версией сообщения не должен вернуть старый текст поверх уже применённого edit.

#### Delete

Удаление создаёт tombstone.

После tombstone обычная история не может воскресить сообщение.

Для reply удалённый источник отображается как:

```text
Сообщение удалено
```

#### Status

Статусы монотонны:

```text
sending → sent → delivered → read
```

Более старый status event не может понизить уже достигнутое состояние.

Когда MessageStore доступен, он является владельцем status merge. Старый `messageStatusByKey` остаётся только fallback для безопасного запуска без Build 172 asset.

### 4. clientMessageId и подтверждения

Существующая runtime-очередь:

```text
pendingTextSends
```

не переписана и не сохраняется в localStorage.

Существующие:

- retry;
- resend после reconnect;
- server dedupe;
- `clientMessageId`;

сохранены.

Когда сервер присылает numeric message id, MessageStore выполняет promotion существующей optimistic записи вместо создания второго канонического сообщения.

### 5. Edit/delete integration

`message-actions.js` теперь передаёт:

- edit → `FPMessageStore172.applyEdit(...)`;
- delete/self-delete → `FPMessageStore172.markDeleted(...)`;
- snapshot hidden/deleted ids → MessageStore tombstones.

Legacy action-state sets остаются для совместимости и восстановления после reload, но не используются для разрешения конфликтов текста/status внутри канонического MessageStore.

### 6. Renderer compatibility

`appendMessage(...)` сначала регистрирует входящее сообщение в MessageStore.

Если store уже содержит более новое состояние, renderer использует канонический текст.

Если store содержит tombstone, старый history payload не монтируется повторно.

Таким образом DOM остаётся представлением, а не источником истины.

## Что сознательно не входит в Build 172

Не добавлены:

- persistent send queue;
- IndexedDB для сообщений;
- новый формат шифрования;
- изменение server API;
- bounded DOM/virtualization;
- anchor history;
- переписывание scroll;
- новый gesture system.

Эти изменения относятся к другим этапам плана.

## Проверка

Добавлен:

```bat
npm run check:172
```

Он проверяет:

- синтаксис MessageStore/app/message-actions;
- Build 172 loader;
- legacy `messageCache` как adapter;
- store-based reply resolution;
- edit/delete integration;
- отсутствие новой persistent queue;
- reply-before-source;
- stale history after edit;
- deletion tombstone;
- status monotonicity;
- optimistic `clientMessageId` → numeric server id promotion.

## Обязательная ручная регрессия

Перед переносом в следующую стабильную точку проверить минимум:

1. обычный text send;
2. reconnect retry;
3. reload после уже доставленных сообщений;
4. reply на 1–10 сообщений выше;
5. reload комнаты с reply;
6. reply, чей source подгружается lazy history;
7. edit source message → reply preview меняется;
8. delete source message → reply показывает удаление;
9. старый history response после edit;
10. старый history response после delete;
11. ✓ / ✓✓ / синие ✓✓ не понижаются;
12. optimistic message после ack не дублируется;
13. photo/video/file/voice;
14. edit/delete/reactions/pins;
15. unread/first unread;
16. block/unblock;
17. A → B → A;
18. PC, слабый Android, iPhone PWA.

## Статус

Кодовая часть Build 172 завершена в `build/172-development`.

CI в проекте не настроен. Автоматический check и VM-инварианты не заменяют ручную multi-device регрессию.
