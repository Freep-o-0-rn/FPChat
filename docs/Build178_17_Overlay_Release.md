# Build 178.17 — освобождение claim message context

Base: Build 178.16 on `build/178-development`.

Выбран один overlay: `.message-context-root`.

## Доказанный обход

`message-context-root` монтируется непосредственно в `document.body`, а не внутри `.chat-view`. Поэтому удаление/смена chat view само по себе не удаляло context overlay. До 178.17 `message-context.js` не был подписан ни на `FPDOM173 chat:unmounted`, ни на `FPLifecycle170`.

В результате navigation или background/page lifecycle могли оставить старый context DOM и, следовательно, активный `dom:context` claim поверх уже другого состояния приложения.

## Минимальное исправление

Open/close ownership не меняется: прежний `openContext()` создаёт UI, прежний `closeContext()` удаляет UI.

Добавлен только boundary cleanup внутри того же controller:

- `chat:unmounted` → cancel pending long press → `closeContext({restoreScroll:false})`;
- `background/pagehide/beforeunload` → тот же boundary cleanup;
- `touchcancel` до long press → только timer/session cleanup;
- `touchcancel` после уже сработавшего long press → закрывается context, открытый этой отменённой touch-session;
- обычный `touchend` по-прежнему только завершает recognizer и оставляет уже открытый context видимым.

## Освобождение claim

Ручной `FPLayer173.setClaim(false)` не добавлен.

`closeContext()` удаляет `.message-context-root` → `FPDOM173` выдаёт `context:unmounted` → `FPLayer173` удаляет node из mounted context set → существующий `dom:context` claim становится false.

Таким образом UI и layer state не могут разойтись.

Regression: `npm run test:178:overlay-release`.
