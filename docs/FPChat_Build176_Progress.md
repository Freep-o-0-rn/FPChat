# Build 176 — итоговая проверка lifecycle / room / connection / sync

Дата: 21.09.2026. Ветка: `build/176-development`.

## База и HEAD

- Техническая база до Build 176: Build 175, `907da64452b56c0c73d4929e2542a942024e88f0`.
- Последний функциональный commit Build 176 перед финализацией: `cbee56a3a0739b342ba4a72cd18dc193ba9aa29e`.
- `main` и production этой работой не изменяются.

Build 176 переносит ownership по строгому порядку LifecycleManager → RoomSessionManager → ConnectionManager → SyncCoordinator. Существующие workers, протоколы и пользовательское поведение не переписываются ради новых имён.

## Что подтверждено

### LifecycleManager

`FPLifecycle170` остаётся единственным нормализатором visibility/network/focus/page lifecycle. Проверены foreground/background, focus/blur, online/offline, pagehide/pageshow, подавление повторного одинакового состояния и полный `destroy()` cleanup.

Request-cooldown использует `FPLifecycle170.subscribe` и реагирует только на прежний foreground. Прямой `visibilitychange` сохранён только как compatibility fallback при отсутствии lifecycle owner.

### RoomSessionManager

`FPRoomContext170` разделяет экранную room-session и долгие операции. Проверен быстрый A → B → A: superseded pending transition abort-ится, старая active A инвалидируется, новая A становится current. Независимая операция `voice-send` не отменяется только из-за смены экрана и завершается отдельным operation cleanup.

При выходе из комнаты освобождается unread `IntersectionObserver`. Voice upload получает operation signal, поэтому lifetime отправки привязан к своей операции, а не к случайной новой экранной комнате.

### ConnectionManager

`FPConnection170` владеет current-socket lifecycle, generation, manual-close, reconnect timer/attempt и thin ensure API. `new WebSocket` по-прежнему существует только в одном старом worker в `app.js`; manager второго transport не создаёт.

Ранее по шагам 176.12–176.16 проверены: одинаковый connect Promise при CONNECTING, один WebSocket, один reconnect timer, сохранённый backoff/reset, manual-close, replacement до нового socket, игнорирование поздних open/close старого socket и сведение legacy control entries к одному worker/state.

### SyncCoordinator

`FPSyncCoordinator176` остаётся тонким adapter: post-reconnect и resume причины вызывают прежние workers, а `stableWsSyncPromise` остаётся единственной внутренней дедупликацией room batch.

Проверены overlapping reconnect + resume без второго batch, очистка resume-work после ошибки, stale unread API против свежего WS, A → B во время decrypt без записи в DOM/read новой комнаты и monotonic preview guard против позднего sync результата.

## Полный накопительный CI

Для общей приёмки на отдельной временной ветке `test/176-full-ci` запущен GitHub Actions run **35627496603** на точном функциональном HEAD Build 176.

Успешно выполнены:

| Проверка | Результат |
|---|---:|
| Syntax всех `public/*.js` | PASS |
| `npm run check:169-174` | 6/6 PASS |
| `npm run test:173:browser` | 17/17 PASS |
| `npm run test:174:browser` | 17/17 PASS |
| `npm run test:174:audit` | 18/18 PASS |
| `npm run test:175:identity` | VM PASS + 1/1 browser PASS |
| `npm run test:175:composer` | 10/10 PASS |
| `npm run test:175:drawer` | 13/13 PASS |

Итого: **76/76 браузерных сценариев PASS, 0 FAIL**, плюс шесть static/VM-наборов и Build 175 identity VM check.

Среда: GitHub Actions Ubuntu, Node 22, Playwright Chromium, временная тестовая SQLite. Push/VAPID, физический iPhone/Android, реальные разрешения микрофона и особенности PWA/background на физических устройствах этим runner не подтверждаются.

## Граница перед Build 177

После успешной общей проверки Build 176 считается автоматическим архитектурным барьером для перехода к 177. Следующий блок начинается с NetworkManager/CacheManager/ResourceArbiter и не должен переписывать принятых владельцев 176.

Физическая mobile-приёмка остаётся отдельной release-проверкой и не выдаётся за выполненную автоматическим Chromium runner.
