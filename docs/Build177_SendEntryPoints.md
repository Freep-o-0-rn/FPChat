# Build 177.16 — Current send entry points and operation context

Baseline: `build/177-development` at `57ef82aaff572a1036d9e1c81ba4212a426d8824`.

This step is descriptive only. It does not introduce SendManager, a submit listener, a queue, a pending store, or a new executor. The current text/media/voice owners remain active and keep their internal state.

## Ownership map

| Type | UI / entry point | Active executor | Room / operation context | Duplicate guard | Retry model | Cancel model | Identity | Activity owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Text | `#sendForm.onsubmit` installed by `FPTextSend170.bindCurrentForm()` | private `submit(event)` in `public/text-send170.js` | form is bound to active `FPRoomContext170`; executor captures `context.roomId`, `context.key`, device id; starts `beginOperation(roomId, 'text-send')` | `sendingForms: WeakSet` blocks a second concurrent executor for the same form | runtime-only `pendingTextSends`; same payload/clientMessageId is retransmitted up to 4 attempts at 1800 ms; reconnect calls `resendPendingTextMessages()`; ACK/status/echo clears the existing pending entry | stale form/context is rejected before send; operation records cancelled/failed on AbortError/error before queueing; no user cancel exists for an already queued text message | one `clientMessageId = crypto.randomUUID()` is shared by outbound payload, optimistic message and retry entry | `typing.js`: trusted input starts `typing`; submit stops it; retry does not create a second typing activity |
| Media | preview send button calls global `sendMediaFromPreview(root)`; Build 170 replaces it with guarded `sendMediaFromPreview170` | private `send(preview, context, root, operation)` in `public/media-send170.js` | requires current `FPRoomContext170`, checks `preview.roomId`, captures room/key/device, starts `beginOperation(roomId, 'media-send')`; operation signal goes to `FPNetwork171.upload` | `preview.sending / cancelled / committed` and disabled preview controls | upload failure offers existing user retry; `item.uploadId ||= ...` survives that retry; already uploaded items are skipped on another send attempt; no timed message pending queue | preview cancel calls `cancelOperation(..., 'user-cancelled')`, aborting upload signal; uncommitted uploaded pending media is deleted | per-file `uploadId`; final `message:new` has no `clientMessageId` | `typing.js` observes `/media/upload`; image/video uploads maintain per-room counters and `activity:start/stop` with heartbeat and existing stop grace |
| Voice | recording finalization with action `send`, or preview send button -> `sendPreview()` | `uploadAndSendVoice(data)` in `public/voice.js` | recording captures `rec.roomId/deviceId/form`; finalized data retains source room; executor starts `beginOperation(data.roomId, 'voice-send')`; operation signal goes to `/voice/upload` | `recordingState`, `previewState`, global `uploadInFlight`; `sendPreview()` refuses while upload is already in flight | failed direct send is retained as preview; preview send can be invoked again; no timed retry queue and no shared pending store | recording has existing cancel paths (gesture/API, lifecycle/background, room change); voice upload has an operation signal but no new shared cancel owner in this step | no `clientMessageId` in final `message:new`; upload/media id comes from server | `voice.js`: `recording_audio` during recording; `audio` during `uploadAndSendVoice`; both keep their existing heartbeat/stop timing |

## Text details

The only active text submit owner is `FPTextSend170`.

`bindCurrentForm()` binds the concrete form to the current room context and assigns `form.onsubmit = submit`. The old handler is retained only as `form.__fpLegacySubmit170` for diagnostics/rollback and is not independently assigned.

The text operation is intentionally split into two lifetimes:

1. `FPRoomContext170.beginOperation(roomId, 'text-send')` describes the initial guarded send operation.
2. After `queuePendingTextSend(outbound)`, the operation is finished with status `queued`.
3. Existing `pendingTextSends` in `app.js` owns retransmission/ACK lifetime after that point.

Therefore a future SendManager must not create another text retry queue or regenerate `clientMessageId` on retry. `pendingTextSends` is runtime-only; Build 177.16 adds no reload persistence.

## Media details

The original `sendMediaFromPreview` remains available only as `sendMediaFromPreview.__fpLegacy`. Build 170 is the active owner.

The media executor preserves preview/caption state, per-file encrypted upload, XHR progress via `FPNetwork171.upload`, stable `uploadId` inside the existing retry loop, operation AbortSignal, pending-upload cleanup, and the final WebSocket `message:new`.

There is no media `clientMessageId` and no media message retry map equivalent to `pendingTextSends`.

Current file-selection scope is image/video only. `openMediaPreviewFromFiles()` filters unsupported MIME types and the input accepts `image/*,video/*`. A generic document/file executor is not currently established by this path; 177.19 must not assume one exists.

## Voice details

Recording and encoding are not a send-dispatch concern.

The source room is captured before the executor:

`recordingState.roomId -> finalizeRecording(rec) -> data.roomId -> uploadAndSendVoice(data)`

`uploadAndSendVoice(data)` owns the existing ready-voice upload/send sequence. It uses `data.roomId`, not the currently visible room, starts `voice-send`, uploads encrypted audio, then emits the existing media `message:new`.

If direct send fails, `finalizeRecording()` calls `showPreview(data)`. A later preview-send retries through the same `uploadAndSendVoice(preview)` executor. No voice `clientMessageId`, shared retry queue, or shared pending store exists.

