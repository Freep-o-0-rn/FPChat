# Build 180.13 — rollback of the last runtime transfer

## Scope

Build 180.13 validates that the latest actual runtime ownership transfer can be removed and restored independently.

The latest runtime transfer is Build 180.10 commit:

```text
294cf56bd5b4eaee7e8331d9586cdded4b9fd699
Build 180.10: connect lifecycle fallback failure to startup readiness
```

That commit changes exactly one runtime file:

```text
public/room-context170.js
```

and adds exactly the missing Lifecycle170 fallback failure connection:

```js
script.onerror = () => window.FPStartup174?.fail();
```

Build 180.11 and 180.12 are audits/regression infrastructure rather than a later runtime ownership transfer, so 180.10 is the correct rollback target.

## Test-copy procedure

`scripts/regression180-last-transfer-rollback.cjs` creates a detached temporary Git worktree from the current branch HEAD.

Inside that isolated copy it performs:

1. verify that the 180.10 transfer commit exists in full history and touches only `public/room-context170.js`;
2. create a real Git revert commit for `294cf56...`;
3. compare rollback HEAD with the source HEAD and require the only changed path to be `public/room-context170.js`;
4. verify that the pre-existing success transition `script.onload = loadConnectionOwner` is still present;
5. run `regression180-init-coordination.cjs` and require it to fail specifically because the Lifecycle170 fallback no longer reports through `FPStartup174.fail()`;
6. create a second Git commit by reverting the rollback commit;
7. require the restored tree to have no file differences from the original source HEAD;
8. run the same target init-coordination scenario again and require PASS.

The production branch is never rewritten or reverted by this test. Both rollback commits exist only in the disposable worktree.

## Acceptance

180.13 passes only if:

- the transfer is independently revertible;
- rollback does not remove neighboring fixes;
- the target scenario proves that the removed line was behaviorally relevant;
- restoration returns the complete test-copy tree to the source state;
- the exact target scenario passes again after restoration.

Unknown or conflicting results are failures; there is no expected-failure allowance in 180.13.
