# Build 188.8 — Physical Acceptance Audit

## Scope

Focused audit after real mobile/desktop acceptance of the Build 188 reaction domain.

## Fixed findings

### A1 — Desktop context capture swallowed reaction controls — HIGH

Legacy Build 187 message-context-fix.js owns a document capture-phase click guard. New quick/picker controls were outside the old menu/clone allow-list, so desktop click was stopped before reaction handlers.

Fix: keep the old owner and add only two allowed reaction targets: .fp-reaction-quick188 and .fp-reaction-picker188. Desktop quick/picker controls also get a primary-mouse pointerup path before normal click fallback.

Status: code-fixed; physical desktop recheck required.

### A2 — quickOrder:null polluted the quick strip — HIGH

Public catalog serialized missing quickOrder as null; Number(null) became 0 and non-quick reactions passed the client integer filter.

Fix: server omits absent quickOrder; client accepts only explicit 1..quickLimit and slices to quickLimit.

Status: physically confirmed on mobile.

### A3 — same-build cache preserved stale acceptance JS — HIGH

Multiple acceptance fixes stayed on build number 188.8, so ?v=188.8 alone could keep old browser assets.

Fix: reaction assets plus the narrow legacy reaction hooks in message-context-fix.js and message-actions.js use the version updatedAt revision suffix.

### A4 — lost HTTP response after server commit produced false failure — HIGH / RACE

Server can commit and broadcast reaction:update before the HTTP response reaches the sender. If that response is lost, the client previously reported failure despite authoritative WS proving the requested own-state.

Fix: transport failure with no HTTP status is reconciled from authoritative own reaction state. No retry is added.

### A5 — delete-for-self aborted an already-sent reaction — HIGH / CONTRACT

Accepted behavior says queued unsent reactions are dropped, but a running request may finish. The previous client path used destroyMessage() for both self/all deletion and aborted the running controller.

Fix: hideMessageLocal() cancels queued FIFO entries only, lets a running request settle, then releases local reaction RAM. Delete-for-all still destroys the reaction domain.

### A6 — Reaction Details could not switch tabs while loading — MEDIUM / RACE

The design required abort + generation, but the implementation ignored tab clicks while loading.

Fix: requestGeneration now advances on reset/tab switch; old AbortController is cancelled; late responses with an old generation are ignored.

### A7 — duplicate/old Details events caused false stale state — MEDIUM

Fix: non-optimistic reaction events at the same or older revision no longer mark the open Details snapshot stale.

### A8 — failed profile handoff closed Details — LOW/MEDIUM

Fix: existing profile owner is invoked first; Details closes only after a successful handoff.

### A9 — very narrow screens could clip the picker chevron — LOW/UI

Fix: <=340px quick controls and picker toggle use a compact 31px layout.

## Ownership check

No second gesture/layer/network/history/media owner was introduced. FPGesture135, FPLayer173, FPNetwork171, FPRoomContext170, FPHistory174 and FPMessageStore172 remain authoritative.

## Remaining watch items

W1: Expanded full picker can increase context-cluster height after initial positioning. The overlay remains scrollable, but verify messages near top/bottom viewport for ergonomics.

W2: Delete-for-self intentionally waits for a running reaction request. A truly hung transport can retain tiny per-message reaction state until room/network cancellation settles it.

W3: Reaction catalog is cached for the current page lifetime; deployment-time catalog changes require reload.

W4: Group load protection has regression coverage, but group UI is not implemented. Current physical acceptance should stay focused on exactly two clients.

## Desktop acceptance order

1. Right click a message and keep context open.
2. Click the chevron: full picker opens and context stays open.
3. Click a quick reaction: context closes and pill appears.
4. Reopen and select from full picker: pill appears.
5. Click an existing pill: own reaction toggles.
6. Right click an existing pill: Reaction Details opens.
