# 🚀 FPChat — история развития

> История FPChat от актуальной сборки к самым ранним прототипам. Близкие версии объединены в крупные этапы, чтобы changelog показывал развитие продукта, а не превращался в список технических `bump version` и `cache-bust` коммитов.

**Сборка разработки:** `188.5` — `build/188-reactions-development`; Telegram-style reactions, полный каталог реакций поверх Build 188.4.

**Текущая сборка на сервере:** `186.5` — рабочая стабильная контрольная точка, но Build 186 ещё не завершён и не слит в `main`.

**Стабильная сборка в main:** `183.9`

**Начало истории:** март 2026  
**Формат:** крупный этап → диапазон сборок → ключевые подтверждённые изменения.  
**Порядок:** всегда **от новой версии к старой** — во всём файле, включая диапазоны, подразделы, списки сборок и ранние Alpha/Beta.

### Обозначения

`✨` новая возможность · `🛠` исправление · `🎨` интерфейс/UX · `⚙️` сервер/система · `📱` мобильная версия · `🔒` доступ/безопасность

---

## 🗺️ Карта развития FPChat

| Период | Версии | Основной фокус |
|---|---|---|
| 26.09.2026 | **Build 188.5–188.1** | Reactions: foundation, bounded history/RAM, compact pills, quick reactions и раскрываемый полный каталог |
| 25.09.2026 | **Build 187.1** | Privacy presence: toggle онлайн/оффлайн, точное/приблизительное время посещения, server-side projection |
| 24–25.09.2026 | **Build 186.5–186.1** | Диагностика загрузки, media cache, ускорение startup, приоритет media I/O и preload storage |
| 24.09.2026 | **Build 185.1** | Pinch-to-zoom фото 1×–4× и pan внутри существующего media viewer |
| 23.09.2026 | **Build 184.6–184.1** | Telegram-style Reply Swipe UI без смены владельца жестов |
| 23.09.2026 | **Build 183.9–183.1** | Анимация возврата из чата к списку; текущая стабильная точка `main` |
| 23.09.2026 | **Build 182.6–182.1** | Владение microphone permission/MediaStream и стабилизация voice UX |
| 23.09.2026 | **Build 181.9–181.1** | NotificationManager/NotificationService и push для персональных системных событий |
| 23.09.2026 | **Build 180.14–180.1** | Финальная архитектурная приёмка 169–180, updater/launcher/rollback и startup ownership |
| 22.09.2026 | **Build 179.9–179.1** | Явная server composition, encrypted image persistence/cleanup и history DB ownership |
| 22.09.2026 | **Build 178.28.1–178.1** | MessageStore/render/read/layer/gesture/scroll/viewport ownership |
| 22.09.2026 | **Build 177.26–177.1** | Composer/SendManager/MediaManager, cache и media resource ownership |
| 21.09.2026 | **Build 176** | LifecycleManager, RoomSessionManager, ConnectionManager и SyncCoordinator без замены существующих workers |
| 21.09.2026 | **Build 175** | Send/mic, исключение ложного long press при drawer и canonical ID после ACK |
| 20.09.2026 | **Build 174** | Точечный render, порционная работа, dependency-safe startup и ограниченное окно истории |
| 17–19.09.2026 | **Build 173–169** | Диагностика, владельцы room/network/store/gesture и совместная регрессия; ветка разработки |
| 16–17.09.2026 | **Build 168–167** | Учёт и очистка media cache |
| 15–16.09.2026 | **Build 166–153** | Конфиденциальность, антиспам, чёрный список и полноценная блокировка пользователей |
| 14–15.09.2026 | **Build 152–145** | Запросы на чат, системный чат, жесты, стабильный запуск |
| 14.09.2026 | **Build 144–140** | `@username`, поиск и публичный профиль |
| 14.09.2026 | **Build 139–136** | iOS viewport, safe-area и мобильный интерфейс |
| 12–14.09.2026 | **Build 135–92** | Telegram-подобное управление сообщениями и жестами |
| 03–12.09.2026 | **Build 91.77–50** | История, unread, push, WebSocket, presence и стабильность |
| май 2026 | **Beta 85 → Alpha 6** | Быстрое развитие раннего клиента и экспериментальная Beta/Alpha-фаза |
| март–май 2026 | **Pre-alpha 5 → Initial** | Первый рабочий MVP и рождение проекта |

> [!NOTE]
> В ранней истории использовались обозначения `Alpha` и `Beta`, а номера иногда откатывались или использовались повторно. Например, **Beta 50** из мая и современный **Build 50** из сентября — это разные этапы разработки.

---

# 😀 Build 188 — Telegram-style reactions

**26 сентября 2026 · Build 188.5 · ветка `build/188-reactions-development` · база: Build 187.1**

### Build 188.5 — full reaction catalog picker

- В quick-панель добавлена круглая кнопка раскрытия полного каталога реакций.
- Добавлен `FPReactionPicker188` как тонкий UI-worker под `FPReactionInteractionManager188`; отдельный manager/arbiter, transport или layer не создаются.
- Picker живёт только внутри уже открытого `message-context`, поэтому `FPGesture135` и `FPLayer173` не менялись.
- Полный список берётся из того же versioned reaction catalog через `FPReactionManager188.getAvailableReactions()`; отдельного списка emoji в UI нет.
- Каталог группируется по category: эмоции, сердца, жесты, символы, объекты, еда, животные и праздничные реакции.
- Full grid создаётся лениво только при первом раскрытии; при обычном long press сообщения лишний DOM полного каталога не строится.
- Выбор реакции из picker использует тот же `toggleReaction()` → optimistic state → per-message FIFO → explicit ADD/REMOVE путь, что quick reaction и compact pill.
- Свои реакции подсвечиваются и внутри полного каталога; состояние синхронизируется тем же `fpchat:reaction188-changed`, второго reaction-store нет.
- На узких экранах quick-кнопки уменьшаются так, чтобы семь быстрых реакций и chevron помещались без горизонтального скролла; full picker имеет bounded height и собственный вертикальный scroll.
- Picker загружается после renderer и до InteractionManager, но остаётся optional: если его asset не загрузится, InteractionManager всё равно запускается и поведение 188.4 сохраняется.
- Stable Build 187 core и уже принятые reaction hooks 188.4 не переписывались.
- Добавлен `test:188.5`.
- [Контракт Build 188.5](docs/Build188_5_ReactionPicker.md).

### Build 188.4 — interaction / quick reactions

