# FPChat — общая архитектурная приёмка Builds 169–180

## 1. Область приёмки

Цель этой приёмки — проверить итог всей серии 169–180 как единую migration-линию:

- Build 168 остаётся поведенческим эталоном;
- существующая бизнес-логика не должна быть переписана только ради новой архитектуры;
- один фактический ресурс должен иметь одного реального владельца;
- manager/coordinator управляет существующим worker;
- arbiter решает допуск/владение конфликтующим ресурсом, но не заменяет сам handler;
- FPRuntime остаётся одним логическим диагностическим наблюдателем и не управляет приложением.

169–174 были реализованы до серии 175–180. В этой приёмке они не принимаются «по старому отчёту»: их текущие static/VM/browser regressions входят в накопительный suite и выполняются на текущей ветке вместе с 175–180.

## 2. Ревизии

- Build 168 baseline: `9c53a7a0329f267a51c7e976f1c4c825d9b7ae42`.
- Development branch: `build/180-development`.
- Полностью протестированный кандидат общей архитектурной приёмки:
  `6f20923fd4dcbfa12a2e8aa398a5516cf514817b`.
- GitHub Actions run:
  `35814628215`.
- `main` и production этой приёмкой не изменяются.

## 3. Итоговая карта владельцев

| Роль | Итоговый фактический владелец / worker | Результат |
|---|---|---|
| RuntimeObserver | `FPRuntime169 === FPRuntime`; passive diagnostics | PASS |
| AppCoordinator | существующий `FPStartup174`; отдельный AppCoordinator180 не потребовался | PASS |
| LifecycleManager | `FPLifecycle170` | PASS |
| RoomSessionManager | `FPRoomContext170` + принятый room-open worker | PASS |
| ConnectionManager | `FPConnection170` владеет current socket/replacement/manual-close/reconnect; единственный `new WebSocket` остаётся worker в `app.js` | PASS |
| SyncCoordinator | `FPSyncCoordinator176`, thin facade над существующими sync workers | PASS |
| NetworkManager | `FPNetwork171` — physical fetch/XHR coordination | PASS |
| CacheManager | managed media cache mutation внутри `FPNetwork171` + принятые storage guards | PASS |
| ResourceArbiter | media budget/slots внутри `FPNetwork171` | PASS |
| ComposerManager | `FPComposer177`; draft/reply/edit/form UI; send/mic sync делегируется существующему `FPVoice.syncComposer` | PASS |
| SendManager | `FPSendManager177` — stateless dispatcher; исполнители остаются `FPTextSend170`, `FPMediaSend170`, `voice.js` | PASS |
| MediaManager | `FPMediaManager177` — preview/viewer/voice UI lifetime; recorder/codec остаются существующими workers | PASS |
| MessageStore | `FPMessageStore172`; legacy messageCache — adapter/failure fallback, не вторая normal truth | PASS |
| HistoryManager | клиентский `FPHistory174`; серверный history read owner `FPHistoryRead179` | PASS |
| RenderCoordinator | `FPChatList174`, `FPMessageRender178`, `FPDOM173`, `FPWork174` | PASS |
| ReadStateManager | `FPReadState178` для visible admission + pending flush | PASS |
| LayerManager / LayerArbiter | `FPLayer173`, один claims registry | PASS |
| GestureArbiter | `FPGesture135`, один active gesture session/claim arbitration | PASS |
| Scroll owner / ScrollArbiter | `FPScroll173` / `scrollCoordinator` | PASS |
| ViewportManager | geometry — `FPViewport173`; keyboard state — `FPViewport136`; разные ресурсы, не конкурирующие owners | PASS |
| Server composition | явный `server.js`, каждый migrated `install*` подключается один раз | PASS |
| Block authority | один `fpUserBlocks165` / SQLite `chat_request_blocks` | PASS |

## 4. Что считается успешным переносом

Итог не требует, чтобы вся реализация физически переехала в новые файлы или классы.

Принята следующая модель:

- ConnectionManager владеет socket slot/reconnect policy, но сам constructor WebSocket остаётся одним старым worker в `app.js`.
- SyncCoordinator только объединяет причины sync и вызывает прежние sync workers.
- SendManager не хранит pending/retry и не шлёт сообщения сам; он вызывает ровно один выбранный executor.
- MediaManager не переписывает MediaRecorder/codec/upload.
- CacheManager и ResourceArbiter не вынесены в новые классы, потому что их однозначное состояние уже находится в FPNetwork171.
- AppCoordinator не создан отдельно, потому что FPStartup174 уже закрывает нужную coordination boundary.
- RenderCoordinator — роль нескольких уже принятых render/DOM owners, а не новый универсальный renderer.
- ViewportManager намеренно разделён на владельца numeric geometry и владельца keyboard state.

Это соответствует цели migration: перенос владения и допуска без переписывания рабочих алгоритмов.

## 5. Guarded compatibility paths, которые остаются

Наличие legacy/fallback кода само по себе не считается вторым owner. Принимаются только взаимоисключающие paths, которые не выполняют один side effect одновременно с основным владельцем.

Текущие известные примеры:

