# FPChat Build 173 — Layer / Gesture / Scroll / Viewport ownership

Build 173 разрабатывается только в `build/173-development` поверх Build 172. Ветка содержит всю цепочку Build 169 → 170 → 171 → 172 → 173. `main` остаётся на стабильной Build 168 до отдельной ручной регрессии.

## Цель

Убрать конкурирующее управление слоями интерфейса, жестами и мобильной геометрией, не меняя пользовательскую механику FPChat.

Build 173 не создаёт второй GestureManager. Он развивает существующий `FPGesture135` и подключает к нему явного владельца слоёв.

## Реализовано

### 1. FPLayer173 — владелец активного UI-слоя

Добавлен:

```text
public/layer-manager173.js
```

Приоритеты сохранены из FPGesture135:

```text
base < chat < drawer < settings < voice < selection < context < modal < viewer
```

LayerManager хранит явные claims активных слоёв и отслеживает:

- chat;
- drawer;
- settings;
- voice;
- selection;
- message/room context menu;
- modal;
- media viewer.

Для уже существующих элементов используются точечные attribute observers только там, где состояние меняется без mount/unmount:

- body class для selection;
- sidebar class для drawer;
- composer class для voice;
- legacy room context menu class.

Глобальный DOM scan больше не выполняется на каждом `touchmove/pointermove`.

### 2. Развит существующий FPGesture135

`public/gesture-manager135.js` сохранён как единый arbiter.

На нормальном пути Build 173 он получает слой из:

```text
FPLayer173
```

а старый document-wide detectLayer оставлен только fallback, если новый owner asset не загрузился.

Владение жестом фиксируется на старте session. Повторное определение требуется только если версия явного layer stack реально изменилась, например если поверх текущего жеста открылся modal/viewer.

Это убирает повторяющиеся `querySelectorAll/getComputedStyle/getClientRects` из обычного move hot path.

### 3. Один navigation gesture owner

Старые app.js edge/chat swipe handlers не удалены физически, но при активном `FPGesture135` становятся fallback-only.

Активный navigation path:

```text
swipe-fix.js
  → FPGesture135
  → FPLayer173
```

Media gallery проверяет разрешение viewer-layer перед началом gesture.

Старый отдельный viewer-return swipe в message-context на Build 173 не конкурирует с media-gallery. Media gallery остаётся владельцем swipe, а message-context только восстанавливается после фактического закрытия viewer.

System chat уже использует FPGesture135 и продолжает это делать.

### 4. FPDOM173 — централизованные mount/unmount events

Добавлен:

```text
public/dom-lifecycle173.js
```

Один observer публикует lifecycle для:

- chat;
- composer;
- message;
- context;
- settings;
- viewer;
- modal;
- media progress.

На этот owner переведены нормальные пути:

- message-actions decorators;
- message-pins decorators;
- message-selection mount/unmount;
- voice composer/message decoration;
- voice-cancel composer sync;
- viewport chat/composer sync.

Старые broad MutationObserver остаются только compatibility fallback там, где это необходимо для безопасного запуска без Build 173 assets.

### 5. Voice больше не использует 500 мс room polling на нормальном пути

Voice room/composer/message sync теперь получает события:

- FPDOM173;
- `fpchat:room-open170`.

500 мс room watcher сохранён только fallback, если DOM lifecycle owner не загрузился.

Heartbeat активной записи/typing semantics не менялись.

### 6. Scroll ownership

Существующий стабильный `scrollCoordinator` не переписывался.

Он опубликован как:

```js
FPScroll173
```

Это тот же объект, а не новая реализация.

Он остаётся владельцем:

- initial unread positioning;
- bottom requests;
- reply focus;
- prepend preservation;
- scroll generation/opening phase.

Таким образом старый проверенный scroll behavior сохраняется, но ownership становится явным.

### 7. Viewport ownership