- Добавлен отдельный `FPReactionInteractionManager188`: tap, long press, ПКМ по reaction pill и quick strip внутри существующего message-context.
- Reaction long press использует тот же контракт, что и сообщение: **450 мс / 12 px**; допуск остаётся у `FPGesture135`.
- Reaction pill исключён из существующих message long press / reply swipe / message context right-click recognizers только точечными target-guards; старые gesture owners не переписаны.
- Tap по своей реакции формирует explicit **REMOVE**, tap по чужой/отсутствующей — explicit **ADD**. Server-side TOGGLE не вводится.
- `FPReactionManager188` получил optimistic projection поверх authoritative state; быстрые последовательности не теряют второй intent при позднем ответе первой операции.
- Правило максимум **3 реакции** применяется и в optimistic projection: четвёртая вытесняет самую старую.
- Mutation остаётся в per-message FIFO `FPReactionArbiter188`, без retry/offline persistence. Ошибка сети откатывает только неподтверждённый optimistic state.
- Каждая mutation захватывает текущий `FPRoomContext170`; смена комнаты отменяет старые queued/running reaction operations и не позволяет A изменить UI B.
- В существующий message-context добавлена quick-панель **😂 ❤️ 👍 👎 🔥 🥰 👏**. Выбор реакции использует тот же ReactionManager path и закрывает context.
- Full picker и Reaction Details ещё не реализованы. Long press/ПКМ по pill уже имеют future hook; до появления Details безопасно возвращаются к существующему message-context.
- Reaction pills становятся кликабельными только после успешной загрузки InteractionManager. Если optional asset не загрузился, они остаются inert и старая логика 187 продолжает получать input.
- Compatibility guard расширен: `message-context.js` и `appendMessage(...)` после удаления строго разрешённых reaction hooks/guards снова совпадают со стабильной 187.
- Добавлен `test:188.4`.
- [Контракт Build 188.4](docs/Build188_4_ReactionInteraction.md).

### Build 188.3 — compact reaction pills

- Добавлен `FPReactionRenderer188` как тонкий DOM-worker под существующим `FPMessageRender178`.
- Рабочий `appendMessage(...)` не переписан: после уже существующего `box.appendChild(w)` добавлен ровно один reaction render hook.
- Добавлен отдельный compatibility regression: после удаления этого hook исходник `appendMessage` совпадает со стабильным Build 187; ключевые owner-файлы 187 также зафиксированы checksum-проверками.
- Reaction renderer не владеет transport, history, scroll или gestures; не создаёт timer/observer.
- В 188.3 pills специально имеют `pointer-events:none`, поэтому swipe reply, message long press, ПКМ и текущие tap-механики остаются у старых владельцев без перехвата реакциями.
- Компактный вид: count=1 → emoji + 1 профильный кружок; count=2 → emoji + 2 кружка; count>=3 → emoji + число.
- Свои реакции получают accent-highlight, чужие остаются нейтральными.
- Pills обновляются keyed-patch по `reactionId`; сообщение, media/voice/reply DOM не remountятся.
- Для profile circles в participant DTO добавлен только additive `participantId`; старые поля presence/privacy не менялись.
- Renderer загружается после `FPReactionManager188` и при старте один раз сканирует только текущий mounted history window; polling/MutationObserver нет.
- Добавлен `test:188.3`.
- [Контракт Build 188.3](docs/Build188_3_ReactionRenderer.md).

### Build 188.2 — reaction history / bounded RAM

- Reaction summary подключён к существующему `FPHistory174`, но ReactionManager не становится вторым владельцем истории, scroll или message mount.
- Lazy-history запрашивает reaction summary только с `reactions=1`; unread/watchdog/background message reads дополнительный reaction SQL не выполняют.
- Для страницы используется **один bulk SQLite aggregate**, а не N+1 по сообщениям.
- `FPReactionManager188` хранит reaction-state только для текущего bounded history window; WS-события по незагруженным сообщениям игнорируются и RAM не занимают.
- Initial history summaries безопасно переживают позднюю загрузку ReactionManager через bounded staging внутри active history и освобождаются после ingest.
- `reaction:update` проходит через существующий WebSocket worker и не меняет unread/read, last message или сортировку чатов.
- Для пропущенных во время offline/sleep реакций добавлен один bounded current-window reconcile: максимум **300 loaded message IDs**, только для открытого чата, с RoomContext cancellation.
- Delete-for-self/delete-for-all освобождают локальный reaction-state и отменяют ещё не выполненные client reaction operations; серверная семантика удаления остаётся принятой ранее.
- Удаление комнаты из локального списка освобождает reaction RAM; media cache не затрагивается.
- Добавлен `test:188.2`.
- [Контракт Build 188.2](docs/Build188_2_ReactionHistory.md).

### Build 188.1 — Reaction Foundation

- Создан отдельный reaction-domain, не смешанный с `FPMessageStore172`, media cache, unread/read-state или lazy-history.
- `FPReactionManager188` является клиентским владельцем reaction summary/revision и использует только RAM; persistent/offline queue не создаётся.
- `FPReactionArbiter188` сериализует действия отдельно для каждого `roomId + messageId`; предел клиентской очереди — **20** операций на сообщение.
- На сервере добавлен `FPReactionMutationArbiter188`: отдельные FIFO lanes для сообщений, без второго transport/DB owner.
- Добавлен единый versioned reaction catalog. Quick-набор: **😂 ❤️ 👍 👎 🔥 🥰 👏**; каталог расширяемый через стабильный `reaction_id`.
- SQLite получил `message_reactions` и `message_reaction_state`. Один участник может держать максимум **3 разные реакции** на сообщение; четвёртая вытесняет самую старую.
- Протокол использует явные **ADD/REMOVE**, а не TOGGLE. No-op не увеличивает `reactionRevision` и не создаёт WebSocket-событие.
- Реальный change возвращает authoritative summary и рассылает viewer-neutral `reaction:update`.
- System/service и deleted-for-all сообщения не принимают реакции. `Delete for all` удаляет reaction-state в той же message-delete transaction; `Delete for self` реакции остальных не уничтожает.
- Полное удаление комнаты очищает reaction rows/state и pending lanes.
- Client reaction foundation загружается только после `fpchat:boot-ready`, поэтому Build 188.1 не расширяет critical startup path.
- UI реакций, quick strip в message-context, picker, gesture integration, Reaction Details и bulk lazy-history summary намеренно вынесены в следующие шаги 188.
- Добавлен `test:188:foundation`.
- [Контракт Build 188.1](docs/Build188_1_ReactionFoundation.md).

---

# 🔒 Build 187 — настройки видимости presence

**25 сентября 2026 · Build 187.1 · ветка `build/187-development` · база: Build 186.5**

