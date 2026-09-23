# Build 178.18 — drawer / room long press regression lock

Base: Build 178.17 on `build/178-development`.

178.18 does not introduce a new recognizer. The drawer/room-long-press pair was already migrated earlier and already has browser regression coverage in `scripts/regression175-drawer.cjs`.

## Existing arbitration

Room row:

`touchstart → FPGesture135.watchAction('room-long-press') → existing 600ms timer → lease.claim() → showRoomMenu()`.

Drawer:

`edge touchstart → direction lock 10px → FPGesture135.claimAction('navigate:drawer') → existing 70px commit threshold → openMobileMenu()`.

Once drawer navigation claims the session, `FPGesture135` cancels the pending room-long-press action before the drawer handler stops propagation. This is why a short horizontal swipe can cancel the long press even when it does not reach the 70px drawer commit threshold.

## Required matrix

The existing browser regression already checks:

- full edge drawer swipe;
- full swipe held beyond the room long-press timeout;
- short horizontal swipe;
- intentional room hold/long press;
- ordinary row tap;
- drawer button while a room long press is pending;
- touchcancel;
- multitouch;
- trailing synthetic click after cancelled swipe;
- real mouse click after cancelled touch on a hybrid device.

It also checks vertical movement/native scrolling, lifecycle blur cleanup and row eviction while a long press is pending.

## Touch → mouse

`gestureCancelled` intentionally blocks the trailing click from a cancelled touch. A real `pointerdown` with `pointerType==='mouse'` clears that touch-only cancellation so a subsequent genuine mouse click still opens the chat. The existing browser regression explicitly covers this hybrid-device behavior.

## Commands

`npm run test:178:drawer-room-gesture` first runs a static contract guard and then reuses `regression175-drawer.cjs` for the browser sequence.

Physical iOS/native edge gestures are not proven by synthetic Chromium touch events and remain a manual acceptance item.

No runtime file is changed in 178.18.
