# Build 178.10 — one FPDOM173 decorator audit

Base: Build 178.9 on build/178-development.

Scope is one decorator only: the message-selection “Выбрать” action added to .message-context-root.

## Mount owner

The normal path is:

FPDOM173 context:mounted → message-selection decorateContext(root).

FPDOM173 is loaded before app.js. message-selection.js is then loaded after app.js but before message-context.js, so the listener is installed before normal context roots are created.

## One bind per node

decorateContext(root) first searches the context menu for [data-fp-message-action="select"]. It calls createActionButton() only when that action does not already exist.

createActionButton() attaches exactly one click handler. Re-emitting mounted for the same context therefore reuses the existing button instead of adding another action or another handler.

## Unmount/release

This decorator owns no external Map/Set/WeakMap, timer, observer, subscription or retained node reference. Its only per-node resource is the button and its click listener, both owned by the context DOM subtree. Removing the context root removes the button and leaves no external reference from this decorator, so the node/listener are collectible without a separate disposer.

The module-level FPDOM173 subscription intentionally lives for the page lifetime; it is not a per-node resource.

## Fallback

The old MutationObserver remains only inside the else branch used when FPDOM173 is unavailable. It is not activated in the normal owner path. 178.10 does not remove or replace other observers.

Regression: npm run test:178:dom-decorator

No runtime file is changed in 178.10.