Build 173 не объединяет клавиатуру и scroll в один mega-controller.

Разделение ответственности:

```text
FPViewport136   → keyboard state / iOS safe-area classes
FPViewport173   → app viewport height/correction geometry
FPScroll173     → messages scroll position
```

`viewport-fix.js` теперь публикует `FPViewport173` и для bottom pin обращается к `FPScroll173`.

Broad subtree observers viewport-модулей на нормальном пути заменены FPDOM173 events. Их legacy observers остаются fallback-only.

## Что Build 173 не меняет

Не меняются:

- MessageStore 172 и merge rules;
- FPNetwork 171/cache format;
- RoomContext/Lifecycle/Connection 170;
- FPRuntime 169;
- server API;
- E2EE format;
- history page size;
- bounded DOM/virtualization;
- startup lazy loading;
- persistent send queue.

## Диагностика

Доступны:

```js
FPDOM173.snapshot()
FPLayer173.snapshot()
FPGesture135.snapshot()
FPViewport173.snapshot()
FPViewport136.snapshot()
FPMessageStore172.snapshot()
FPNetwork171.snapshot()
```

Диагностика слоёв не содержит roomId/deviceId/message text.

## Автоматическая проверка

Добавлено:

```bat
npm run check:173
```

Проверяются:

- синтаксис изменённых модулей;
- Build 173 loader chain;
- один FPGesture135 без второго GestureManager;
- FPLayer173 и его приоритеты;
- явные selection/drawer/context/voice claims;
- gesture session ownership;
- FPScroll173;
- FPViewport173;
- FPDOM173 integration;
- переведённые decorators;
- viewer gesture ownership;
- VM-проверка priority/claim/release для LayerManager.

## Обязательная ручная регрессия

Перед переходом к Build 174 проверить минимум:

1. обычная прокрутка чата пальцем;
2. edge-back chat → список;
3. edge swipe списка → drawer;
4. settings edge-back;
5. message left-swipe reply;
6. long-press message и context menu;
7. selection + back gesture;
8. photo viewer horizontal swipe;
9. photo viewer vertical close;
10. viewer, открытый из message context, возвращает context после закрытия;
11. voice record: hold / cancel / lock / send;
12. voice waveform seek;
13. room menu long-press не нажимает пункт тем же отпусканием;
14. system chat back swipe;
15. клавиатура iPhone: открыть/закрыть несколько раз;
16. ввод текста при открытой клавиатуре;
17. scroll position при keyboard open/close;
18. первое непрочитанное;
19. lazy history prepend;
20. reply jump;
21. pins;
22. A → B → A;
23. background → foreground;
24. PC, слабый Android, iPhone PWA.

## Статус

После первичных static/VM проверок аудит 19.09.2026 обнаружил ошибки интеграции 170–173. Они исправлены в `build/173-development`: защита поздних room/draft/invite результатов, канонический join, network cancellation/budget, MessageStore identity и modal ownership.

Кодовая доработка прошла `npm run check:169-173` и 17 браузерных сценариев. Подробности, воспроизведение, ограничения и откат: [аудит 169–173](FPChat_Audit_169-173.md).

Полная приёмка требует ручной multi-device регрессии и сохранённого числового baseline устройств. 174 не начата. CI в репозитории не настроен.

## Требование к финальной Build 175

Build 175 должна быть финальной интеграционной точкой всей серии 169–175.

Она не имеет права заменить или обойти владельцев, введённых в 169–174. После серверных этапов 175.1–175.5 выполняется совместная проверка всей цепочки:

```text
169 FPRuntime
170 RoomContext / Lifecycle / Connection
171 FPNetwork / media cache ownership
172 FPMessageStore
173 Layer / Gesture / Scroll / Viewport / DOM lifecycle
174 performance / bounded DOM / startup
175 server / DB / media I/O / updater
```

Финальная 175 считается готовой только после общей регрессии всех этих владельцев вместе.
