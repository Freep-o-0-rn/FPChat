# Build 178.28 — keyboard and orientation regression

Base: Build 178.27 on `build/178-development`.

178.28 is the final scroll/viewport regression step. Runtime behavior is unchanged.

## Scope

Verify the existing mobile geometry contract during:

- software-keyboard opening;
- software-keyboard closing;
- portrait -> landscape orientation change;
- landscape -> portrait orientation change.

Acceptance target:

- chat header / top menu remains reachable;
- composer remains reachable;
- no new bottom gap/padding is introduced;
- user reading older messages is not dragged to latest;
- a user already at bottom remains bottom-pinned through keyboard geometry changes;
- viewport settling terminates and does not create a persistent observer loop.

## Existing mechanics preserved

`viewport-fix.js` still owns numeric mobile viewport geometry and uses a finite cancelling settle sequence.

`viewport-layout136.js` still owns keyboard state and its own finite cancelling settle sequence.

On `orientationchange`, the viewport owner resets `closedViewportHeight`, keyboard-close expectation and bottom pin before settling. The keyboard-state owner resets `baselineHeight` before settling.

The managed chat remains a vertical flex layout:

- header: `flex: 0 0 auto`;
- messages: `flex: 1 1 auto; min-height: 0; overflow-y: auto`;
- composer / closed-room bar: `flex: 0 0 auto`.

Default composer padding still includes the normal safe area. On iOS while the keyboard is open, the existing `padding-bottom: 8px !important` override prevents adding the home-indicator safe area a second time.

## Observer-loop analysis

Normal runtime uses `FPDOM173` for chat/composer mount events. Its `MutationObserver` watches only `childList + subtree`; viewport style/class updates therefore do not recursively trigger it.

`viewport-layout136.js` has an appRoot observer only for `data-pane` and `class`. Its keyboard writes target `<html>` state, not those watched appRoot properties.

Both viewport modules retain compatibility MutationObservers only in the branch where `FPDOM173` is unavailable.

Both modules clear their previous settle timers before scheduling a finite set of new timers. There is no interval or observer-driven unbounded rescheduling path in the normal owner configuration.

## Automated regression

`npm run test:178:keyboard-orientation` contains:

- static guards for finite settle sequences, orientation resets, flex geometry, safe-area rules, centralized observer scopes and loader idempotency;
- headless mobile Chromium checks that shrink/restore the viewport while the composer is focused;
- bottom-intent preservation across keyboard-like viewport changes;
- an older-history reader anchor check proving keyboard-like shrink does not steal scroll;
- portrait/landscape/portrait geometry checks;
- an `FPDOM173.observerCallbacks` stability check after all settle timers expire.

Headless Chromium does not reproduce native iOS Safari/PWA or Android IME behavior exactly. Physical acceptance is intentionally deferred until all planned changes are complete, per project acceptance strategy.

178.28 changes no runtime source file.
