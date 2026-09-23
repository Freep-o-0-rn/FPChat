# Build 183.9 — release candidate

Base: Build 182.6.

## Completed sequence

1. Existing ownership locked: FPLayer173 + FPGesture135 + swipe-fix executor.
2. Existing chat list exposed underneath the room during a back transition.
3. Interactive room drag follows the finger.
4. Cancel returns the same room without teardown.
5. Commit animates out first, then runs existing showChatsList()/leaveActiveChat().
6. Room Back button uses the same executor.
7. Android/system Back uses the same executor with the old immediate fallback.
8. Ownership/race regression and physical acceptance matrix added.
9. Obsolete microphone instruction alert removed from executable UI and locked by regression.

## iPhone PWA cache note

Build 183.9 updates version.json. Startup already fetches version.json with cache=no-store and appends the build to voice.js as a query suffix. Therefore this release requests voice.js?v=183.9, so an older Build 182.4/182.5 copy containing the long microphone instruction alert is not reused under the previous asset URL.

## Release metadata

- version: 1.0.0
- build: 183.9
- updater expected build: 183.9
