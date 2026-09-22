# Build 177 MediaManager lifecycle

## Build 168 baseline

The repository `main` branch reports `build: 168`. Build 177.22 preserves the existing photo/video preview behavior from that baseline: accepted image/video files remain in selection order, the preview UI remains the existing grid/sheet, caption stays on the preview state, reply stays in the room draft, and the existing close worker still clears the preview root and revokes the same preview ObjectURLs.

## 177.22 ownership boundary

`FPMediaManager177` owns only active preview identity and delegation of one preview open/close lifecycle.

It does not own:

- image/video validation or compression;
- thumbnail generation;
- codecs;
- ObjectURL creation/revocation policy;
- caption or reply state;
- encryption, upload, retry, cancellation or SendManager;
- voice recording or voice UI.

The open path remains:

`mediaFileInput -> openMediaPreviewFromFiles(rawFiles) -> existing validation/thumb preparation -> FPMediaManager177.open(preview, existing mount/render)`.

The close path remains:

`closeMediaPreviewModal(preview) -> FPMediaManager177.close(preview, closeMediaPreviewModalWorker177)`.

Close is preview-identity scoped. A late close for preview A is rejected after preview B has become active, so leaving room A cannot destroy a newly opened preview in room B.

ObjectURL lifetime is deliberately not redesigned here. Build 177.24 handles one resource kind at a time.


## Build 177.23 — cancel delegation

The preview cancel command is now routed through the lifecycle owner without moving the existing cleanup algorithm:

`UI / existing caller -> FPMediaSend170.cancelPreview(preview) -> FPMediaManager177.cancel(preview, cancelPreviewWorker177) -> existing cancel worker`.

`FPMediaManager177.cancel()` only selects the target preview and invokes the passed worker. It does not own encryption, AbortController/AbortSignal, pending media deletion, upload IDs, XHR, server cleanup, ObjectURL cleanup, or send state.

The existing worker still performs, in the same order:

1. mark the uncommitted preview as cancelled;
2. cancel its existing `media-send` RoomContext operation;
3. close only that exact preview through the 177.22 lifecycle owner;
4. await the existing send task;
5. delete uncommitted uploaded/pending media with the existing `deleteUploadedPendingMedia()` path.

The send worker still has its original final safety cleanup: when the operation is aborted before message commit it calls `deleteUploadedPendingMedia(items, roomId, deviceId)` again. The server endpoint is idempotent for already-cleaned pending rows.

Acceptance covers three distinct moments with one photo preview:

- cancel before encryption/send begins: no upload is started and the existing close path runs;
- cancel while `/media/upload` is in flight: the existing operation signal aborts XHR and pending cleanup is invoked with the same stable `uploadId`;
- cancel after the server has committed the pending media row but before the browser receives the upload response: the client still only knows `uploadId`, and the existing `DELETE /media/pending` cleanup removes that committed pending row.

No codec, encryption, upload, retry, SendManager, caption, reply, item ordering, ObjectURL ownership, or voice recording logic is changed in 177.23.


## Build 177.24 — one resource type: generated preview thumbnail ObjectURL

Only one resource type moves to the active lifecycle owner: a generated preview thumbnail ObjectURL where `item.thumbnailObjectUrl !== item.objectUrl`.

The source-file `item.objectUrl`, fallback alias `thumbnailObjectUrl === objectUrl`, media viewer ObjectURLs, voice preview/cache ObjectURLs, temporary decode ObjectURLs and Blob ownership remain unchanged.

`FPMediaManager177` now tracks generated preview thumbnail URLs and is the only code that revokes that resource type. Lifetime rule:

- creation remains in the existing preview worker;
- the item is registered with MediaManager after the existing thumbnail worker creates its URL;
- while the preview DOM still contains an `<img>` using that URL, it is not revoked;
- full preview close first runs the existing unmount worker and clears the DOM, then MediaManager revokes generated thumbnail URLs;
- removing one item first rerenders/unmounts that item, then MediaManager revokes only that removed item's generated thumbnail URL;
- stale room preparation and stale-send release also delegate this same generated-thumbnail cleanup to MediaManager;
- source ObjectURL cleanup stays on the old path.

This step does not touch codecs, thumbnail generation, File/Blob ownership, upload, viewer loading/saving, voice media, or the source preview ObjectURL.


## Build 177.25 — voice UI mount/unmount delegation

Only the composer voice UI lifetime is wrapped. `voice.js` remains the implementation owner.

`ensureComposer(form) -> FPMediaManager177.mountVoiceUI(form, mountComposerVoiceUi177)`.

`FPDOM173 composer:unmounted -> FPMediaManager177.unmountVoiceUI(form, unmountComposerVoiceUi177)`.

MediaManager stores only a WeakMap from the exact composer form to the mount record. A stale unmount for form A cannot affect the independently mounted voice UI in form B.

The existing `voice.js` mount worker still creates the microphone, recording bar and preview bar and binds the same handlers:

- microphone `pointerdown -> beginPressRecording()`;
- recording delete `-> stopRecording('cancel')`;
- recording stop `-> stopRecording('preview')`;
- recording send `-> stopRecording('send')`;
- preview play `-> togglePreviewPlayback()`;
- preview delete `-> clearPreview(true)`;
- preview send `-> sendPreview()`;
- preview speed and waveform seek stay in `voice.js`.

Unmount removes only those mounted voice UI nodes and the existing composer-input sync listener. It does not cancel a recording, clear a preview, stop upload, touch activity, construct MediaRecorder, touch chunks/codecs, or change room transition semantics. Existing `handleRoomChange173()` remains the owner that cancels recording/preview when room identity changes.

The Build 173 DOM lifecycle owner is used for exact composer mount/unmount events. The old MutationObserver remains only as its existing compatibility fallback; no second observer is introduced.

Acceptance executes one real recording session through press -> lock -> stop -> preview -> cancel and asserts exactly one MediaRecorder construction for that session, then unmounts room A, mounts room B and verifies exactly one mic/recording/preview UI set and stale-A isolation.


### Permanent voice-recording guard from 177.25

The Build 177 rule **do not rewrite voice recording** is executable, not only documentary.

`npm run test:177:voice-recording-guard` fingerprints the existing pre-177.25 implementations from commit `0863cc96394c4a61f618d827e64b3ee27e53ce2f` for the press/lock/cancel/stop/finalize/preview path. Build 177.25 itself is allowed to wrap only composer voice UI mount/unmount; those recording functions must remain byte-for-byte equivalent after line-ending normalization.

The guard covers:

- `beginPressRecording`;
- `lockRecording`;
- `cancelRecordingByGesture`;
- `handlePointerMove`;
- `stopRecording`;
- `finishPress`;
- `finalizeRecording`;
- `showPreview`;
- `clearPreview`;
- `togglePreviewPlayback`;
- `sendPreview`;
- `handleVisibilityLoss`.

Every later Build 177 step that runs `test:177:voice-ui-lifecycle` runs this guard first. Updating the recorded fingerprints merely to make a later refactor pass is not allowed; changing these functions requires a separate explicitly approved voice-recording task. MediaManager may delegate lifecycle ownership around voice UI, but it must not reimplement MediaRecorder creation, press/lock gestures, recording state, preview behavior, or cancel semantics.
