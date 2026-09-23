# Build 178.28.1 — stabilize chat header during keyboard opening

Physical acceptance of Build 178.28 found one narrow visual defect: opening the software keyboard can produce a small one-frame jump of the chat header while the message list itself remains stable.

## Cause

`viewport-fix.js` compensates WebKit viewport panning with `--fpchat-viewport-correction-y`, but visualViewport `resize/scroll` previously only scheduled `syncViewportNow()` through `requestAnimationFrame`.

On iOS Safari/PWA, WebKit can expose the transient visual viewport pan before that next frame. The fixed `#appRoot` therefore renders one frame at the browser pan offset before the existing correction catches up.

## Fix

Build 178.28.1 extracts the existing correction formula into `syncViewportCorrectionNow()`.

When the composer is focused and the chat is open, visualViewport `resize/scroll` applies only that existing Y correction synchronously, then still schedules the full existing rAF reconciliation.

The immediate path does not write message scroll, request bottom, change visible height, keyboard thresholds, safe-area formulas or composer sizing.

## Release metadata

Build identifiers now support multi-part dotted values such as `178.28.1` in version metadata, cache-busting, settings labels, presentation bridge and safe updater verification.

## Regression

`npm run test:178:header-keyboard` checks the immediate correction path statically and in synthetic mobile Chromium by emulating a transient WebKit appRoot pan and dispatching a visualViewport scroll event. The correction must be visible synchronously while message scroll and visible-height remain unchanged.

Physical iOS confirmation remains the final check for the visual jump itself.