- В существующий раздел **Конфиденциальность** добавлены два toggle: **«Показывать статус онлайн/оффлайн»** и **«Показывать точное время посещения»**.
- Серверная истина не маскируется: `participants.online` и точный `last_seen_at` продолжают храниться и использоваться внутренней presence-логикой.
- Добавлен лёгкий `PresencePrivacy187` projector без нового manager/arbiter, WebSocket, polling, timer, fetch или отдельного presence-store.
- Режимы: **FULL** (Online + точное время), **APPROXIMATE** (Online + недавно/неделя/месяц/давно), **PRIVATE** (Online скрыт, только приблизительная активность).
- Block-policy остаётся выше privacy: при блокировке peer presence по-прежнему становится недоступным.
- Одна и та же viewer-safe проекция используется для initial `participants[]`, WebSocket `presence:update` и `/api/user-blocks/room-status`.
- В PRIVATE обычные raw online/offline переходы не рассылаются; изменение toggle сразу отправляет безопасный projected `presence:update` без reconnect.
- Default для существующих пользователей — FULL, поэтому само обновление не меняет прежнюю видимость.
- Добавлен `test:187:presence-privacy`; сохранены статические контракты presence/block Builds 179/180.
- [Контракт Build 187.1](docs/Build187_1_PresencePrivacy.md).

---

# ⚡ Build 186 — диагностика и оптимизация загрузки

**24–25 сентября 2026 · ветка `build/186-development` · текущая сборка сервера: `186.5`**

> [!IMPORTANT]
> Build 186 сейчас используется на сервере как рабочая стабильная контрольная точка, но серия **ещё не завершена** и в `main` не слита. Текущий `main` остаётся на Build 183.9.

### Build 186.5 — preload storage-цепочки

- После готовности критических владельцев добавлен low-priority preload для `storage167.js`, `storage167-clear-guard.js`, `storage167-cache-fix.js` и `storage168.js`.
- Preload только заранее получает файлы: порядок исполнения по существующей onload-цепочке и stop-on-error сохранён, нового загрузчика или менеджера нет.
- В синтетическом сравнении Chromium с одинаковым CPU/network throttling медиана подготовки снизилась с 1546.0 до 1261.7 мс, а ожидание assets — примерно с 272–290 до 19–27 мс. Это не результат физического телефона.
- Полный `npm run test:186` и отдельный `test:186:storage-preload` проходят; физическая приёмка продолжается.
- [Отчёт Build 186.5](docs/Build186_5_StoragePreload.md).

### Build 186.4 — приоритет пользовательского media I/O

- Фоновый repair media cache больше не начинает тяжёлые `Cache.keys()` поверх уже активных/ожидающих media-операций; используется состояние существующего `FPNetwork171`, без новой очереди.
- В загрузочный отчёт добавлен ограниченный журнал стартовых JS/CSS с безопасными именами, статусом и признаком ожидания на момент `assets-start`.
- Сохранены текущие cache metadata, clear guard, media leases и порядок startup.
- [Отчёт Build 186.4](docs/Build186_4_Maintenance.md).

### Build 186.3 — ускорение подготовки приложения

- Шесть поздних скриптов владельцев заранее загружаются через preload, но исполняются в прежнем dependency-порядке.
- Splash больше не ждёт дополнительный system refresh и завершение запроса списка заявок; убраны фиксированные ожидания тишины 180 мс и дополнительная задержка 120 мс.
- В локальном контролируемом сравнении медиана подготовки снизилась примерно на 285 мс (~15%); результат не переносится автоматически на iPhone/Android.
- [Отчёт Build 186.3](docs/Build186_3_Startup.md).

### Build 186.2 — voice thumbnail и обслуживание media cache

- Renderer больше не создаёт бессмысленные `audio/thumb` запросы для голосовых сообщений; voice playback остаётся у существующего voice worker.
- Исправление metadata media cache объединяется в один отложенный repair-проход, сохраняет единственного физического cache owner и корректно учитывает clear guard.
- Диагностика разделяет `cacheOpen`, `cacheMeta`, `cacheMatch`, `cacheDelete`, `cacheKeys` и `cacheRepair`, не экспортируя секреты/URL/media IDs.
- [Отчёт Build 186.2](docs/Build186_2_MediaCache.md).

### Build 186.1 — пассивная диагностика загрузки

- В `FPRuntime169.loading` добавлены измерения boot, открытия комнаты, media queue/cache/network/decrypt, viewer и gallery-history.
- Экспорт ограничен последними 240 операциями и не содержит текстов сообщений, room/device/media/message ID, ключей, recovery-кодов, URL и тел запросов.
- Диагностика не подменяет существующих владельцев и не вводит глобальные fetch/timer hooks; задача 186.1 — измерить реальную причину задержек после 185, а не заранее объявить источник проблемы.
- [Описание Build 186.1](docs/Build186_LoadingDiagnostics.md).

---

# 🔍 Build 185 — pinch-to-zoom фото

**24 сентября 2026 · Build 185.1 · ветка `build/185-development`**

- В существующем mixed photo/video viewer добавлено масштабирование активной фотографии двумя пальцами от 1× до 4× вокруг midpoint и последующий pan одним пальцем.
- Пока фото увеличено, pan не переключает галерею и не закрывает viewer. Возврат к 1× поглощает текущую touch-sequence; gallery swipe снова доступен со следующего жеста.
- Владельцы не размножались: `FPGesture135` отвечает за pointer-session/action lease, `FPLayer173` — за слой, `FPMediaManager177` — за lifetime viewer, а existing gallery controller — за распознавание pinch/pan/swipe и transform.
- Добавлены cleanup для pointer capture, ResizeObserver, RAF и late-load races; видео сохраняет native controls и не перехватывается photo zoom.
- `npm run test:185` прошёл все 16 zoom-групп плюс накопительные проверки 184. Физический Safari/PWA и Android требуют отдельной проверки.
- [Полный отчёт Build 185.1](docs/Build185_PhotoZoom.md).

---

# 🎨 Build 184 — Telegram-style Reply Swipe UI

**23 сентября 2026 · Build 184.1–184.6 · ветка `build/184-development`**

- Существующий reply-handler и `FPGesture135` сохранены владельцами жеста и порога; добавлен только визуальный исполнитель `FPReplySwipeVisual184`.
- Индикатор появляется только при реальном swipe: точка 8 px → круг 36 px → SVG-стрелка → один ripple при armed. Порог reply остался **52 px**.
- Короткий свайп, возврат ниже порога, `touchcancel`, multitouch, vertical movement, смена комнаты/слоя, blur и удаление строки корректно сбрасывают визуал без изменения reply/draft.
- При ошибке загрузки нового JS/CSS остаётся прежний индикатор и рабочая reply-механика.
- `npm run test:184` включает 26 новых browser-сценариев и накопительные проверки chat-back/gesture/notification/microphone.
- [Отчёт Build 184.6](docs/Build184_ReplySwipeUI.md).

---

# 📱 Build 183 — анимация возврата из чата

**23 сентября 2026 · Build 183.1–183.9**

