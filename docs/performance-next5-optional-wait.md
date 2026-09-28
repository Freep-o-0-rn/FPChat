# Follow-up plan item 5 — optional startup dependency

Date: 2026-09-28

## Result

**No runtime optimization retained.**

Item 5 required one optional dependency that is not only theoretically blocking, but is **confirmed to delay the measured startup** from item 3/3.1.

Two candidates were investigated in order:

1. `replyVisualReady184`, explicitly requested by the item;
2. `system-ui148.js`, because it appears at the end of the measured slow `layersReady` chain.

Both can become blocking under an isolated artificial delay. Neither produced a confirmed improvement in the ordinary corrected startup measurement sufficient to retain a runtime change.

The final runtime tree is unchanged from item 4.

## 1. replyVisualReady184

### Actual corrected startup evidence

From the corrected slow saved-data trace used after item 4:

- `reply-swipe-visual184.js`: 432.2 → 643.3 ms;
- `reply-swipe-visual184.css`: 432.2 → 655.0 ms;
- `room-context170.js`: 1291.4 → 1291.7 ms;
- `lifecycle170.js`: 1291.7 → 1292.9 ms;
- real `app.js` script element: 1292.9 → 1307.5 ms.

Therefore the visual finished roughly **638 ms before app.js could start through the existing owner/dependency chain**.

It is an explicit `await`, but it was not the measured critical path in this startup.

### Causal preflight

A diagnostic fixture deliberately held only `reply-swipe-visual184.js`.

The first version of this fixture incorrectly watched the network request for `app.js`; that request is issued by an existing preload, so it does not represent app execution. That probe was discarded.

The corrected probe watches the actual `<script src="/app.js">` insertion.

Run: `36412277803`.

With the visual JS held:

- `app.js` script count before release: 0;
- enhanced visual installed before release: false;
- after release, the real app script was inserted 42 ms later.

This confirms that `replyVisualReady184` **can** gate execution if it becomes slower than the earlier dependency chain.

It does **not** prove that it delayed the ordinary item-3 startup, because in that trace it completed hundreds of milliseconds before the chain reached app.js.

A tentative removal of this wait was therefore reverted.

## 2. system-ui148.js

### Why it was investigated

In the corrected saved slow trace before item 5:

- `boot-ready152.js`: ended 3799.1 ms;
- `layers-start`: 3799.1 ms;
- `chat-request-system147.js`: ended 3991.8 ms;
- `system-ui148.js`: ended **4004.0 ms**;
- `layers-end`: **4021.8 ms**.

`boot-ready152.js` required `window.__fpSystemUi148Installed` in `layersReady()`.

The module itself is an enhancement over the already-existing system-chat owners: edge-back swipe and preview stabilization. Base system data/view ownership remains in `FPSystem144` and `chat-request-system147`.

### Causal preflight

A fixture held only `system-ui148.js` after the rest of startup was allowed to continue.

Run: `36412935331`.

After the file had been held for another 500 ms:

- `core-ready` already existed;
- `system-ui148` was not installed;
- `layers-end` was still null;
- `boot-ready` was still false.

After release:

- `layers-end`: ~826.3 ms in that isolated run;
- `boot-ready`: ~850 ms.

This proves the old readiness contract can be held by a sufficiently late `system-ui148.js`.

### Temporary one-line experiment

Only this condition was temporarily removed from `layersReady()`:

`window.__fpSystemUi148Installed`

The file still loaded through the same `gesture-manager135.js → system-ui148.js` sequence.

No other readiness dependency, owner or loader order changed.

Verification run: `36413217197` — SUCCESS.

Passed during the experiment:

- isolated item-5 delay/error/late-load regression;
- `test:186:startup`;
- `test:189:system-push`;
- `test:184:browser`;
- `test:next:4`;
- corrected startup waterfall.

The isolated regression confirmed:

- boot can complete while `system-ui148.js` is held;
- the base system-chat view works before it loads;
- late loading installs the existing enhancement correctly;
- a load error does not break the base system chat.

This establishes behavioral safety for the experiment.

## Ordinary before/after measurement

The important question was whether the change improved the same ordinary startup profile.

### Saved data

| Scenario | Before item 5 | Temporary change | Delta |
| --- | ---: | ---: | ---: |
| normal wall | 314 ms | 348 ms | +34 ms |
| slow wall | 4164 ms | 4166 ms | +2 ms |
| slow layers | 222.7 ms | 224.3 ms | +1.6 ms |

### Update

| Scenario | Before item 5 | Temporary change | Delta |
| --- | ---: | ---: | ---: |
| normal wall | 447 ms | 469 ms | +22 ms |
| slow wall | 6657 ms | 6647 ms | -10 ms |

The slow saved transfer remained 22.4 KiB. The slow update transfer remained 152.4 KiB, so unlike the item-4 comparison there was no large transfer-volume shift that could hide a large improvement.

The temporary change did **not** reduce the measured `layers` interval or end-to-end startup.

The likely reason is that `system-ui148.js` overlaps with the other late layer conditions and the existing 40 ms `waitFor()` polling. Removing only this flag does not move the readiness sample to an earlier poll in the measured run.

Therefore the experiment does not satisfy the item-5 requirement of a dependency **confirmed to be delaying the ordinary measured startup**.

The runtime change was reverted.

## Final state

Final runtime is the item-4 runtime.

A compare against item-4 HEAD `84fc1e11261bb79c6868f402cfe5036dac37f57e` shows no runtime/package difference from item 5.

Only two diagnostic scripts remain:

- `scripts/benchmark-next5-reply-visual-preflight.cjs`;
- `scripts/benchmark-next5-system-ui-preflight.cjs`.

No `public/*`, server, service worker, database, updater, owner/manager/arbiter or package-script change remains from item 5.

## Limits

- Performance comparison is still one diagnostic run per condition, not a distribution.
- Chromium/Linux only; physical iPhone/Android are not verified by this item.
- Artificial delay probes prove causal readiness edges, not real-world frequency or end-to-end benefit.
- Long individual resource duration is not sufficient evidence that a resource is the current critical path.

## Decision

Item 5 is complete with **no retained runtime change**.

The evidence is insufficient to remove an optional startup dependency under the rules of this plan.

The next plan item is not started automatically.
