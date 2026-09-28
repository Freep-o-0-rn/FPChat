# Follow-up plan item 17 — split send/reaction state, DOM and frame-opportunity metrics

Date: 2026-09-28

Status: **complete — measurement semantics corrected; runtime unchanged**.

## Scope

This is follow-up item **17** from `docs/performance-next-steps-prompts.md`.

Only the benchmark/measurement stand was changed.

No application runtime, manager, renderer, transport, queue, RoomContext, lifecycle owner or passive runtime observer was changed.

Item 18 was not started.

## Why the old Step 4 metrics were ambiguous

### Reaction

Historical Step 4 measured:

- `reactionOptimisticMs`: immediate `FPReactionManager188.get()` projection;
- `reactionAckMs`: mutation promise completion **plus two nested `requestAnimationFrame` callbacks**.

It did not verify that the target reaction pill had actually reached the expected DOM state.

Therefore historical `reactionAckMs` mixed network/manager confirmation with later browser frame callbacks.

### Send

Historical Step 4 measured:

- `sendOptimisticMs`: first matching outgoing row found in the DOM;
- `sendAckMs`: that row receiving a numeric server message ID.

It did not separately measure canonical `FPMessageStore172` optimistic state.

Two throttled send attempts timed out and were already preserved as null/failure in the historical baseline.

## New metric contract

All new metrics have new names. Historical Step 4 fields are preserved unchanged.

### Send

Action path:

`sendForm.requestSubmit -> FPSendManager177 -> FPTextSend170`

`FPSendManager177` is intentionally a stateless dispatcher, so the state-owner metric is taken from the existing canonical message manager:

`FPMessageStore172`.

New events:

1. **managerStateMs**
   - `FPMessageStore172` contains the optimistic record for the unique outgoing text.
2. **domChangeMs**
   - the matching outgoing `.bubble-wrap.msg` with the unique message text is observed inside `#messages`.
3. **rafOpportunityMs**
   - first `requestAnimationFrame` callback scheduled only after that matching DOM state has been observed.
4. **ackMs**
   - the matching DOM row receives a positive numeric server message ID.
5. **actualResultVerified**
   - the canonical store resolves the same text to the same numeric server ID.

A successful sample requires all five conditions.

### Reaction

The reaction entry remains:

`FPReactionManager188.toggleReaction()`

This preserves the same action entry used by historical Step 4.

New events:

1. **managerStateMs**
   - `FPReactionManager188.get()` optimistic projection contains the user's `heart` reaction.
2. **domChangeMs**
   - the target message contains `.fp-reaction-pill188[data-reaction-id="heart"]` with `aria-pressed="true"`.
3. **rafOpportunityMs**
   - first `requestAnimationFrame` callback scheduled after that exact pill state is observed.
4. **ackMs**
   - the mutation promise resolves.
5. **actualResultVerified**
   - after resolution, both canonical manager state and the target pill still represent the user's heart reaction.

After each sample, the heart reaction is removed outside the measured interval and both manager/DOM cleanup are verified before the next sample.

## requestAnimationFrame terminology

`rafOpportunityMs` means only:

**the nearest browser requestAnimationFrame callback opportunity after the required DOM state was observed.**

It is **not**:

- hardware display time;
- compositor presentation time;
- physical pixel visibility time;
- a guaranteed paint timestamp.

The stand never labels it as hardware paint/presentation.

## Failure accounting

Every requested sample remains in raw output.

For each action/profile:

- attempts are counted independently of success;
- unsuccessful samples keep `success=false`;
- the first failed stage is recorded;
- stages that did not happen remain `null`;
- no missing result is converted to `0 ms`.

The summary separately reports attempts, successes, failure categories and success rate.

## Historical Step 4 baseline — preserved unchanged

### Send

| Profile | Historical optimistic | Historical ACK | Successful attempts |
| --- | ---: | ---: | ---: |
| Normal | median **12.5 ms** | median **14.4 ms** | 5/5 |
| Throttled | median **10.7 ms** over 3 values | median **31.0 ms** over 3 values | 3/5 |

Historical throttled failures:

- `optimistic-timeout`: **2**.

Raw historical values remain embedded in the item-17 result and continue to exist in `docs/performance-step4-summary.json`.

### Reaction

| Profile | Historical optimistic | Historical mixed ACK+2×rAF |
| --- | ---: | ---: |
| Normal | median **2.3 ms** | median **38.5 ms** |
| Throttled | median **3.5 ms** | median **232.4 ms** |

These are not renamed to the new metrics.

## New results

Five attempts per action/profile.

### Send — normal

- attempts: **5**;
- successes: **5**;
- failures: **0**;
- actual result verified: **5/5**.

| Metric | Median | Range |
| --- | ---: | ---: |
| Manager state | **0.8 ms** | 0.7–3.1 |
| DOM change observed | **2.6 ms** | 2.4–7.1 |
| rAF opportunity | **13.0 ms** | 12.1–13.8 |
| Server ACK / numeric ID | **5.1 ms** | 4.9–8.9 |

