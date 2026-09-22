# Build 178.16 — audit одного overlay claim: обход не найден

Base: Build 178.15 on `build/178-development`.

Правило шага: ручной claim добавляется только при доказанном обходе текущего `FPLayer173/FPDOM173`.

## Результат

После аудита реального overlay-bypass не найдено. Поэтому runtime в 178.16 не меняется и новый `FPLayer173.claim()` не добавляется.

## Уже покрытые overlay

Явные modal selectors:

- `.media-preview-overlay`;
- `.fp-pins114-screen`;
- `.fp-pins114-action-overlay`;
- `.fp-pins114-delete-overlay`;
- `.message-delete-overlay`;
- `.message-selection-delete-overlay`;
- `.destructive-modal-overlay`;
- `.message-pin-overlay`.

Отдельные верхние слои: `.media-viewer-overlay → viewer` и `.message-context-root → context`.

## Wrapper overlays с вложенным dialog

`fp-profile144-overlay` и `fp-system145-overlay` не перечислены отдельными modal selectors, но обходом не являются: внутри них существующие feature controllers создают элемент с `aria-modal="true"`.

`FPDOM173.collect(root, selector)` проверяет и сам добавленный root через `root.matches(selector)`, и descendants через `root.querySelectorAll(selector)`. Поэтому вложенный `[aria-modal="true"]` на том же mount/unmount цикле создаёт и освобождает существующий `dom:modal` claim.

## Граница владельцев

Feature controller создаёт overlay, назначает handlers и удаляет overlay. `FPDOM173` сообщает mount/unmount. `FPLayer173` отражает claim/top-layer. `FPGesture135` запрещает нижнему recognizer/navigation действовать под верхним слоем.

В 178.16 не добавлены manual `claim/setClaim`, второй layer stack или новые open/close handlers. Lifecycle release конкретного overlay остаётся отдельным шагом 178.17.

Regression: `npm run test:178:overlay-claim`.
