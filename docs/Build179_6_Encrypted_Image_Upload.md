# Build 179.6 — encrypted image persistence wrapper

Selected type: encrypted image upload on the existing shared route `POST /api/rooms/:publicId/media/upload`.

The multipart route, payload, validation, block guard, duplicate uploadId handling, abort check, success response and client XHR progress path are unchanged.

The former persistence statements are moved verbatim into `persistEncryptedMedia179(input)`: exact encrypted buffers are written to the same `.bin` filenames, `q.createMedia.run(...)` keeps its argument order, and the committed row is re-read by publicId.

`createEncryptedUpload179` is a thin pass-through owner. It wraps only `mediaKind === 'image'`; video calls the same persistence delegate directly. The wrapper does not catch errors, copy buffers, transform return values, retry, cancel or clean up.

Acceptance: `npm run test:179:encrypted-image-upload`.

179.7 owns cancel/cleanup separately.
