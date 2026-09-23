# Build 178.15 — действующие приоритеты и claims FPLayer173

Base: Build 178.14 on build/178-development.

178.15 — audit/contract step. Runtime не меняется. Новый порядок слоёв не вводится.

## Зафиксированный порядок

```text
base       0
chat      10
drawer    20
settings  30
voice     40
selection 50
context   60
modal     70
viewer    80
```

`FPGesture135` сохраняет тот же порядок как compatibility fallback. В штатном режиме источником текущего слоя остаётся `FPLayer173`.

## Claims и действующие контроллеры

| Layer | Claim source | Open | Close | Cancel / interrupted action |
|---|---|---|---|---|
| base | отсутствие активных claims | обычный основной экран | появление любого claim выше base | активная gesture-session отменяется своим recognizer/FPGesture lifecycle |
| chat | `FPDOM173 chat mounted` → `dom:chat` | существующий `openChat()` монтирует `.chat-view` | `showChatsList()` / `leaveActiveChat()` убирают chat view | navigation recognizer обрабатывает `touchcancel`; legacy recognizer fallback-only |
| drawer | `#sidebar.open` → `sidebar:open` | `openMobileMenu()` | `closeMobileMenu()` | незавершённый edge swipe сбрасывается по `touchcancel`; layer claim появляется только у реально открытого sidebar |
| settings | `FPDOM173 settings mounted` → `dom:settings` | `renderSettings131()` / существующий `setView('settings')` | back handler / смена view удаляет `.fp-settings131` | существующий fallback back recognizer имеет `pointercancel`; global swipe owner имеет `touchcancel` |
| voice | composer classes → `composer:voice` | `fp-voice-recording`, `fp-voice-previewing`, `fp-voice-processing` | `stopRecording()` / finalize / `clearPreview()` снимают classes | `pointercancel` → `finishPress(..., true)` → cancel recording |
| selection | `body.fp-message-selection-open` → `body:selection` | `startSelection()` | `exitSelection()` | `touchcancel` очищает только текущий selection gesture; режим закрывает selection controller |
| context | `.message-context-root` → `dom:context`; legacy room menu → `legacy-context-menu` | `openContext()` или legacy room menu | `closeContext()` / legacy menu close | pending long press очищается на `touchcancel`; lifecycle release проверяется отдельно в 178.17 |
| modal | `FPDOM173 modal mounted` → `dom:modal`; modal-family selectors + `[aria-modal="true"]` | каждый существующий controller создаёт свой overlay | тот же controller удаляет свой overlay | cancel/backdrop/Escape/кнопка остаются механикой конкретного modal; FPLayer UI не закрывает |
| viewer | `.media-viewer-overlay` → `dom:viewer` | `openMediaViewer134()` / MediaManager177 worker | `closeGallery()` / существующий viewer controller | `pointercancel`/`touchcancel` отменяют gesture, но viewer не закрывают сами |

## Граница ответственности

`FPLayer173` владеет только активным layer/claim. Он не открывает и не закрывает UI.

`FPGesture135` владеет arbitration одной input-session: `watchAction`, `claimAction`, отмена конкурентов и promotion при появлении верхнего слоя. Он не становится feature recognizer.

Feature-модули продолжают владеть своими open/close/cancel.

## Что намеренно не делается

- не добавляется новый priority;
- не меняется порядок priorities;
- не создаётся второй layer stack;
- не добавляются ручные claims поверх существующих DOM/body/sidebar/composer claims;
- lifecycle конкретного overlay остаётся отдельным шагом 178.16/178.17;
- новая пара gesture recognizers остаётся шагом 178.19.

Regression: `npm run test:178:layer-contract`.
