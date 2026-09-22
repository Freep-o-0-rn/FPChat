# Build 180.8 — accepted client startup graph

## Scope

180.8 is an audit-only step. It does not move another runtime owner and does not change Build 168 behavior.

The question for this step is narrow:

> Does the already-existing `FPStartup174` readiness boundary describe and gate the accepted client-owner startup graph well enough, or is a new `AppCoordinator` required before any further init migration?

## Actual graph on build/180-development

### 1. Owners loaded before app.js

`public/index.html` keeps the existing dependency chain:

```text
network171.js
  -> message-store172.js
    -> dom-lifecycle173.js
      -> layer-manager173.js
        -> work174.js
          -> history174.js
            -> room-context170.js
              -> lifecycle170.js
                -> app.js
```

The preload hints fetch assets early but do not execute them out of this dependency order.

By the time `app.js` finishes evaluating, the synchronous owners defined inside it already exist, including the accepted media/composer/scroll/read surfaces used by later room rendering.

### 2. Existing room-lifecycle compatibility gate

After `app.js` loads, the existing settings chain loads `room-lifecycle.js`.

`room-context170.js` deliberately waits for `fpchat:room-lifecycle-ready174` when that legacy layer has not finished yet. This preserves the existing room lifecycle wrapper instead of racing it.

### 3. Accepted post-app owner chain

After the room-lifecycle gate, `room-context170.js` continues the accepted owner chain:

```text
lifecycle170
  -> connection170
    -> sync-coordinator176
      -> room-open170
        -> send-manager177
          -> text-send170
            -> media-send170
```

`text-send170.js` is the loader for `media-send170.js`.

`media-send170.js` dispatches `fpchat:send-owners-ready174` only after `FPMediaSend170` has been installed.

### 4. Navigation gate

`public/index.html` exposes `FPStartup174.ready`.

That promise resolves successfully on `fpchat:send-owners-ready174` and resolves false through `FPStartup174.fail()` when a required owner asset fails.

The startup IIFE in `app.js` awaits this promise before service-worker registration, version/update entry handling, invite/chat route processing and initial chat-list navigation.

Therefore room/open/send ownership is established before user navigation is allowed to proceed through the normal startup path.

### 5. Visual boot compatibility layer

`boot-ready152.js` remains a visual reveal/legacy-layer readiness gate. It is not promoted to application coordination ownership in 180.8.

It may wait for late legacy UI layers and resource quiet, but it does not replace `FPStartup174` and does not reorder the owner graph above.

## Decision

For the current accepted client graph, **the existing `FPStartup174` boundary is sufficient**.

A new `AppCoordinator` is **not introduced in 180.8** because there is no demonstrated missing global startup arbitration that requires a second coordinator.

This is specifically a no-new-owner decision:

- no new application coordinator;
- no replacement of the existing loader chain;
- no rewrite of Build 168 startup behavior;
- no automatic inclusion of block snapshot polling or other unrelated optimization.

## Boundary for 180.9

180.9 is conditional.

The condition for creating an `AppCoordinator` is not met by the 180.8 audit. Therefore 180.9 must remain a documented no-op unless a later, concrete init conflict proves that `FPStartup174` cannot express the required ordering/cancellation boundary.

## Next allowed step

180.10 may inspect the remaining init transitions one by one.

It must not create a second startup owner pre-emptively. Any remaining transition should either stay with its existing owner or be connected to the already-established readiness/lifecycle boundary only when an actual bypass is demonstrated.
