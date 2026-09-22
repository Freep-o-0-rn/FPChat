# Build 179.7 — encrypted image cleanup/cancel wrapper

Selected type remains the Build 179.6 encrypted image upload.

## Explicit cancel

The existing `DELETE /api/rooms/:publicId/media/pending` route is unchanged. It still:

1. resolves the room;
2. requires an active participant;
3. converts valid uploadIds to mediaIds only when `pending.room_id === room.id && pending.status === 'pending'`;
4. re-reads rows with `listPendingMediaByIds(room.id, ...)`;
5. cleans files;
6. performs one existing `deletePendingMediaByIds.run(room.id, ...)` batch delete;
7. returns the same `{ok:true, deleted:rows.length}` response.

Only image file cleanup is routed through `FPEncryptedUpload179.cleanup`. Video and other media use the same `cleanupPendingMediaFiles179` delegate directly.

## Interrupted upload

The existing `req.aborted || res.destroyed` check remains before persistence. Because multer is memory-backed, no server file/DB row is created by this route before that point.

## Server committed but client did not receive response

179.6 behavior remains: a retry with the same uploadId finds the pending committed row and returns it. Explicit cancel can also resolve that uploadId and remove it only inside the same room.

## Stale cleanup

The existing 24h stale-pending selector and per-row DB deletion remain unchanged. Image file cleanup is wrapped; non-image cleanup delegates directly.

## Safety

The wrapper does not choose rows and does not delete DB rows. Selection and DB deletion remain owned by existing room-scoped queries. Therefore it cannot independently delete another room's file.

Acceptance: `npm run test:179:encrypted-image-cleanup`.
