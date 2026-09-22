# Build 178.22 — message scroll contract

Base: Build 178.21 on `build/178-development`.

178.22 is an audit/contract step. Runtime behavior is unchanged.

## Owner

`scrollCoordinator`, exported as `window.FPScroll173`, remains the active owner of programmatic `#messages.scrollTop` changes.

The existing executor methods are preserved:

- `write()` — the normal `scrollTop`/smooth-scroll writer;
- `requestBottom()` — request the current tail, delegating to `FPHistory174.jump()` first when newer history is outside the bounded DOM;
- `focus()` — reply/pin/unread focus;
- `preservePrepend()` — prepend compensation;
- `begin()` / `applyInitial()` — initial room-open positioning;
- `stop()` — end ownership for the current room view.

No new `ScrollArbiter`, numeric priority table, target formula or behavior mode is introduced in 178.22.

## Existing causes of message scroll

| Cause | Existing path | Existing conflict rule |
| --- | --- | --- |
| Room opening | `begin() -> applyInitial()` | opening is temporarily exclusive |
| First unread | `applyInitial()` | chosen before saved restore/bottom inside initial flow |
| Saved position | `restoreMessagesViewState() -> write()` | only when initial flow has no unread and `viewState.atBottom` is false |
| Bottom | `requestBottom()` / initial `write(scrollHeight)` | if `hasNewer/localNewer174`, `FPHistory174.jump()` restores the real tail first |
| Reply/pin focus | `focus()` | blocked while opening |
| Unread pill | `FPHistory174.goToUnread()` / `focus()` | mounted unread is focused; history jump is used when it is outside DOM; fallback is bottom |
| History prepend | captured anchor -> restore/write | blocked while opening; compensates the DOM height change |
| User scroll | native browser scroll | no coordinator priority is created; scroll listener records state/unread UI only |
| Keyboard bottom pin | `FPViewport173 -> FPScroll173.requestBottom()` | starts only if the user was already at bottom and is cancelled by deliberate history interaction |

## Initial conflict resolution

The current initial order is conditional, not a new numeric priority system:

1. If an unread target exists, position the first unread.
2. Otherwise, when there is no unread state:
   - if `viewState.atBottom`, go to bottom;
   - else restore `anchorMessageId + anchorOffsetPx` when the anchor is present;
   - otherwise fall back to bottom.
3. If unread state exists but no concrete unread target can be mounted, keep the existing bottom fallback.

`focus()` and prepend compensation are not allowed to take ownership during the opening phase.

## User scroll

Native user scrolling is not another programmatic priority. The rule is simpler: a user position must not be overwritten unless one of the already-existing causes above is active.

The `#messages` scroll listener continues to save view state and refresh unread/reply UI; it does not initiate a new programmatic scroll.

## Existing deferred bottom flag

`requestBottom()` during `opening` still sets `pendingBottom = true` and returns. 178.22 does not consume or reinterpret this flag.

This is intentional for compatibility: executing that deferred request after `applyInitial()` without a proven regression could incorrectly let bottom override first-unread or saved-restore behavior.

## Known compatibility fallbacks found by the audit

Two direct fallback writers still exist outside the normal owner path:

- `message-actions.js::keepViewportWhileRemoving()` falls back to direct `box.scrollTop` if the coordinator symbol is unavailable;
- `viewport-fix.js::keepBottomPinned()` falls back to direct `box.scrollTop = box.scrollHeight` if neither `FPScroll173` nor the legacy coordinator symbol is available.

They are recorded, not changed in 178.22. The first bypass is the selected candidate for 178.23; viewport/keyboard ownership remains separate and is not folded into this step.

## Regression guard

`npm run test:178:scroll-contract` statically verifies that:

- `FPScroll173` is still the exported message-scroll owner;
- initial unread/bottom/restore ordering remains unchanged;
- `requestBottom()` still delegates newer-history restoration before writing and still defers during opening;
- `focus()` and prepend compensation stay blocked during opening;
- native user scroll remains observational rather than a new programmatic writer;
- keyboard bottom pin is conditional on already being at bottom and deliberate message interaction cancels the pin.

Runtime source files are intentionally unchanged by 178.22.
