# Build 178.3 — reply dependency unload/return audit

Base: Build 178.2 on `build/178-development`.

This step does not redesign reply rendering or history. It audits the existing boundary between `FPMessageStore172`, bounded history DOM, and the existing reply preview refresh path.

## Result

No runtime bypass was found for this step, so runtime files are not changed.

### Source eviction

`FPHistory174.dispose(node)` evicts only the DOM node and its Blob URLs. It does not call MessageStore deletion, does not clear `messageCache`, and does not remove reply dependencies. Therefore unloading a source from the bounded DOM is not equivalent to deleting the canonical source.

### Source return

When history returns a message, `FPHistory174.render()` checks `FPMessageStore172.get(roomId, message.id)` before decrypt/render and checks the tombstone again after the asynchronous decrypt. `reconcileBeforeMount()` performs a final synchronous Store check at the mount boundary.

This preserves the existing rule: a source that became deleted while history was loading is not mounted again.

### Reply preview refresh

Reply metadata continues to resolve through:

`getMessageReplyMeta() -> FPMessageStore172.resolveReply()`.

The existing `fpchat:message-store172-changed` listener still calls `refreshReplyBlocks(box)` and refreshes the composer reply metadata. No second reply-preview mechanism is introduced.

The Store event includes `dependentMessageIds` for a changed source; the current UI still uses its previous broad `refreshReplyBlocks()` behavior.

## Regression

`npm run test:178:reply-dependencies`

It verifies:

- reply dependency exists even while the source is not mounted/loaded;
- source returning from history resolves the same dependency;
- source edit keeps canonical identity and updates reply preview through Store;
- source change events still expose dependent reply IDs;
- delete becomes a tombstone;
- stale history cannot resurrect deleted source content or preview;
- history DOM eviction contains no Store/message-cache deletion path.

No merge ranks, tombstone rules, history queue, render template, or reply UI behavior are changed in 178.3.