- Добавлена Telegram-подобная room → chat-list анимация поверх существующих `FPLayer173`, `FPGesture135` и `swipe-fix.js`; новый Navigation/Transition manager не создавался.
- При drag меняются только визуальные transforms. Cancel возвращает тот же чат без teardown, reconnect, rerender и изменения scroll/unread/composer.
- Commit сначала завершает анимацию, затем вызывает существующий `showChatsList()/leaveActiveChat()`. Header Back и Android/system Back используют тот же executor с прежним fallback.
- Зафиксированы race guards, physical acceptance matrix и cache-bust для iPhone PWA; устаревшая длинная подсказка микрофона удалена из исполняемого UI.
- **Build 183.9 — текущая стабильная контрольная точка в `main`.**
- [Контракт](docs/Build183_1_Chat_Back_Ownership.md) · [приёмка](docs/Build183_8_Chat_Back_Acceptance.md) · [release candidate](docs/Build183_9_Release_Candidate.md).

---

# 🎙 Build 182 — microphone permission и MediaStream ownership

**23 сентября 2026 · Build 182.1–182.6**

- Существующий MediaManager стал единственным владельцем microphone permission state, одного in-flight запроса, получения и освобождения `MediaStream`; voice recording делегирует ему доступ к микрофону.
- При `granted` запись стартует без лишнего FPChat pre-dialog, при `denied` повторный media request не выполняется, а пользователь получает инструкцию открыть разрешение браузера/сайта.
- FPChat не пытается «сохранить» browser/OS permission в localStorage и не удерживает microphone stream между записями или после закрытия приложения.
- Добавлен одноразовый session hint для случая, когда браузер снова сообщает `prompt` после ранее успешного доступа.
- [Приёмка Build 182.3](docs/Build182_3_Microphone_Acceptance.md).

---

# 🔔 Build 181 — системные push-уведомления

**23 сентября 2026 · Build 181.1–181.9**

- Клиентское владение notification settings/permission/subscription перенесено в `NotificationManager181`; удалён старый глобальный `window.fetch` patch для `notifySystemEvents`.
- Серверная отправка Web Push вынесена в `NotificationService181`; существующие room message/join/leave push сохранили прежний путь.
- Добавлена device-level PushSubscription для персональных системных событий, прежде всего chat request received/accepted/rejected/expired.
- После durable `SystemEventStore.add()` сервис повторно читает запись и использует dedupe `system_event_id + device_id`, чтобы не отправлять событие из откатившейся транзакции и не дублировать push.
- Нажатие personal system push открывает System Chat и нужный `systemEventId`, а не pending room; секреты invite/recovery/encryption в payload не включаются.
- [Приёмка Build 181.7](docs/Build181_7_Notification_Acceptance.md).

---

# ✅ Build 180 — финальная архитектурная приёмка 169–180

**23 сентября 2026 · Build 180.1–180.14**

- Закреплена canonical block truth и устранены обходы block owner в invite flow.
- Изолированно проверены Windows updater/launcher: один серверный процесс, сохранение данных/окружения и восстановление полного snapshot после неудачного update.
- Зафиксирован accepted startup graph; отдельный AppCoordinator признан лишним, существующий `FPStartup174` остаётся координатором запуска.
- Выполнен single-owner audit реальных writers/listeners/timers, а не только названий manager-классов.
- Накопительная автоматическая приёмка: **109 PASS, 1 EXPECTED_FAIL, 0 FAIL**, плюс Windows acceptance и отдельный rollback последнего runtime-transfer.
- Build 180.14 оформлен как release candidate; физическая матрица на реальных устройствах в отчёте оставалась отдельным этапом.
- [Release decision 180.14](docs/Build180_14_Release_Decision_Report.md) · [общая архитектурная приёмка 169–180](docs/FPChat_Final_Architecture_Acceptance_169-180.md).

---

# ⚙️ Build 179 — явная server composition и DB/media ownership

**22 сентября 2026 · Build 179.1–179.9**

- Проведена инвентаризация server bootstrap patches/installers; production loader interception удалён, а `node server.js` стал явным production entry.
- Явно подключены существующие message actions/pins, block stores/guards, presence, typing, username, system events, storage stats, chat requests и voice installers без создания параллельных реализаций.
- Вынесены и проверены владельцы encrypted image persistence и cleanup.
- History DB read path диагностирован и закреплён за одной принятой transaction boundary без второго DB pool.
- [Архитектурная приёмка 169–180](docs/FPChat_Final_Architecture_Acceptance_169-180.md).

---

# 🧭 Build 178 — store/render/read/gesture/scroll ownership

**22 сентября 2026 · Build 178.1–178.28.1**

- Закреплены входящий путь `MessageStore172`, message status truth и reply dependency unload/return.
- Приняты HistoryManager page load, saved anchor, reply/pin jump и bounded DOM; chat-list и incoming message mount проходят через утверждённых render-владельцев.
- Введён `FPReadState178` для visible-read admission/flush и сохранён корректный unread divider.
- Уточнены layer/overlay contracts, arbitration drawer/long-press/reply, back gestures и vertical scroll.
- Проведена карта всех message-scroll/geometry writers; сохранён `FPScroll173` как владелец scroll, защищены prepend во время user scroll, unread restore и keyboard/orientation header behavior.
- [Архитектурная приёмка 169–180](docs/FPChat_Final_Architecture_Acceptance_169-180.md).

---

# 🧩 Build 177 — composer, send, media и resource ownership

**22 сентября 2026 · Build 177.1–177.26**

- Подтверждён единый `FPNetwork171` для fetch/XHR, физической записи/удаления управляемого media cache и существующего weighted media budget: один encrypted original или до четырёх thumbnails.
- Cache clear проведён через существующие `FPStorage167` + clear guard + `FPNetwork171`, без второго cache writer.
- Composer поэтапно получил единые точки bind/sync для normal/draft/reply/edit mode с привязкой к RoomContext.
- Добавлен статeless `FPSendManager177`: text/media/ready-voice entry points делегируют ему запуск **существующих** executors без новой очереди, retry store или synthetic IDs.
- `FPMediaManager177` оборачивает lifecycle preview, thumbnail ObjectURL, voice UI и media viewer; запись голоса и media workers не переписаны.
- Финальные 177.26 hotfix исправили освобождение incoming media prefetch slots и auto-promote принятого chat request.
- [Media resource contract](docs/Build177_ResourceArbiterContract.md) · [cache ownership](docs/Build177_CacheOwnership.md) · [send entry points](docs/Build177_SendEntryPoints.md).

---

# ⚙️ Build 176 — lifecycle, room session, connection и sync

**21 сентября 2026 · ветка `build/176-development`**