The ACK can occur before the next rAF callback. That does not imply the frame was physically displayed before or after the ACK; the two observations have different semantics.

### Send — throttled

- attempts: **5**;
- successes: **5**;
- failures: **0**;
- actual result verified: **5/5**.

| Metric | Median | Range |
| --- | ---: | ---: |
| Manager state | **0.6 ms** | 0.6–3.0 |
| DOM change observed | **1.9 ms** | 1.7–6.4 |
| rAF opportunity | **4.0 ms** | 2.3–12.8 |
| Server ACK / numeric ID | **33.2 ms** | 21.0–46.2 |

The two historical throttled send timeouts did **not** reproduce in this item-17 run: current result is 5/5 successful attempts.

That is a factual run result, not proof that the old timeout class can never recur.

### Reaction — normal

- attempts: **5**;
- successes: **5**;
- failures: **0**;
- actual result verified: **5/5**;
- cleanup verified: **5/5**.

| Metric | Median | Range |
| --- | ---: | ---: |
| Manager optimistic state | **0.7 ms** | 0.6–2.7 |
| Target reaction-pill DOM | **0.7 ms** | 0.6–2.8 |
| rAF opportunity | **10.9 ms** | 5.6–12.2 |
| Mutation ACK | **4.1 ms** | 3.8–9.0 |

### Reaction — throttled

- attempts: **5**;
- successes: **5**;
- failures: **0**;
- actual result verified: **5/5**;
- cleanup verified: **5/5**.

| Metric | Median | Range |
| --- | ---: | ---: |
| Manager optimistic state | **1.0 ms** | 0.8–2.7 |
| Target reaction-pill DOM | **1.0 ms** | 0.8–2.7 |
| rAF opportunity | **1.7 ms** | 1.3–7.7 |
| Mutation ACK | **214.3 ms** | 211.8–226.7 |

## Interpretation limits

The new ACK values must not be presented as a direct speedup over historical ACK values.

For reaction especially, historical `ackMs` intentionally waited for two additional rAF callbacks, while new `ackMs` ends when the mutation promise resolves.

The new stand exists to separate those events rather than collapse them into one number.

Likewise, `domChangeMs` records when the required DOM state is observed by the stand; it is not a hardware presentation timestamp.

The unusually short throttled rAF opportunities are valid browser callback observations from this headless run, but do not imply a 1–2 ms physical display refresh.

## Network conditions

The same Step 4 profile definitions are retained:

Normal:

- no added latency/bandwidth shaping.

Throttled:

- CDP `Network.emulateNetworkConditions`;
- latency: 200 ms;
- download: 125000 B/s (~1 Mbit/s);
- upload: 62500 B/s (~0.5 Mbit/s);
- `cellular3g`.

Item 17 does not re-validate WebSocket realism; item 16 separately documents reconnect/profile limitations.

## Owners and boundaries

Unchanged:

- `FPSendManager177` — stateless send dispatcher;
- `FPTextSend170` — text submit owner;
- `FPMessageStore172` — canonical message state owner;
- existing pending text send/ACK path in `app.js`;
- `FPReactionManager188` — reaction state owner;
- `FPReactionRenderer188` — reaction DOM worker;
- `FPReactionArbiter188` — mutation serialization;
- `FPRoomContext170` / generation / AbortSignal;
- `FPRuntime169` — passive only.

No new manager, queue, observer owner, retry path or persistent state was added.

The benchmark's MutationObserver/event listeners exist only inside the isolated stand and are removed after each sample.

## Verification

GitHub Actions run:

`36449713023` — **SUCCESS**

Measured runtime:

`2bf734e918dfb7e31d14d574d52a7d3256076000`

Measurement head:

`2a284059e3823ff0f8cdb26055bf37d39c2480cf`

Build:

**190.2**

Passed:

- benchmark syntax;
- `test:177:send-manager`;
- `test:178:message-render-owner`;
- `regression1884-reaction-interaction.cjs`;
- `bench:next:17`.

Artifact:

- id: `10981923302`;
- digest: `sha256:e518db1d9db13b68546839f01c5fc93e0d2574200b7abc35ea21ac6235f6cca6`.

Browser page errors:

**0**.

## Files

Measurement:

- `scripts/benchmark-next17-send-reaction.cjs`;
- `package.json`.

Documentation:

- this report;
- `docs/performance-next17-send-reaction-summary.json`;
- `docs/performance-progress.md`.

The temporary item-17 workflow is removed after preserving the result.

No `public/*`, `server.js`, database/schema, Service Worker or updater file is changed.

## Limits

- Chromium/Linux CI only;
- no physical iPhone/Android/PWA display timing;
- five attempts per action/profile, so no p95;
- rAF is a browser frame callback opportunity, not physical presentation;
- direct historical/new latency comparisons are limited by changed metric boundaries and the fact that these are different benchmark runs.

## Rollback

Remove the item-17 benchmark, its npm script and item-17 documentation.

No runtime rollback, data migration, cache clear or identity reset is required.

## Continuation

Item 17 is complete.

**Do not start item 18 automatically.**
