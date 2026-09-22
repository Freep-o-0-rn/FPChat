# Build 178.23 — message removal scroll writer

Base: Build 178.22 on `build/178-development`.

178.23 migrates exactly one previously audited message-scroll bypass: `message-actions.js::keepViewportWhileRemoving()`.

## Before

The function already preferred the existing `scrollCoordinator`, but had two direct `box.scrollTop = ...` fallback assignments:

- bottom after removal;
- compensation when a removed message was completely above the viewport.

## After

Both paths use the existing public owner only:

- bottom -> `window.FPScroll173.requestBottom(box)`;
- remove-above -> `window.FPScroll173.write(box, beforeTop - removedHeight, 'auto')`.

No new manager, arbiter, priority, target calculation or scroll behavior was added.

## Preserved contract

The existing decisions and formulas are unchanged:

- `wasAtBottom` is measured before removal;
- `beforeHeight` and `beforeTop` are captured before removal;
- `wasAbove` remains `elRect.bottom <= boxRect.top + 1`;
- `removedHeight = max(0, beforeHeight - box.scrollHeight)`;
- remove-above target remains `beforeTop - removedHeight`;
- behavior remains `auto`;
- if the deleted message is neither an at-bottom case nor fully above the viewport, no compensating scroll is issued.

`app.js` executes before the message-actions stack, so `FPScroll173` already exists when this code becomes active. 178.23 therefore removes the bypass rather than creating another compatibility writer.

## Scope

Only the message-actions bypass is migrated.

The direct fallback in `viewport-fix.js::keepBottomPinned()` is intentionally untouched and remains a separate later candidate.

## Regression

`npm run test:178:scroll-writer` verifies the static owner/target/offset/behavior contract and a browser scenario for:

- deletion while already at bottom;
- deletion of a message above the viewport.

The browser check confirms the resulting bottom target and the exact `beforeTop - removedHeight` compensation remain unchanged.