- Lifecycle-сигналы остаются у `FPLifecycle170`; request cooldown использует общий foreground-сигнал с compatibility fallback только при отсутствии владельца.
- `FPRoomContext170` сохраняет generation/cancellation экранной сессии отдельно от долгих операций; unread observer освобождается при выходе, voice-send привязан к отдельному operation lifetime.
- `FPConnection170` владеет current socket lifecycle, generation/manual-close и reconnect timer/attempt, но сам `new WebSocket` и payload worker остаются существующими в `app.js`.
- `FPSyncCoordinator176` — тонкий adapter над существующими reconnect/resume sync-входами; общий `stableWsSyncPromise` остаётся единственной дедупликацией batch.
- Поздние sync/API результаты не откатывают свежие WS preview/unread и не меняют DOM/read новой активной комнаты.
- Накопительная проверка на GitHub Actions: 6/6 static/VM 169–174, 17/17 browser 173, 17/17 browser 174, 18/18 audit 174 и 24/24 сценария 175 — **76/76 browser PASS, 0 FAIL**. Дополнительно проверены 176 ownership/runtime-инварианты.
- [Полный отчёт Build 176](docs/FPChat_Build176_Progress.md). `main` и production остаются на Build 168; физические mobile/PWA, push и реальный микрофон автоматическим Chromium-runner не подтверждаются.

---

# 🛠 Build 175 — сохранение поведения и точечные UI-исправления

**21 сентября 2026 · ветка `build/175-development`**

- После отправки текста, восстановления draft и открытия edit вызывается существующая синхронизация send/mic из `voice.js`. Запись, preview и upload используют прежнюю реализацию.
- Существующий `FPGesture135` отменяет ожидающий long press строки при захвате drawer-свайпа, повышении слоя и отмене сессии. Намеренный long press, обычный tap, прокрутка и работа мышью сохраняются; алгоритм drawer и пороги не переписаны.
- Исправлена регрессия 174: raw ID сообщения следует каноническому server ID после ACK, чтобы повторная отрисовка не убирала пункты edit/delete. Протокол и правила merge содержимого/статусов не изменены.
- Исправления разделены на коммиты с собственными regression-сценариями и точками rollback. Следующий полный перенос владельца не начат.
- Итоговый прогон: 6 наборов static/VM 169–174 и 76 браузерных сценариев — PASS; новые проверки запускаются через `npm run test:175`.
- [Проверки, сравнение с 168/174, ограничения и откат](docs/FPChat_Build175_Progress.md). `main` остаётся на 168; физические iOS/Android, PWA, push и разрешения микрофона требуют ручной приёмки.

---

# ⚡ Build 174 — точечный render и ограниченное окно истории

**20 сентября 2026 · ветка `build/174-development`**

- После внешнего аудита исправлены production upload/cancel, сохранение нового draft/reply, гонка edit/delete перед mount истории и pruning reply-source. Startup ожидает RoomContext/room-open/send до прямого `/chat` или `/i`; удалён повторный repair-open.
- Message long-press/swipe используют FPGesture135, контекстное меню не восстанавливает старый scrollTop. App/typing/voice получают lifecycle от общего владельца. Исторические исходящие сообщения не снимают unread-divider.
- Pending отправки тоже входят в DOM-бюджет: выгружаются с сохранением Store/retry и восстанавливаются при прокрутке. Media stream не копируется целиком сетевым ограничителем; один оригинал занимает слот до конца потребления/расшифровки, thumbnails — до четырёх.
- Добавлен необязательный uploadId для отмены после server commit при ещё не полученном ответе; старый API совместим, миграций БД нет. [Аудит 15 замечаний, проверки и ограничения](docs/FPChat_Audit_170-174.md).
- По просьбе пользователя в **план 175** включены пропадающий микрофон и ложный long-press при открытии бокового меню. На момент выпуска 174 эти два UI-дефекта ещё не были исправлены.
- Список чатов обновляет изменённые строки по ключу комнаты, сохраняет DOM и обработчики остальных строк; частые обновления объединяются. Создание, удаление строк и расшифровка истории выполняются порциями с отменой устаревшей работы.
- Составлена карта критических startup-зависимостей. Preload загружает критические ресурсы заранее; выполнение сохраняет существующие цепочки, а room-open ожидает установку room-lifecycle.
- Далёкий anchor, reply и pin используют существующие `before/after` API. История прокручивается в обе стороны и удерживает рабочее окно до 300 сообщений; pending входят в этот предел; временные подготовленные страницы описаны в отчёте.
- Сохраняются непрочитанные за границами окна, пиксельная позиция, canonical edit/delete/reply и выделение выгруженных сообщений. Исправлены ранний unread divider, переход по кнопке непрочитанных, продвижение курсора через tombstones и поздние thumbnails.
- Проверки: `npm run check:169-174`, **17/17** сценариев регрессии 173, **17/17** сценариев 174 и **18/18** сценариев дополнительного аудита. Замеры выполнены на изолированном Linux/Chromium; ускорение на физических телефонах не заявляется.
- [Реализация, сырые замеры, ограничения покрытия и откат](docs/FPChat_Build174_Complete.md). На момент выпуска 174 `main` оставалась на 168, этап 175 ещё не был начат.

---

# 🛠 Build 173–169 — владельцы ресурсов и проверка интеграции

**17–19 сентября 2026 · ветка разработки**

### Build 173 — Layer/Gesture/Scroll/Viewport и доработка после аудита

- Добавлены LayerManager и DOM lifecycle; развивается существующий `FPGesture135`, закреплены владельцы scroll и viewport.
- Аудит выявил незавершённую интеграцию 170–173. Исправлены поздние результаты A → B → A, смешение ключей draft, двойной submit и закрытие чужого media preview.
- Удалён независимый invite/join из слоя блокировок: вход использует канонический RoomContext, сообщения об отказе сохранены. Успешное позднее присоединение сохраняет доступ/recovery без самовольного открытия экрана.
- Исправлены pre-aborted XHR, ограничение media downloads до окончания body, echo/ACK collision и reply dependencies. Pins и preview вложений включены в modal ownership.
- Совместная проверка: `npm run check:169-173` и **17/17** браузерных сценариев. [Отчёт, границы покрытия и откат](docs/FPChat_Audit_169-173.md).
- Реальные iPhone PWA/Android, полный media/voice UX и числовой baseline устройств ещё требуют приёмки. На момент завершения 173 работа над 174 ещё не была начата; её последующее состояние приведено выше.

### Build 172 — MessageStore и reply

- Каноническое состояние сообщений, зависимости reply и правила merge для edit/delete/status.
- Сохраняются существующие retry/clientMessageId; новая persistent queue не добавляется.

### Build 171 — сеть и media cache

- `FPNetwork171` координирует fetch/XHR и compatibility adapters, ограничивает media concurrency и физические записи кэша.
- Сохраняется формат `fpchat-media-v167`; введены cleanup и ограничение voice Blob cache.

### Build 170 — контекст комнаты и lifecycle

