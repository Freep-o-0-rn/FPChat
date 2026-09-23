# Post-179 optimization backlog — do not mix with owner migration

Status: **deferred optimization backlog**.

This backlog is intentionally separate from Build 179 ownership/composition migration. Build 179 establishes explicit owners and preserves existing behavior. The items below change internal execution characteristics and therefore require their own evidence, acceptance and rollback plan.

## Global rule

None of these items may be folded into an owner-migration commit merely because the relevant owner now exists.

For every optimization:

1. state the concrete problem and why the current implementation is insufficient;
2. capture a reproducible baseline before changing behavior;
3. define equivalence/regression criteria for existing FPChat behavior;
4. benchmark the old and proposed implementations on representative data/devices;
5. define rollback before deployment;
6. implement only one independently reviewable optimization at a time;
7. perform its dedicated acceptance;
8. keep the change only when safety and benefit are demonstrated.

If safety is not sufficiently established before Build 180, defer the item beyond 180. Do not force it into the migration sequence.

## O1 — streaming / temp-file encrypted upload

Current baseline from 179.6–179.7:

- encrypted photo/video route and multipart contract are preserved;
- multer remains memory-backed;
- encrypted image persistence has an explicit thin owner;
- cancel/cleanup ownership is separated;
- file format remains the existing encrypted `.bin` format.

Potential optimization:

- stream encrypted uploads and/or use bounded temporary files instead of holding the full multipart payload in process memory.

This changes resource and failure behavior, so it requires its own proof for:

- identical route and FormData contract;
- identical encrypted bytes and final file format;
- identical upload progress semantics;
- abort before commit;
- abort during temp/stream write;
- server commit unknown to client;
- temp-file cleanup after process/request failure;
- no cross-room/cross-upload deletion;
- bounded memory improvement under concurrent large uploads;
- rollback to the 179.6/179.7 persistence path.

Do not introduce this merely as an implementation detail of `FPEncryptedUpload179`.

## O2 — eliminate history media N+1

Current baseline from 179.8–179.9:

- one history page SELECT;
- one `listMediaByMessageId(messageId)` SELECT per returned media message;
- same prepared SQL as the pre-owner path;
- all page/hydration reads now share one explicit read transaction.

Potential optimization:

- eliminate or reduce the per-message media hydration N+1.

Required evidence:

- benchmark current query count and latency on representative history sizes/media density;
- prove identical message ordering;
- prove identical media ordering by `file_order ASC, id ASC`;
- preserve empty `media: []` for non-media/no-media cases;
- preserve reply/unread/history cursor semantics;
- compare query plan and result equivalence;
- define rollback to the 179.9 owner using existing prepared statements.

Do not combine N+1 removal with an unrelated schema/index change in the same acceptance unit.

## O3 — batch queries

Potential optimization:

- introduce a batch read for media/message dependencies only after O2 has a measured reason and a precise result-equivalence contract.

A batch query changes result assembly and parameterization. It therefore needs separate validation for:

- room isolation;
- message-id ownership;
- stable media ordering inside each message;
- duplicate/missing IDs;
- large parameter sets / SQLite variable limits;
- bounded chunking if required;
- same serialized API response;
- benchmark against the current N+1 baseline.

A batch query is not automatically approved merely because it reduces SQL statement count.

## O4 — indexes after EXPLAIN QUERY PLAN

179.8 deliberately did not add history/media indexes.

Potential index work may be considered only after collecting `EXPLAIN QUERY PLAN` and representative timing data from the real hot path.

Candidate areas may include history pagination and media-by-message lookup, but no index is pre-approved by this backlog.

For each proposed index:

- record the current query plan;
- record representative table cardinality;
- show the target query and actual bottleneck;
- record before/after timing;
- measure write/storage cost where relevant;
- verify existing unique/partial index semantics are unaffected;
- make the schema change independently reversible.

Do not add speculative indexes based only on expected SQL patterns.

## Sequencing

Recommended dependency order when evidence justifies the work:

```text
owner migration accepted
        ↓
baseline / benchmark
        ↓
O1 upload resource optimization          [independent]
or
O2 history N+1 investigation
        ↓
O3 batch-query implementation            [only if justified]
        ↓
O4 index change after EXPLAIN evidence   [only if justified]
```

O1 is independent of the history DB work.

O2/O3/O4 should not be bundled automatically. Query-shape changes and schema/index changes need distinct acceptance so regressions can be attributed and rolled back independently.

## Build boundary

Build 179 ends with the preserved-owner architecture. This document does not authorize any optimization implementation.

Before Build 180, an optimization may proceed only if its safety case, benchmark/equivalence criteria and rollback are already concrete. Otherwise it is carried forward as backlog beyond 180.