## Existing activity contracts

Activity is deliberately not centralized:

- text: `typing.js` owns `typing:start/stop`; only trusted input starts typing and submit stops it;
- media: `typing.js` owns photo/video activity by observing actual `/media/upload` transport; loadend/abort/error/timeout all finish the existing counter;
- voice: `voice.js` owns `recording_audio` and `audio`, including heartbeat and stop timing.

177.17+ must call existing executors without introducing a second activity lifecycle.

## 177.16 invariants for the next steps

- No `FPSendManager177` exists yet.
- No common `pendingSends`, `sendQueue`, or cross-type pending store exists.
- `pendingTextSends` remains text-only and runtime-only.
- Media keeps its preview/item/upload state.
- Voice keeps `recordingState`, `previewState`, and `uploadInFlight`.
- Text keeps its existing `clientMessageId`/ACK/reconnect semantics.
- Media and voice must not be assigned a synthetic text-style `clientMessageId` merely to fit a dispatcher.
- Operation contexts remain type-specific: `text-send`, `media-send`, `voice-send`.

## Build 177.17 dispatcher boundary

`FPSendManager177.dispatch(executor)` is intentionally stateless. It accepts one already-selected executor and returns that executor's exact synchronous value or promise. A false/null return, thrown error, or rejected promise is not converted into a fallback, retry, or second executor call.

The dispatcher owns no DOM listener, submit binding, queue, pending collection, operation context, transport, retry state, clientMessageId, media uploadId, voice state, or activity lifecycle.

At 177.17 none of the text/media/voice entry points call the dispatcher yet. The startup chain only guarantees that `FPSendManager177` is available before `FPTextSend170` is installed. Ownership transfer begins separately in 177.18.

## Build 177.18 text entry transfer

The single assigned text form entry is now:

`#sendForm.onsubmit -> FPTextSend170.dispatchSubmit(event) -> FPSendManager177.dispatch(() => submit(event))`.

`submit(event)` remains the existing `FPTextSend170` executor. Its `sendingForms` duplicate guard, captured RoomContext, encryption, one generated `clientMessageId`, optimistic message, `queuePendingTextSend`, reconnect resend, ACK/status handling and draft cleanup are unchanged.

There is no fallback call to `submit(event)` if `FPSendManager177` is unavailable or refuses the executor. Media and voice do not use SendManager at this step.

## Build 177.19 media entry transfer

The single active media preview send entry is now:

`media preview send button -> sendMediaFromPreview(root) -> dispatchMediaFromPreview170(root) -> FPSendManager177.dispatch(() => executeMediaFromPreview170(root))`.

`executeMediaFromPreview170(root)` retains the previous media entry semantics: preview duplicate/cancel/commit guards, current RoomContext validation, source room capture, `media-send` operation creation and one call to the existing private `send(preview, context, root, operation)` worker.

The worker still owns encryption, per-item stable `uploadId`, `FPNetwork171.upload`, progress, retry prompt, AbortSignal, pending-media cleanup, caption/reply handling and final stable WebSocket `message:new`.

Image, album and video share this same executor and therefore use one dispatcher adapter. They are regression-tested as separate scenarios. The current attachment input accepts only `image/*,video/*`, and `openMediaPreviewFromFiles()` skips non-image/non-video MIME types. No generic document/file send path is introduced in 177.19.

## Build 177.20 ready-voice command transfer

Only the command that sends already prepared voice data is routed through SendManager:

`finalizeRecording(rec) / sendPreview() -> dispatchReadyVoice177(data) -> FPSendManager177.dispatch(() => uploadAndSendVoice(data))`.

`uploadAndSendVoice(data)` remains the existing voice executor. Recording, MediaRecorder lifecycle, chunk collection, waveform extraction, Blob creation, preview construction, voice encryption, `/voice/upload`, operation context, activity and final WebSocket `message:new` are not moved or rewritten.

The dispatcher receives the already prepared `data` object. The executor continues to use `data.roomId` for encryption, `voice/upload`, draft handling and final message send. Therefore navigation to another room while upload is in flight cannot retarget the voice message.

There is no fallback direct call to `uploadAndSendVoice(data)` if SendManager is unavailable or refuses the executor.

## Build 177.21 second-client activity acceptance

Build 177.21 does not move activity into SendManager. The acceptance contract is observed from a second participant in the same room.

Existing timing/ownership remains:

- text: trusted input emits `typing:start`; empty input or form submit emits `typing:stop`; server also clears activity when it receives `message:send/message:new`; unexpected socket close clears server-side activity;
- media: the existing fetch/XHR wrappers emit photo/video activity only while a real `/media/upload` is active; loadend, abort, error and timeout all feed the existing `finishMediaUpload()`; the local stop grace remains 280 ms; server message commit may clear the remote state earlier;
- voice recording: `recording_audio` starts only after MediaRecorder starts and is stopped by `finalizeRecording()`, including cancel;
- ready voice send: `audio` starts inside `uploadAndSendVoice(data)` and stops in its existing `finally`, so success, cancellation/abort and upload failure converge on the same stop path. Server `message:new` can clear the successful remote state before the explicit local stop reaches it.

The second-client regression verifies the visible remote activity plus the received `typing:update` stream. Stop acceptance requires the old state to disappear promptly through the existing explicit/server stop path, not by waiting for the 7–7.5 second safety timeout.

SendManager remains activity-blind.
