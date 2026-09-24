# Build 185.1 — Photo pinch zoom

Branch: `build/185-development`.
Base: `2c11a43c2e232a411c21ed073b4fc7516fd9faa1` (Build 184.6).
Scope: photo zoom in the existing mixed photo/video gallery.

## Behavior

- Two fingers scale the active photo from 1× to 4× around their midpoint.
- Zoom remains after release. One finger pans within image bounds.
- Zoomed panning never navigates the gallery or dismisses it.
- A second finger cancels an uncommitted gallery swipe and starts pinch in
  the same gesture session. Changing the pinch pair rebases without a jump.
- Returning to 1× consumes the remainder of that touch sequence. Gallery
  swipes resume on the next new gesture; their existing thresholds remain.
- A new photo/viewer starts at 1×. Hydrating the same photo preserves zoom
  and defers DOM replacement while fingers or a committed transition are active.
- Close/navigation buttons remain usable. Video targets retain their native
  controls and bypass photo gesture capture. Video zoom and double-tap zoom
  are outside this first implementation.

## Responsible owners

| Resource | Owner / implementation |
| --- | --- |
| Active viewer identity and final cleanup delegation | `FPMediaManager177` in `app.js`; new `ownViewerCleanup(viewer, cleanup)` |
| Pointer sequence membership and exclusive action | `FPGesture135`; `viewer:interaction` through `watchAction` / `claimAction` |
| Pinch/pan/swipe recognition, scale/offset and image transform | Existing gallery controller, `media-gallery134.js` |
| Viewer layer admission and lower-layer blocking | Existing `FPLayer173` / `FPDOM173` claim, unchanged |
| App viewport geometry | Existing `FPViewport173` / `FPViewport136`, unchanged |
| Photo layout measurements | Gallery-local `ResizeObserver`, only while its photo is bound |
| Background/foreground signals | `FPLifecycle170`; gallery cancels its own interaction |
| Unexpected viewer unmount | Existing `FPDOM173` event; exact-node cleanup |
| Diagnostics | Passive owner registration in `FPRuntime`, no media identifiers |

The gallery writes zoom only on the active `img.fp-photo-zoom185`.
`track.transform` remains gallery navigation; `stage.transform/opacity` remains
dismissal. Message scroll, transport, cache, encryption and ObjectURL ownership
are unchanged. No new global manager, recognizer stack or dependency is added.

## Arbiter contract

`watchAction` accepts a fourth optional argument for viewer pointer sessions:
`{multiPointer: true, onPointerEnd}`. Existing single-pointer/touch callers keep
their prior API and behavior. A multi-pointer lease also exposes `active()`.

The arbiter tracks IDs; the gallery tracks their coordinates. The second
pointer does not restart the viewer session. Each pointer end reaches the
executor synchronously before arbiter teardown, including trusted browser
events whose microtasks may run between separate listeners. Releasing a lease
with fingers still down marks that sequence cancelled until it drains, so
closing the viewer cannot hand those fingers to the underlying chat.

The existing touch guard only suppresses compatibility/native defaults;
it does not recognize or execute another pinch gesture. Unexpected capture
loss cancels; ordinary capture loss after pointerup does not cancel twice.

## Lifecycle and rendering

- Viewer object identity and stable media ID scope all interaction state.
- One scheduled animation frame applies the latest photo transform.
- Layout is measured on photo readiness/resize, never in pointermove.
- MediaManager invokes idempotent cleanup on viewer replacement, failure or
  successful close, including alternate close workers.
- Cleanup releases pointer capture, its arbiter lease, resize observation,
  image load callback, animation frame and owned transition timer.
- Deferred renders check viewer/media identity. Late media A cannot bind to B.
- A late image load cannot cancel an already committed close/navigation;
  geometry is measured by the destination render or after cancellation.
- Background cancels active work, while static zoom can survive foreground.
- CSS reset transitions respect reduced motion and need no cleanup timers.

## Validation

Release gate: `npm run test:185` — PASS on 2026-09-24 (Node 24.19.0, Chromium 153).
The final run completed all 16 zoom groups and the cumulative Build 184 checks.

The gate combines viewer lifecycle/I/O guards, layer ownership, gesture-layer
lifecycle, drawer arbitration, the cumulative Build 184 checks and the new
photo zoom browser suite. `test:185:browser` exercises the real application
with an isolated server/database, deterministic media fixtures and native
Chromium touch dispatch as well as synthetic boundary/cancel events.

The 16 photo zoom groups cover focal scaling, real delayed gallery hydration,
2→1→0 continuity, edge clamping/no additional media reads, 1× drain, both swipe
axes, third contacts/pair replacement, max zoom/cancel, capture loss, resize,
lifecycle, stale viewer closure, repeated mount/unmount, native multitouch,
late media loading, committed-dismiss/load races, alternate manager cleanup,
and video input exclusion. Related assertions are grouped in the test output.

Only the old `mountSlot` and `navigateGallery` fingerprints were updated for
the explicitly authorized photo binding and cancellable navigation changes.
Loading, caching, save/download and legacy viewer fingerprints remain intact.
The layer-contract guard now verifies end/cancel delegation through the
arbiter instead of requiring the removed independent gallery pointercancel
listener.

Physical iPhone Safari/PWA and Android acceptance remains required. Browser
automation does not establish actual device smoothness, WebKit behavior or
native video playback/fullscreen correctness. The video fixture checks input
ownership and control properties, not successful codec playback.

## Release / rollback

`public/version.json`, presentation/settings labels and the updater gate use
Build 185.1, preserving the existing asset cache-busting path. This branch is
based on 184.6; main and the running server are not part of this release action.
Rollback is the inverse of the Build 185.1 feature commit, returning to 184.6.