- RoomContext, generation/cancellation и отдельный контекст уже начатой отправки.
- Единый Connection owner поверх существующего WS, lifecycle events и дедупликация sync.

### Build 169 — наблюдение и проверочная база

- Пассивный `FPRuntime`, карта владельцев, optional server sampler и read-only DB diagnostics.
- Покрытие неполных метрик указано явно. Методика baseline сохранена; результаты измерений реальных устройств не подменяются static audit.

---

# ⚙️ Build 168–167 — учёт и очистка media cache

**16–17 сентября 2026**

### Build 168 — учёт ранее сохранённых медиа

- Media inventory и учёт legacy cache; повторный scan сделан идемпотентным.
- Текущая стабильная контрольная точка в `main`.

### Build 167 — управление хранилищем

- Настройки хранения и очистка media cache, защита от повторного заполнения во время очистки.
- Исправлены захват cache response и лишний prefetch исходящих media.

---

# 🔒 Build 166–153 — конфиденциальность, антиспам и полноценная блокировка

**15–16 сентября 2026**

После появления `@username`, системного чата и запросов на новый диалог FPChat получил полноценный слой конфиденциальности. Новые функции по-прежнему добавлялись поверх существующих комнат, `invite/join`, сообщений и presence, без создания параллельной системы общения.

### 🛠 Build 166 — стабилизация блокировок

- Исправлено зависание приложения при открытии настроек, вызванное самоповторяющимся `MutationObserver` в интерфейсном слое Build 165.
- DOM теперь изменяется только тогда, когда новое значение действительно отличается от текущего, что устраняет цикл мутаций.
- Для голосовых сообщений добавлена отдельная понятная реакция на блокировку: запись/отправка не маскируется общей ошибкой **«Не удалось отправить голосовое сообщение»**.
- Заблокированный пользователь получает явное сообщение **«Голосовое не отправлено: пользователь вас заблокировал.»**.
- Проверка выполняется уже на `pointerdown`, поэтому запись не начинает запускаться до проверки блокировки.

> [!IMPORTANT]
> **Build 166 зафиксирована как стабильная контрольная точка FPChat.** Полный регрессионный сценарий блокировки, presence, typing, сообщений, медиа, голосовых, чёрного списка, invite и системного чата был успешно пройден на двух/трёх участниках. Следующий этап — оптимизация производительности, при которой логика, управление и пользовательский UX должны оставаться идентичными Build 166.

### 🔒 Build 165 — полноценная блокировка пользователя

- Блокировка запросов превратилась в настоящую пользовательскую блокировку на уровне пары устройств.
- Если **A заблокировал B**, новые сообщения между ними не отправляются в обе стороны до разблокировки со стороны A.
- Блокировка распространяется на существующие и будущие комнаты между этой парой, но не удаляет историю, файлы, recovery-коды и сами комнаты.
- Сообщения, отправленные до момента блокировки, доставляются как обычно; для старой переписки сохраняется штатная система `✓ / ✓✓ / синие ✓✓`.
- Блокировать и разблокировать пользователя можно из публичного профиля, меню открытого чата и чёрного списка — везде используется одна серверная запись блокировки.

#### 🎨 Поведение заблокированного чата

- У блокирующей стороны обычный composer заменяется состоянием **«Вы заблокировали пользователя»** с кнопкой **«Разблокировать»**.
- Заблокированная сторона при попытке отправки получает понятную локальную плашку, а сообщение не создаётся и не отправляется.
- Blocker продолжает видеть presence собеседника, а заблокированная сторона вместо статуса blocker видит **«Статус недоступен»**.
- Typing и другая временная активность не раскрывают presence блокирующей стороны заблокированному пользователю.
- Серверная проверка применяется не только к тексту, но и к медиа, файлам, голосовым сообщениям и другим путям отправки.

#### 🔗 Блокировка и одноразовые invite-ссылки

- Перед присоединением по invite сервер проверяет блокировку между создателем комнаты и входящим пользователем.
- Если создатель комнаты заблокировал входящего пользователя, тот получает явную ошибку о блокировке и не становится участником комнаты.
- Если входящий пользователь сам заблокировал создателя, FPChat предлагает сначала снять собственную блокировку.
- Неудачная попытка из-за блокировки **не расходует одноразовый invite**: ссылка считается использованной только после успешного присоединения.
- Заблокированный пользователь не получает recovery-код и данные комнаты.
- Информация о неудачной попытке не записывается в саму комнату. Она приходит только владельцу в его личный **системный чат FPChat**.
- Повторные попытки по одной связке `комната + пользователь` не создают спам из одинаковых карточек: существующее уведомление обновляется и увеличивает счётчик попыток.
- В карточке используются актуальные ник и `@username`, если username установлен.
- Из уведомления можно сразу **разблокировать пользователя и открыть связанный чат**, не разыскивая его вручную в списке.

### 🪪 Build 164–163 — стабильная идентичность пользователя

- **Build 164** — серверная идентичность окончательно отделена от `@username`.
- `deviceId` используется как стабильный идентификатор пользователя для блокировок и внутренних связей.
- Ник хранится независимо и продолжает синхронизироваться даже без установленного username.
- `@username` остаётся необязательным изменяемым публичным адресом.
- После удаления или смены username старое значение больше не отображается как актуальное и не используется как fallback.
- Если старый username позже займёт другой пользователь, существующая блокировка всё равно остаётся привязана к исходному `deviceId`.
- **Build 163** — исправлено отображение имени заблокированного пользователя в чёрном списке.

### 👤 Build 162 — чёрный список и защита от дубликатов

- В `Настройки → Конфиденциальность` появился **«Чёрный список»**.
- Пользователя можно разблокировать как из списка, так и из его публичного профиля.
- Если между пользователями уже существует доступный активный чат, публичный профиль предлагает **«Открыть чат»**, а не создаёт второй одинаковый диалог.
- При этом **«Удалить из списка»** не становится скрытой блокировкой: старый чат можно восстановить, а новый диалог при необходимости по-прежнему разрешён.
- Старая скрытая комната автоматически не удаляется и остаётся частью истории пользователя.

### 🔐 Build 161–154 — конфиденциальность, антиспам и поиск

- Добавлена серверная защита от спама запросами на новый чат.
- Для пары отправитель → получатель введена возрастающая задержка после последовательных отклонений: от короткого cooldown до длительной блокировки повторных запросов.
- Дополнительно действуют общие лимиты исходящих запросов за минуту, 10 минут и час.
- Ограничения проверяются сервером, а клиент показывает живой таймер и автоматически обновляет состояние после завершения cooldown.
- Ручная блокировка остаётся абсолютной до явной разблокировки пользователем.
- В настройках профиля появились отдельные параметры **«Разрешить поиск по @username»** и **«Разрешить запросы на новый чат»**.
- Общий поиск получил понятный сценарий поиска по `@username`, подсказку и отдельную кнопку очистки строки.
- Существующая механика локального поиска по чатам при этом не была переписана.