- `messageCache = FPMessageStore172.legacyCacheAdapter(...) || new Map()`: Map используется только при отказе обязательного Store asset.
- прямой `box.scrollTop = box.scrollHeight` в viewport compatibility fallback достигается только если недоступны оба accepted scroll owner API.
- FPGesture135 имеет DOM fallback только при отсутствии FPLayer173.
- optional history failure может оставить legacy history fallback.
- voice room-change polling остаётся feature-specific worker для recording/preview lifecycle, а не вторым владельцем composer UI.
- safety/reconciliation timers остаются в своих workers; наличие таймера не равно второму owner.

Build 180.11 отдельно проверяет concrete writers/listeners/timers и не нашёл второго active owner среди перенесённых ресурсов.

## 6. Builds 169–174

Текущая ветка сохраняет результаты ранней части migration:

- 169 — FPRuntime остаётся passive/shadow observer, не владеет transport/render/store.
- 170 — RoomContext/Lifecycle/Connection boundaries и operation context сохраняются.
- 171 — fetch/XHR/cache/resource ownership остаётся за FPNetwork171.
- 172 — canonical message state остаётся FPMessageStore172; новая persistent queue не появилась.
- 173 — Layer/Gesture/Scroll/Viewport/DOM ownership boundaries остаются активными.
- 174 — targeted/chunked rendering, dependency-safe startup, history/anchors и bounded DOM остаются подключёнными.

Их проверки выполняются в текущем накопительном regression, поэтому более поздние Builds 175–180 не считаются доказательством сами по себе — ранние invariants повторно проверяются на итоговом коде.

## 7. Builds 175–180

- 175 закрепил основу и исправления composer send/mic, drawer/long-press и server-id after ACK/remount.
- 176 завершил lifecycle/room/connection/sync ownership.
- 177 завершил network/cache/resource, composer, send и media lifecycle ownership.
- 178 завершил store/history/render/read и UI arbiters/scroll/viewport.
- 179 сделал серверную композицию явной и выделил принятые I/O/DB ownership boundaries.
- 180 завершил block authority, updater/launcher/rollback, startup coordination, общий single-owner audit, cumulative regression и rollback последнего runtime transfer.

## 8. Финальная автоматическая проверка

Run: `35814628215`.

Все jobs:

- `cumulative-regression` — PASS;
- `windows-180-acceptance` — PASS;
- `last-transfer-rollback` — PASS.

Cumulative leaf results:

| Результат | Количество |
|---|---:|
| PASS | 110 |
| EXPECTED_FAIL | 1 |
| FAIL | 0 |
| TIMEOUT | 0 |
| XPASS | 0 |
| Всего | 111 |

Единственный EXPECTED_FAIL:

`regression178-release.cjs`

Он фиксирует исторический release contract Build 178.28.1, заменённый принятым Windows contract Builds 180.4–180.7. Он не считается PASS.

Дополнительный общий тест:

`scripts/regression180-final-architecture-acceptance.cjs`

проверил фактические границы всех ролей: exports, writers, listeners/timers, единственный WebSocket worker, thin SyncCoordinator, transport/cache/resource ownership, Store adapter, composer/send/media разделение, layer/gesture/scroll arbiters, viewport writers и explicit server composition.

## 9. Что НЕ принято физически

Физическая матрица остаётся отдельным этапом и не объявляется PASS.

Не закрыты этой автоматической приёмкой:

- реальный iPhone Safari/PWA;
- слабый Android;
- реальные touch/native browser gestures;
- физический microphone permission/recording;
- реальная push-доставка и отсутствие дублей;
- два физических клиента в разных сетях;
- WAN/Cloudflare tunnel;
- фактический production Windows host;
- физический update/launcher/rollback на копии реальной установки;
- долгий пользовательский сценарий с реальной большой историей/медиа.

Подробная матрица остаётся в `docs/Build180_12_Final_Regression_Matrix.md`.

## 10. Вердикт

### Архитектурная migration managers/arbiters 169–180

**ПРИНЯТА АВТОМАТИЧЕСКИ.**

На текущем коде подтверждено:

- один логический RuntimeObserver;
- один фактический owner для каждого перенесённого общего ресурса;
- arbiters не подменяют бизнес-исполнителей;
- существующие workers остаются за managers, а не работают как независимые конкуренты;
- второго WebSocket/store/cache writer/scroll owner/startup coordinator не создано;
- накопительный regression не показывает неожиданных failures;
- последний runtime transfer имеет проверенный точечный rollback.

### Полная продуктовая приёмка Build 168 → итог

**НЕ ЗАКРЫТА ТОЛЬКО ПО ФИЗИЧЕСКОЙ МАТРИЦЕ.**

Это не архитектурный blocker для продолжения разработки, если физическая приёмка сознательно выполняется позже, но итоговую physical/product parity нельзя маркировать PASS до реального прогона.

## 11. Main / production

Эта приёмка не выполняет merge/deploy.

- `main` не обновляется;
- production не обновляется;
- updater/launcher на рабочем сервере не запускаются;
- release/version identity не меняется автоматически.

Любой merge/release/deploy остаётся отдельным явным действием.
