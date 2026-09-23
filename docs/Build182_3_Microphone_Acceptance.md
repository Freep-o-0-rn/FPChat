# Build 182.3 — microphone permission handling

Base: Build 181.9.

## Scope

Build 182 does not attempt to persist a browser permission itself. Browser/OS site permissions are outside FPChat storage and cannot be safely recreated from localStorage.

The change makes the existing MediaManager the single owner of:
- microphone permission state;
- one in-flight microphone request;
- MediaStream acquisition;
- MediaStream release.

Voice recording delegates to that owner.

## Behavior

- If permission state is `granted`, recording acquires the stream without an FPChat permission pre-dialog.
- If state is `denied`, FPChat does not issue a redundant media request and tells the user to allow microphone access in site/browser settings.
- If FPChat previously acquired the microphone successfully but a later app session reports `prompt`, FPChat shows one explanatory hint per page session before the browser prompt. The hint asks the user to choose a persistent browser option such as **Разрешить при посещении сайта** when available.
- FPChat does not keep a microphone stream alive between recordings or while the app is closed.
- local/session storage markers are diagnostic UX only; failure to access storage cannot break microphone recording.

## Physical acceptance

1. Open FPChat in a normal browser/PWA session.
2. Start a voice recording.
3. In Chrome, choose **Разрешить при посещении сайта** rather than a one-time permission.
4. Finish/cancel the recording and confirm the microphone indicator disappears.
5. Fully close and reopen FPChat.
6. Start another voice recording: the browser should not ask again if it retained a persistent site permission.
7. Repeat with a one-time permission: a later visit may prompt again; FPChat should explain why once per page session.
8. Deny microphone permission and confirm FPChat reports the denial without leaving an active recorder/stream.
9. Verify normal voice hold/lock/cancel/preview/send behavior remains unchanged.

Incognito/private browsing may intentionally discard permissions when its private session ends.