### ⚙️ Build 153 — стабильный запуск

- Сохранён readiness-gate предыдущей сборки и стабилизировано отображение состояния запуска приложения.
- Улучшена защита от зависания на экране подготовки при проблемах с необязательными ресурсами.

---

# 🟢 Build 152–145 — запросы на чат и системный интерфейс

**14–15 сентября 2026**

Этот этап превратил `@username` из простого идентификатора пользователя в способ безопасно начать новый диалог, не создавая отдельную параллельную механику комнат.

### ⚙️ Build 152 — запуск приложения

- Добавлен readiness-gate для холодного запуска.
- Экран подготовки остаётся видимым, пока необходимые части клиента действительно не готовы.
- Дополнительно исправлялась проверка порта в updater.

### 📱 Build 151–148 — системный чат и жесты

- **Build 151** — доработан `long-press`: защита от ложного открытия контекстного меню и более предсказуемое поведение на телефоне.
- **Build 150** — стабилизировано отображение карточек и превью запросов.
- **Build 149** — устранён конфликт жеста FPChat с нативной edge-навигацией браузера.
- **Build 148** — добавлен свайп от левого края для возврата из системного чата.

### ✨ Build 147–145 — запросы на начало чата

- **Build 147** — добавлен полноценный жизненный цикл запроса: состояние, таймер, принятие и синхронизация интерфейса.
- **Build 146** — добавлены действия **Принять / Отклонить / Заблокировать**.
- Блокировка запрещает конкретному отправителю повторно отправлять запросы этому пользователю.
- **Build 145** — из публичного профиля можно отправить запрос на новый чат.
- Входящие запросы появились в отдельном **системном чате**.
- Принятие запроса использует уже существующую механику FPChat `invite/join`, вместо создания второй системы комнат.

---

# 👤 Build 144–140 — `@username`, поиск и профиль

**14 сентября 2026**

Появился публичный слой профиля, который не вмешивается в существующую механику приватных комнат.

- **Build 144** — результат поиска открывает карточку публичного профиля; добавлены изолированные системные события и клиентский мост для них.
- **Build 143** — реализован поиск пользователя по точному `@username`.
- **Build 142** — добавлено публичное отображаемое имя и его синхронизация.
- **Build 141** — защищены зарезервированные и служебные имена; назначение системных username ограничено сервером.
- **Build 140** — добавлен необязательный `@username`, настройки профиля и серверный реестр username.

> Механика username была добавлена поверх существующих комнат FPChat: обычные чаты, загрузки и голосовые сообщения не переписывались под новую функцию.

---

# 📱 Build 139–136 — мобильный viewport и iOS safe-area

**14 сентября 2026**

Серия сборок была посвящена стартовому положению интерфейса и устранению заметных полос/стыков в PWA на iOS.

- **Build 139** — дополнительно синхронизирован фон мобильной поверхности на iOS.
- **Build 138** — safe-area при запуске приведена к фону панели списка чатов.
- **Build 137** — отдельный viewport-патч и нормализация startup safe-area.
- **Build 136** — OS-aware обработка мобильного viewport; при первом рендере приложение открывается на панели списка чатов.

---

# 💬 Build 135–92 — управление сообщениями как в мессенджере

**12–14 сентября 2026**

В этом диапазоне основной акцент сместился на сенсорное управление, контекстные действия и привычное для Telegram поведение чата.

### ⌨️ Build 116 — состояние собеседника

- Добавлен индикатор набора сообщения.
- Подключено серверное событие `typing` и клиентское отображение состояния.

### 💬 Build 100 — контекстное меню сообщений

- Добавлено Telegram-подобное контекстное меню сообщения.
- На телефоне меню вызывается долгим нажатием.
- Новая функция адаптирована под существующую механику сообщений, а не наоборот.
- В следующих сборках исправлялись зоны `long-press`, поведение больших сообщений, изображений и мобильных жестов.

### 📱 Build 92 — навигация и жесты

- Проверенная механика iOS swipe-back перенесена на стабильную основу: свайп вправо возвращает к списку чатов внутри приложения.
- Нативная edge-навигация Safari подавляется во время жеста FPChat.
- При этом сохранены вертикальная прокрутка и свайп влево для ответа.

> Между отмеченными вехами было много промежуточных технических сборок. Они объединены здесь, если не несли отдельного заметного пользовательского изменения.

---

# 🔄 Build 91.77–50 — история, unread, push и стабильность соединения

**03–12 сентября 2026**

Один из самых больших этапов стабилизации FPChat. Здесь формировалось поведение чата при открытии, возврате из офлайна и получении новых сообщений.

### ⚙️ Build 91.77 — возврат к стабильной основе

- Добавлен принудительный чистый переход с проблемных post-77 сборок обратно на проверенную основу.

### 📱 Build 77 — стабильная основа

Build 77 стал важной стабильной точкой, к которой разработка несколько раз возвращалась при проблемах последующих версий.

- Исправлялось сенсорное прокручивание чата на телефоне.
- Исправлено мобильное контекстное меню, где касание могло сразу активировать первый пункт.
- Исправлено удаление старых/несуществующих комнат и прекращена их повторная синхронизация.
- Восстанавливался полный клиентский bundle после неудачных изменений.

### 🟢 Build 67 — presence и WebSocket

- Переработан жизненный цикл присутствия пользователя.
- После входа или возврата приложение восстанавливает соединение и синхронизирует чаты без дополнительного действия пользователя.
- При сворачивании клиент переводит пользователя в офлайн.
- Исправлено отображение online-статуса в рамках конкретной комнаты.
- WebSocket начинает работу до reconciliation непрочитанных, чтобы уменьшить рассинхронизацию при старте.

### ⚙️ Build 56–55 — обновление и развёртывание

- **Build 56** — исправлено определение исходной папки проекта на флешке.
- **Build 55** — усилен Windows updater.

### 📚 Build 54–50 — история, unread и push

- **Build 54** — исправлено Telegram-подобное восстановление позиции прокрутки.
- Состояние нижней позиции чата стало сохраняться.
- Устранены скачки прокрутки при загрузке медиа.
- **Build 52** — стабилизированы WebSocket и lazy history.
- **Build 51** — улучшены запрос разрешения уведомлений и синхронизация push.
- Исправлена отправка нескольких push-уведомлений на одно сообщение.
- Добавлена синхронизация unread после возвращения из офлайна.
- Стабилизированы кружки непрочитанных чатов.
- Добавлена плашка **«Новые сообщения»** над первым непрочитанным.
- Позиция первого непрочитанного и разделителя стала сохраняться в течение сессии чата.
- **Build 50** — добавлена ленивая загрузка истории: вместо всей переписки сразу клиент загружает последние `100` сообщений.

