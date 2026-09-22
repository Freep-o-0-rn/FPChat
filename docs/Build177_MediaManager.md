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
