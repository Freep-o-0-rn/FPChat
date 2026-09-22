# Build 178.22 — message scroll contract

Base: Build 178.21 on `build/178-development`.

178.22 is an audit/contract step. Runtime behavior is unchanged.

## Owner

`scrollCoordinator`, exported as `window.FPScroll173`, remains the active owner of normal programmatic `#messages.scrollTop` changes.

The existing executor methods are preserved:

- `write()` — the normal `scrollTop`/smooth-scroll writer;
- `requestBottom()` — request the current tail, delegating to `FPHistory174.jump()` first when newer history is outside the bounded DOM;
- `focus()` — reply/pin/unread focus;
- `preservePrepend()` — legacy prepend compensation;
- `begin()` / `applyInitial()` — initial room-open positioning;
- `stop()` — end ownership for the current room view.

No new `ScrollArbiter`, numeric priority table, target formula or behavior mode is introduced in 178.22.

## Existing causes of message scroll

| Cause | Existing path | Existing conflict rule |
| --- | --- | --- |
| Room opening | `begin() -> applyInitial()` | opening is temporarily exclusive |
| First unread during opening | `applyInitial() -> write()` | chosen before saved restore/bottom inside initial flow |
| Saved position during opening | `applyInitial() -> write()` | only when there is no unread and `viewState.atBottom === false` |
| Saved/runtime anchor restore | `restoreMessagesViewState() -> FPScroll173.write()` | refuses current-box mismatch and refuses opening |
| Bottom | `requestBottom()` / initial `write(scrollHeight)` | if `hasNewer/localNewer174`, `FPHistory174.jump()` restores the real tail first |
| New/outgoing/system event auto-bottom | existing append paths -> `requestBottom()` | uses the existing `autoScroll/nearBottom` decisions; no new 178.22 decision is added |
| Reply/pin focus | `focus()` | blocked while opening |
| Unread pill/jump | `FPHistory174.goToUnread() -> jump()/focus()/requestBottom()` | mounted unread is focused; unloaded unread is loaded first; fallback stays bottom |
| History window load: older or newer | capture visible anchor -> DOM mount -> `restoreMessagesViewState()` | anchor is captured at the mount boundary, then the same visible position is restored |
| Bounded-DOM trim | capture visible anchor -> evict offscreen nodes -> `restoreMessagesViewState()` | trimming must not steal the user's visible position |
| History window jump | replace bounded window -> `focus(anchor)` or `write(scrollHeight)` -> trim | explicit jump target wins for that operation; tail jump stays bottom |
| Message removal viewport preservation | `message-actions.js::keepViewportWhileRemoving()` | if already at bottom, remain at bottom; if removed node was above viewport, subtract exactly removed height |
| Keyboard bottom pin | `FPViewport173 -> FPScroll173.requestBottom()` | starts only if the user was already at bottom; deliberate message interaction cancels it |
| User scroll | native browser scroll | not a programmatic priority; scroll listeners observe/save state and may trigger history loading only |

## Initial conflict resolution

The current initial order is conditional, not a numeric priority system:

1. If an unread target exists, position the first unread.
2. Otherwise, when there is no unread state:
   - if `viewState.atBottom`, go to bottom;
   - else restore `anchorMessageId + anchorOffsetPx` when the anchor is present;
   - otherwise fall back to bottom.
3. If unread state exists but no concrete unread target can be mounted, keep the existing bottom fallback.

`focus()`, runtime anchor restore and history loading/compensation are not allowed to take ownership during the opening phase.

## History mutation and user scroll

History load and bounded-DOM trim are not new priorities. They preserve geometry around an existing visible anchor.

For `FPHistory174.load()`, the anchor is captured immediately before the DOM window is changed, not when the network request starts. Therefore a user scroll that happens while history is loading becomes the position that is preserved when the page is mounted.

`FPHistory174.trim()` likewise captures the currently visible anchor before eviction and restores that anchor after offscreen nodes are removed.

Native user scrolling remains browser-owned. The main `#messages` scroll listener saves view state and refreshes unread/reply UI. The history scroll listener may request older/newer data near an edge, but the later DOM mutation preserves the then-current visible anchor instead of restoring a stale pre-request position.

## Message removal preservation

Deleting a message can change scroll geometry:

- if the viewport was already at bottom, the existing behavior requests bottom again;
- if the deleted message was completely above the viewport, the existing behavior subtracts `removedHeight` from `beforeTop`;
- otherwise no compensating programmatic scroll is issued.

The target and `behavior='auto'` are unchanged in 178.22.

## Existing deferred bottom flag

`requestBottom()` during `opening` still sets `pendingBottom = true` and returns. 178.22 does not consume or reinterpret this flag.

This is intentional for compatibility: executing that deferred request after `applyInitial()` without a proven regression could incorrectly let bottom override first-unread or saved-restore behavior.

## Direct writer audit

A full audit of `public/*.js` at Build 178.22 found the normal message-scroll write in `FPScroll173.write()` plus two compatibility fallback paths that can directly write `#messages.scrollTop`:

- `message-actions.js::keepViewportWhileRemoving()`: two direct fallback assignments, for bottom and remove-above compensation, only when the legacy coordinator symbol is unavailable;
- `viewport-fix.js::keepBottomPinned()`: one direct bottom fallback only when neither `window.FPScroll173` nor the legacy coordinator symbol is available.

Other direct `scrollTop` assignments found by the repository audit belong to different scroll containers (composer textarea, system-event feeds, message-context overlay), not `#messages`.

The message-actions bypass is the selected candidate for 178.23. The viewport fallback remains for the later viewport/geometry audit and is not mixed into 178.22.

## Regression guard

`npm run test:178:scroll-contract` statically verifies:

- `FPScroll173` remains the exported message-scroll owner;
- initial unread/bottom/restore ordering is unchanged;
- `requestBottom()` still restores newer history before writing and still defers during opening;
- `focus()`, saved restore and history load/trim remain blocked from overriding opening;
- history older/newer load and bounded-DOM trim preserve the visible anchor through the existing restore path;
- history jump still uses the existing focus-or-bottom behavior;
- message removal keeps the existing bottom and remove-above formulas;
- normal append/system/block bottom paths still delegate to the existing coordinator;
- native user scroll remains observational rather than acquiring a new programmatic priority;
- keyboard bottom pin remains conditional and delegates through `FPScroll173`;
- the two known direct message-scroll fallback paths are still explicitly visible for later one-at-a-time migration.

Runtime source files are intentionally unchanged by 178.22.
