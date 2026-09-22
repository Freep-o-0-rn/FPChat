# Build 178.24 — prepend versus user scroll

Base: Build 178.23 on `build/178-development`.

178.24 is a regression/acceptance step. Runtime behavior is unchanged.

## Conflict under test

A history request may already be in flight while the user continues scrolling the currently mounted message window. When the older page finally arrives, prepend must preserve the user's newer position, not restore the position that existed when the request started.

## Existing ownership rule

`FPHistory174.load()` does not capture a visible anchor when the request starts.

The order remains:

1. fetch history page;
2. decrypt/render the returned records into detached scratch DOM;
3. reconcile the scratch records;
4. capture `getFirstVisibleMessageAnchor(box)` from the live message viewport;
5. prepend the fragment;
6. restore that captured anchor through the existing `restoreMessagesViewState()` / `FPScroll173.write()` path;
7. run bounded-DOM trim, which independently preserves the then-current visible anchor.

Therefore a user scroll performed while fetch/decrypt is pending becomes the position that is preserved at mount time.

The native scroll listener does not store a pre-request anchor. It only triggers older/newer loading near the existing thresholds.

## Media geometry

Message media reserves its geometry before the thumbnail resolves:

- `.media-tile` uses `aspect-ratio: 1/1`;
- `.media-thumb` fills the reserved tile with `width:100%; height:100%`;
- `#messages` has browser scroll anchoring disabled (`overflow-anchor:none`), so WebKit/Chromium does not run a second anchoring policy over `FPScroll173`.

This means a delayed history thumbnail should not change the height of its mounted media tile and should not move the preserved visible anchor.

## Regression

`npm run test:178:prepend-user-scroll` contains:

- a static ordering guard proving anchor capture remains after async page/render work and immediately before DOM mutation;
- a synthetic Chromium scenario that delays a real older-page response, changes the message scroll position while that response is blocked, releases the request and verifies the newly chosen visible anchor/pixel offset survives prepend;
- a second history page containing a synthetic media message whose thumbnail resolves after mount; the test verifies the media tile height and visible anchor remain stable.

No runtime code, scroll priority, target, offset or behavior is changed by 178.24.

Physical iOS/Android scroll physics remain deferred to the final device acceptance pass, as planned.
