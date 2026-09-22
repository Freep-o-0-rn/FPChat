# Build 180.10 — remaining owner init transitions

## Scope

180.10 keeps the Build 168 behavior contract and the startup decisions fixed in 180.8–180.9.

No new coordinator, loader, lifecycle queue or polling mechanism is introduced. The accepted coordination surface remains:

- `fpchat:room-lifecycle-ready174` for the room-lifecycle compatibility boundary;
- the existing `onload/onerror` chain in `room-context170.js`;
- `FPStartup174.fail()` for required-owner load failure;
- `fpchat:send-owners-ready174` / `FPStartup174.ready` for completion of the required owner chain.

Business logic remains inside the existing owners.

## Owner-by-owner transition audit

| Transition | Existing success connection | Existing failure connection | 180.10 action |
| --- | --- | --- | --- |
| room-lifecycle readiness → Lifecycle170 | one `fpchat:room-lifecycle-ready174` listener with `once:true` | settings/room-lifecycle compatibility path already publishes readiness/fallback | unchanged |
| Lifecycle170 → Connection170 | `script.onload = loadConnectionOwner` when fallback script is required; installed Lifecycle170 calls the same next transition directly | **missing on the fallback-created lifecycle script** | connect only this missing error path to `FPStartup174.fail()` |
| Connection170 → SyncCoordinator176 | `onload = loadSyncCoordinator176` | `onerror = FPStartup174.fail` | unchanged |
| SyncCoordinator176 → RoomOpen170 | `onload = loadRoomOpenOwner` | `onerror = FPStartup174.fail` | unchanged |
| RoomOpen170 → SendManager177 | `onload = loadSendManager177` | `onerror = FPStartup174.fail` | unchanged |
| SendManager177 → TextSend170 | `onload = loadTextSendOwner` | `onerror = FPStartup174.fail` | unchanged |
| TextSend170 → MediaSend170 | TextSend owner appends exactly one media-owner script when needed | `onerror = FPStartup174.fail` | unchanged |
| MediaSend170 → startup ready | owner installs `FPMediaSend170`, then dispatches `fpchat:send-owners-ready174` | upstream required-owner failures already fail the same startup promise | unchanged |

## Runtime change

The only production/runtime change in 180.10 is the missing fallback failure connection:

```js
script.src = `/lifecycle170.js${suffix}`;
script.dataset.fpLifecycle170 = '1';
script.onload = loadConnectionOwner;
script.onerror = () => window.FPStartup174?.fail();
```

The success path is unchanged.

This does not move lifecycle behavior into startup coordination. It only makes the already-existing fallback loader report failure through the same API used by every following required owner.

## Single-connection rule

180.10 acceptance freezes these facts:

- one room-lifecycle readiness listener enters the late-owner chain;
- each required owner script source is created by its existing owner-loader site only;
- each transition advances to exactly one next owner;
- the final media owner emits the existing startup-ready event once;
- no second coordinator or alternate init queue exists.

## Boot behavior

The normal boot path is unchanged.

On the existing normal path, `Lifecycle170` has already been loaded before the room-lifecycle readiness event enters the late-owner chain, so no new script request is made.

The new line is used only by the existing fallback branch where `Lifecycle170` must itself be loaded by `room-context170.js`. Success still proceeds to Connection170 exactly as before. Failure now resolves the existing startup gate as failed instead of leaving that fallback without a failure connection.

## Acceptance

`npm run test:180:init-coordination` verifies the single-listener/single-transition contract, simulates the normal late-owner sequence, simulates the Lifecycle170 fallback failure, and freezes the existing TextSend → MediaSend → startup-ready completion boundary.
