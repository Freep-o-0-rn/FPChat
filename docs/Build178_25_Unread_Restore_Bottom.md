# Build 178.25 — unread, saved restore and bottom

Base: Build 178.24 on `build/178-development`.

178.25 is a regression/acceptance step. Runtime behavior is unchanged.

## Opening conditions

The existing opening decision remains conditional:

1. If server/client unread state has a concrete first-unread target, that target wins.
2. If there is no unread state and the saved view says `atBottom=true`, open at bottom.
3. If there is no unread state, `atBottom=false`, and the saved anchor is available, restore `anchorMessageId + anchorOffsetPx`.
4. Existing bottom fallback remains unchanged when no restore target can be used.

The first-unread formula is unchanged: its bottom is placed at the viewport bottom minus the existing 8px gap.

The saved restore formula is unchanged: the message top returns to its saved `anchorOffsetPx` relative to the message viewport.

## Bounded history and the real bottom

`isMessagesAtBottom()` intentionally returns false while `hasNewer` or `localNewer174` is true. Reaching the bottom of the currently mounted bounded DOM is therefore not treated as reaching the real conversation tail.

When there are no unread messages, the `Вниз ↓` action goes through `FPHistory174.goToUnread() -> FPScroll173.requestBottom()`.

If newer history exists outside the mounted window, `requestBottom()` delegates to `FPHistory174.jump()` before the final bottom write. The transition therefore reaches the actual newest messages rather than merely the last node of the current window.

If unread messages exist, the same control keeps its previous unread behavior and focuses/loads first unread instead of forcing the tail.

## Regression

`npm run test:178:unread-restore-bottom` adds:

- static guards for the existing unread -> saved restore/bottom opening branches;
- a browser case with first unread far from the tail;
- a browser case restoring an exact saved anchor/pixel offset;
- a bounded-history `Вниз ↓` transition proving the real tail is loaded before bottom is reported;
- a browser case with explicit saved `atBottom=true`.

No scroll priority, target, offset, smooth/auto behavior or runtime owner changes in 178.25.

Physical mobile acceptance remains deferred to the final pass.
