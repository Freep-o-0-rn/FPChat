# Step 4 — исходный performance baseline

## Идентичность стенда

- Runtime baseline SHA: `1c1e0453416203f6c916f214dae36bd1186f0047`.
- Measurement run HEAD: `4bf9cbdea791aca730da1960ccc89ab8af88cfad`.
- Build: **190.2**.
- GitHub Actions run: `36387427449`; artifact: `10955296789` (`step4-performance-baseline`), digest `sha256:d8733c9baed9e510358bacf60c3b570538fd1ea32039f23c4d959357d4567f56`.
- Browser: Chromium 140.0.7339.16, viewport 1100×760.
- Runner: Linux x64, Node v22.23.2, 4 vCPU, AMD EPYC 7763, RAM ≈15.6 GiB.
- Server: real `server.js` on 127.0.0.1 with isolated temporary SQLite.
- Synthetic rooms: 30, ~1000 and ~10 000 messages.
- Physical iPhone/Android: **not measured**; Chromium automation is not physical-device acceptance.

## Сеть и кэш

Normal profile: no added latency or bandwidth limit in Chromium.

Throttled profile uses CDP `Network.emulateNetworkConditions`:
- latency: 200 ms;
- download: 125000 B/s ≈ 1 Mbit/s;
- upload: 62500 B/s ≈ 0.5 Mbit/s;
- connection type: `cellular3g`.

The delay/bandwidth shaping is applied inside Chromium's network stack, not at the OS/server layer. It is a reproducible laboratory profile, not an exact mobile-radio model.

The 10-second outage uses `BrowserContext.setOffline(true)` for 10000 ms, then `setOffline(false)`; the requested CDP profile is re-applied after recovery.

Local identity/site data are never cleared. Ordinary repeated passes keep browser/managed cache. Cold-media passes clear only FPStorage167 image media cache through its public API.

Each scenario uses five identical runs. p95 is intentionally not reported for n=5. If n≥20 is collected later, p95 uses nearest-rank `ceil(0.95*n)`.

Wall-clock measurements and nested stage durations are shown separately and are never summed.

## Main results

| Scenario | Normal median (range) | Throttled median (range) |
| --- | ---: | ---: |
| Startup, saved data | 289 ms (276–555) | 4973 ms (4961–4996) |
| First startup after update path | 515 ms (511–589) | 6830 ms (6813–6963) |
| Open 30 messages | 254 ms (237.6–271.7) | 1095.4 ms (1067.4–1233.2) |
| Open ~1000 messages | 304.5 ms (287.5–320.6) | 1765.3 ms (1266.7–2215.2) |
| Open ~10 000 messages | 271.5 ms (267.9–286.1) | 3097 ms (3058.6–3316.7) |
| Scroll older ~1000 | 65 ms (64.3–81.6) | 618.5 ms (589.7–910.9) |
| Scroll older ~10 000 | 80.8 ms (65–120.9) | 592 ms (584.3–981.2) |
| Reaction optimistic | 2.3 ms (2.2–4.3) | 3.5 ms (3.4–4.2) |
| Reaction ACK | 38.5 ms (37.8–72.8) | 232.4 ms (220.2–277.2) |
| Send optimistic, successful runs | 12.5 ms (9.4–26) | 10.7 ms (9.9–18), n=3 |
| Send ACK, successful runs | 14.4 ms (10.6–26.1) | 31 ms (23.5–49.2), n=3 |
| Cold photo | 178 ms (172–184) | 856 ms (835–870) |
| Warm disk photo | 135 ms (131–145) | 100 ms (77–136) |
| Reconnect after 10 s offline | 104 ms (91–113) | 122 ms (113–145) |

Background/resume is unsupported in this headless Chromium run: the measured page did not enter `document.visibilityState === 'hidden'`. The result is `null`, not 0 ms.

## Room-open stage medians

| Room | Profile | key | join | history | render text | layout | wall open |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 | normal | 42.9 | 24.6 | 0 | 75.4 | 60.8 | 254 |
| 30 | throttled | 36.7 | 611.9 | 0 | 39.8 | 55.2 | 1095.4 |
| ~1000 | normal | 43.7 | 28.2 | 0 | 107.8 | 78 | 304.5 |
| ~1000 | throttled | 32.9 | 1151.9 | 0.1 | 81.8 | 52.6 | 1765.3 |
| ~10 000 | normal | 42.9 | 28.4 | 0 | 107.3 | 53.2 | 271.5 |
| ~10 000 | throttled | 36.6 | 1397.1 | 1272.3 | 121.3 | 60.6 | 3097 |

All values are milliseconds. These nested stages are diagnostic attribution and must not be added to wall-open.

## Raw five-run values

