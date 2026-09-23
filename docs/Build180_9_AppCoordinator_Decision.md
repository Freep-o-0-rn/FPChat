# Build 180.9 — AppCoordinator decision

## Scope

180.9 is conditional:

> If an AppCoordinator is required, wrap exactly one existing readiness/init transition.

The 180.8 startup audit did not find a missing global startup arbitration boundary. 180.9 therefore remains a deliberate no-op.

No production/runtime file is changed by this step.

## Existing transition already covering the boundary

The accepted readiness path is already present:

```text
fpchat:room-lifecycle-ready174
  -> loadLifecycleOwner()
    -> loadConnectionOwner()
      -> loadSyncCoordinator176()
        -> loadRoomOpenOwner()
          -> loadSendManager177()
            -> loadTextSendOwner()
              -> media-send170
                -> fpchat:send-owners-ready174
                  -> FPStartup174.ready
                    -> initial route/navigation
```

This means the current startup has both boundaries needed for the accepted client-owner graph:

1. room-lifecycle readiness before late room/open/send owners are installed;
2. send-owner readiness before initial route processing is allowed to continue.

There is no demonstrated transition between those boundaries that requires another coordinator.

## Decision

`AppCoordinator` is **not introduced** in 180.9.

Specifically, 180.9 adds no:

- new script loader;
- replacement loader chain;
- lifecycle event queue;
- startup polling loop;
- timer-based readiness arbitration;
- second navigation gate;
- second owner for the existing `FPStartup174.ready` promise.

The existing `FPStartup174`, `FPLifecycle170`, `FPRoomContext170`, `FPConnection170` and late-owner chain keep their current responsibilities.

## Boot compatibility

The Build 152/153 visual boot compatibility path remains untouched:

- `FPBoot152` continues tracking dynamically appended startup resources;
- `boot-ready152.js` continues waiting for the existing core/layer readiness;
- the existing safety timeout remains unchanged;
- `fpchat:boot-ready` is still emitted by the existing boot layer.

180.9 does not add another boot completion mechanism.

## Acceptance

180.9 is accepted when:

- the complete 180.8 startup graph still passes;
- no `AppCoordinator180` or equivalent new coordinator is present;
- the existing room-lifecycle readiness transition is still the entry to the late-owner chain;
- the existing `FPStartup174.ready` remains the navigation gate;
- the existing boot-ready implementation is still present and no 180.9 loader/polling mechanism was added.

If a later step demonstrates a concrete init race outside these boundaries, that race must be documented first. Only then may a coordinator be reconsidered, and only around the single proven transition.