---

# 🧱 Переход к современной ветке — сентябрь 2026

Перед современной нумерацией Build были отдельно зафиксированы важные базовые изменения:

- 🛠 исправлялись подтверждения доставки и защита invite-процесса.
- 🛠 стабилизированы статусы доставки текстовых сообщений.
- ⚙️ стабилизирована идентичность устройства между запусками.
- 🔒 recovery был привязан к конкретному `deviceId`.

Именно на этой базе затем началась серия **Build 50+**.

---

<details>
<summary><strong>🧪 Beta 85 → Alpha 34 — ранняя экспериментальная фаза</strong></summary>

### 24–27 мая 2026

Разработка в эти дни шла очень быстрыми итерациями, поэтому большая часть Git-коммитов содержит только номер версии и не позволяет достоверно восстановить каждое изменение отдельно.

Подтверждённые особенности истории — от более новых к более старым:

- после **Beta 85** был выполнен откат/переход назад к **Beta 80**;
- **Beta 75–76** были помечены в истории как проблемные по лагам;
- **Beta 49** сопровождалась явным откатом (`ОТКАТ`);
- Beta-ветка развивалась от **Beta 40** до **Beta 85**;
- перед Beta использовались **Alpha 39 → Alpha 34**, после чего проект перешёл к обозначению Beta.

Этот период сохранён в changelog как единый этап, потому что расшифровывать каждый номер без подтверждённого описания означало бы придумывать историю проекта.

</details>

---

<details>
<summary><strong>🌱 Alpha 33 → Alpha 6 — формирование первого FPChat</strong></summary>

### 21–24 мая 2026

- Alpha-фаза дошла до **Alpha 33**, развиваясь короткими итерациями от Alpha 6.
- В районе **Alpha 23–22** локальные файлы базы данных были удалены из Git-репозитория и перестали храниться как обычные отслеживаемые файлы проекта.
- Для большинства Alpha-коммитов в Git указано только название версии (`Alpha N`), поэтому конкретные функции по каждому номеру здесь намеренно не приписываются.

</details>

---

<details>
<summary><strong>🌱 Pre-alpha 5 → Initial — рождение проекта</strong></summary>

### 28 марта — 21 мая 2026

#### Pre-alpha 5 — май 2026

К **Pre-alpha 5** репозиторий уже описывал рабочий локальный MVP:

- 💬 базовая механика приватного общения;
- 🔒 клиентский слой шифрования;
- ✓ статусы доставки и прочтения сообщений;
- 💾 хранение данных через SQLite;
- 🔗 вход в чат по invite-ссылке.

Перед ней последовательно использовались `pre-alpha 4`, `pre-alpha 3`, `pre-alpha 2` и `Pre-alfa`.

#### Initial commit — 28.03.2026

Самое раннее описание FPChat было предельно простым: чат по приглашениям. Это была исходная идея будущего приватного мессенджера.

Именно путь от Initial к Pre-alpha 5 превратил FPChat из идеи «чата по инвайтам» в самостоятельный работающий прототип.

</details>

---

# 🧭 Принцип развития FPChat

> **Новая функция адаптируется под уже существующую механику FPChat. Старая рабочая механика не должна переписываться под новую функцию без необходимости.**

Особенно это относится к комнатам, сообщениям, `invite/join`, уведомлениям, presence и мобильному управлению.

> **Рабочая Build 168 является эталоном поведения для дальнейшей оптимизации. Build 169–174 — накопительные архитектурные улучшения поверх этой механики, а не повод переписывать уже рабочее приложение.**

> **Оптимизация не должна менять пользовательскую механику. Сначала фиксируется и проверяется текущее поведение, затем меняется внутренняя реализация, после чего выполняется регрессия относительно Build 168 и уже подтверждённых исправлений следующих сборок.**

### Правила внедрения менеджеров и арбитров

- Менеджеры и арбитры вводятся **постепенно поверх существующей рабочей логики**, а не как параллельная новая реализация приложения.
- **При передаче управления менеджеру или арбитру существующая логика и пользовательское поведение не меняются:** меняется только владелец/точка управления. Рабочие сценарии Build 168 должны выполняться так же, как до архитектурной миграции.
- Перед передачей ресурса новому владельцу сначала фиксируется, **как он реально работает в Build 168**, и сохраняются соответствующие тесты/сценарии.
- Новый менеджер сначала подключает и координирует существующую механику. Переписывать рабочий механизм только ради более красивой архитектуры запрещено.
- Для каждого изменяемого ресурса должен быть **один фактический владелец**. После завершения миграции старый самостоятельный путь обязан перестать независимо выполнять ту же работу.
- Арбитр не выполняет действие сам: он только решает, **кто получает право управлять конфликтующим ресурсом или действием**. Само действие выполняет соответствующий менеджер или контроллер.
- Нельзя одновременно менять архитектуру и пользовательский UX, протокол обмена, формат данных или смысл существующих действий без отдельной задачи на такое изменение.
- Нельзя создавать второй WebSocket, второй механизм комнат, вторую очередь отправки, второго cache writer, второго владельца scroll/gesture или другой параллельный путь только ради миграции.
- Fallback и старый путь нельзя удалять, пока не доказано, что новый владелец полностью сохраняет нужное поведение и покрытие.
- Один этап миграции должен переносить **одну понятную область ответственности**, иметь отдельную проверку и точку отката. Несколько крупных владельцев не переносятся одним неразделимым изменением.
- Если новый менеджер или арбитр ломает рабочий сценарий Build 168, исправляется или откатывается новая архитектурная часть — рабочая механика не подгоняется под неё без необходимости.
- После каждого переноса проверяется не только наличие нового владельца, но и отсутствие старого независимого владельца того же ресурса.

> **Цель архитектурной оптимизации FPChat — не переписать приложение, а сделать существующую рабочую механику быстрее, стабильнее и предсказуемее, сохранив её поведение.**

> **CHANGELOG всегда ведётся от новой версии к старой. Новая сборка добавляется выше предыдущей; диапазоны, подразделы и отдельные описания внутри этапа также располагаются по убыванию номера версии.**

---

<details>
<summary><strong>📝 Как добавлять следующие обновления</strong></summary>

Новые сборки сначала добавляются сверху отдельными записями. Когда несколько версий образуют законченный этап, их можно объединить в общий блок, сохранив порядок от большей версии к меньшей.

```md
# 🚀 Build 170–167 — название крупного обновления

**ДД–ДД.ММ.ГГГГ**

Короткое описание этапа.

### Build 170
- ✨ Самое новое изменение.

### Build 169
- 🛠 Более раннее исправление.

### Build 168
- 🎨 Более раннее изменение интерфейса.

### Build 167
- ⚙️ Самое раннее изменение этапа.
```

</details>