- `startupSaved.normal.totalMs`: 289, 276, 290, 281, 555
- `startupSaved.throttled.totalMs`: 4973, 4961, 4962, 4996, 4979
- `startupAfterUpdate.normal.totalMs`: 512, 515, 577, 511, 589
- `startupAfterUpdate.throttled.totalMs`: 6825, 6963, 6830, 6813, 6830
- `open.small.normal.openMs`: 255.3, 237.8, 254, 271.7, 237.6
- `open.small.throttled.openMs`: 1233.2, 1095.4, 1077.6, 1067.4, 1216.3
- `open.medium.normal.openMs`: 287.5, 303.7, 319.3, 304.5, 320.6
- `open.medium.throttled.openMs`: 1266.7, 2215.2, 2016.7, 1765.3, 1367.3
- `open.large.normal.openMs`: 267.9, 286.1, 286, 271.5, 269.8
- `open.large.throttled.openMs`: 3316.7, 3058.6, 3097, 3064.7, 3165.7
- `scrollOlder.medium.normal.scrollLoadMs`: 72.4, 81.6, 65, 64.3, 64.4
- `scrollOlder.medium.throttled.scrollLoadMs`: 910.9, 618.5, 646.8, 607, 589.7
- `scrollOlder.large.normal.scrollLoadMs`: 87.7, 120.9, 65, 70.9, 80.8
- `scrollOlder.large.throttled.scrollLoadMs`: 981.2, 609.1, 584.3, 585.9, 592
- `reaction.normal.optimisticMs`: 4.3, 2.3, 2.3, 2.2, 3.5
- `reaction.normal.ackMs`: 38.5, 37.8, 39.7, 38.1, 72.8
- `reaction.throttled.optimisticMs`: 4.2, 3.5, 3.4, 3.5, 3.5
- `reaction.throttled.ackMs`: 277.2, 232.4, 226.4, 220.2, 246
- `send.normal.optimisticMs`: 26, 14.4, 12.5, 10.6, 9.4
- `send.normal.ackMs`: 26.1, 14.4, 12.6, 10.6, 21.3
- `send.throttled.optimisticMs`: 18, null, 10.7, null, 9.9
- `send.throttled.ackMs`: 49.2, null, 23.5, null, 31
- `photoCold.normal.openMs`: 174, 184, 172, 183, 178
- `photoCold.throttled.openMs`: 847, 860, 870, 835, 856
- `photoWarm.normal.openMs`: 134, 131, 145, 135, 143
- `photoWarm.throttled.openMs`: 118, 136, 100, 77, 91
- `outage.normal.reconnectMs`: 104, 103, 91, 111, 113
- `outage.throttled.reconnectMs`: 117, 145, 113, 123, 122

## Three confirmed latency sources

1. **Startup asset/update path on slow network.** Saved-data startup rises from 289 ms median to 4973 ms; the update path rises from 515 ms to 6830 ms.
2. **Room join/history on slow network.** For ~1000 messages the room-open median is 1765.3 ms with join at 1151.9 ms. For ~10 000 it is 3097 ms with join at 1397.1 ms and history at 1272.3 ms.
3. **Cold media transfer.** The same photo is 856 ms median cold versus 100 ms warm-disk under throttling. A representative cold trace has queue ≈0 ms, cache ≈10 ms, decrypt ≈3 ms and `responseAfterAdmission` ≈378 ms. This does not point to media-slot wait or decryption as the dominant delay.

## Additional baseline functional finding

Under the throttled profile, text send succeeded in 3/5 runs. Two runs produced no optimistic row within 10 seconds even though the socket remained open. Those samples are recorded as `optimistic-timeout`; their latency is `null`, not 0.

This is a **pre-existing Step 4 baseline finding** in the `FPTextSend170` send flow. Step 4 does not claim its root cause. It is not a regression caused by future optimization.

## Loading exports

The successful CI artifact contains the real `FPRuntime169.loading` exports:

- `loading-open-medium-normal.json`
- `loading-photo-cold-normal.json`
- `loading-photo-warm-normal.json`
- `loading-open-medium-throttled.json`
- `loading-photo-cold-throttled.json`
- `loading-photo-warm-throttled.json`
- `step4-summary.json`

All loading exports report Build 190.2. Fixture room/device/secret values were checked not to appear in those loading JSON files.

The raw v8 measurements are authoritative. After the run, the benchmark aggregator was corrected so `null`/unsupported values cannot be converted into numeric zero; no runtime rerun was required because this affected only derived summary aggregation.

## Limits

- No physical iPhone/Android measurements.
- Background/resume remains unsupported in headless Chromium and is not treated as 0 ms.
- `visible-frame` and `paint-opportunity` are frame opportunities, not hardware-paint timestamps.
- Media `networkMs` is unsupported/null in this report; attribution uses the existing `responseAfterAdmission` stage.
- The 100 ms interaction and 600 ms repeated-open values are optimization targets only, not achieved weak-Android results.
