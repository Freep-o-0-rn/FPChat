# Follow-up plan item 8 — immutable cache for revisioned app.js

Date: 2026-09-28

## Result

Item 8 is complete.

Only the resource revisioned in item 7 receives long-lived immutable caching:

`public/app.js`

The policy is applied only when the request URL carries the exact current content revision and that revision is verified against the current app.js bytes.

## Safety invariant

The server computes the Git blob SHA of the current `public/app.js` and reads `version.json.appRevision` at startup.

Long-lived caching is enabled only when:

1. `appRevision` is a valid 40-hex Git blob SHA;
2. it exactly matches the current app.js bytes;
3. the request is for `/app.js`;
4. the request query `r=` exactly matches that verified revision.

The immutable response is therefore:

`Cache-Control: public, max-age=31536000, immutable`

for:

`/app.js?v=190.2&r=c6cb6b3d58e5423d11d628882c00564df7b73d21`

A stale content revision is not allowed to fall through to the current file. It receives:

- HTTP 410;
- `Cache-Control: no-store`.

This prevents new bytes from ever being served under an old immutable URL.

If app.js is requested without `r=`, the route falls through to the existing ordinary static-file policy. A build number alone is therefore not treated as immutable.

If the server cannot verify the revision against the current bytes, the revisioned app.js request fails closed with HTTP 503 and `no-store`.

## Scope isolation

The immutable policy is not applied to:

- HTML;
- `version.json`;
- `sw.js`;
- API routes;
- unrevisioned app.js;
- any other JS/CSS resource.

The item-8 regression requests each excluded surface and verifies that `immutable` is absent.

## Repeat-start verification

Baseline is item 6 on the same isolated localhost Chromium/Linux family.

### Item 6 baseline

`app.js?v=190.2` used validator-based caching.

| Scenario | app.js duration | Actual network status | Encoded bytes |
| --- | ---: | ---: | ---: |
| normal ordinary open | 47.4 ms | 304 | 267 B |
| normal reload | 42.3 ms | 304 | 267 B |
| slow ordinary open | **864.1 ms** | 304 | 267 B |
| slow reload | **867.8 ms** | 304 | 267 B |

### Item 8

`app.js?v=190.2&r=<content revision>` is immutable.

| Scenario | app.js duration | Actual network status | Encoded bytes | Cache |
| --- | ---: | ---: | ---: | --- |
| normal ordinary open | **7.8 ms** | none | 0 B | disk cache |
| normal reload | **0.2 ms** | none | 0 B | disk/cache-served |
| slow ordinary open | **7.8 ms** | none | 0 B | disk cache |
| slow reload | **0.1 ms** | none | 0 B | disk/cache-served |

Measured removal of the app.js network wait:

- normal ordinary: 47.4 → 7.8 ms, **-39.6 ms**;
- normal reload: 42.3 → 0.2 ms, **-42.1 ms**;
- slow ordinary: 864.1 → 7.8 ms, **-856.3 ms**;
- slow reload: 867.8 → 0.1 ms, **-867.7 ms**.

On the dedicated repeat-launch regression Chromium reported:

- `fromDiskCache=true`;
- `networkStatus=null`;
- `encodedBytes=0`;
- Resource Timing transferSize = 0.

So the previous 304 validator round trip for the selected resource is removed on repeat launch.

## End-to-end wall time

The overall startup wall does not improve by the full app.js request duration because many other startup resources still use `max-age=0` and revalidate in parallel.

Single-run wall values:

| Scenario | Item 6 | Item 8 |
| --- | ---: | ---: |
| normal ordinary | 370 ms | 402 ms |
| normal reload | 335 ms | 353 ms |
| slow ordinary | 4141 ms | 4083 ms |
| slow reload | 4135 ms | 4268 ms |

These one-run wall differences are not attributed solely to item 8.

The confirmed result is narrower and direct: the selected app.js repeat request no longer performs the ~40 ms normal / ~860 ms slow network validation.

## Update and rollback

Item 8 re-runs the item-7 byte/URL update and rollback regression.

That test uses immutable responses for the synthetic app revisions and one browser context.

Confirmed sequence:

1. content A has revision A;
2. update to content B changes app.js URL to revision B;
3. browser executes B and fetching the B URL returns bytes hashing to revision B;
4. rollback to A changes the URL back to revision A;
5. browser executes A and fetching the A URL returns bytes hashing to revision A.

This verifies that immutable caching remains correct across update and rollback because content changes always change the URL.

The server-side item-8 contract adds the complementary guarantee:

- exact current revision URL returns current bytes with immutable caching;
- stale revision URL is rejected with 410/no-store and never receives current bytes.

## Verification

Successful GitHub Actions run:

- workflow: `36416821530`;
- artifact: `10968107003`;
- digest: `sha256:e82d81a0c3b2327a27c33cbbf2222e6f46091bce3182a3fd7657c79643e03dd2`.

Passed:

- `npm run test:next:8`;
- `npm run test:next:7`;
- `npm run test:next:4`;
- `npm run test:186:startup`;
- `npm run test:180:rollback-contract`;
- repeat static-cache benchmark.

Specific item-8 checks passed:

- only exact revisioned app.js gets long immutable caching;
- stale app revision fails closed;
- HTML/version.json/sw.js/API and unrevisioned app.js are not immutable;
- repeat launch serves revisioned app.js from browser cache without 304 validation.

## Files changed

Runtime/server:

- `server.js`.

Regression:

- `scripts/regression-next8-app-immutable-cache.cjs`;
- `package.json`.

Documentation/measurement:

- `docs/performance-next8-app-cache-summary.json`;
- this report;
- `docs/performance-progress.md`.

No Service Worker change, API cache change, HTML cache change, version.json cache change, owner/manager/arbiter change, DB/schema change or project-wide static caching change was introduced.

## Production note

The implementation is server-side application policy and is verified on the isolated local server.

This item does not claim that an upstream CDN or reverse proxy preserves these headers unchanged in production. Production behavior would require direct production-response verification in a separate step.

## Rollback

Revert the targeted `/app.js` revision-aware server route, remove `test:next:8`, and keep item-7 URL revisioning if desired.

No database or user-data migration is involved.

## Continuation

Item 8 is complete.

Do not automatically start item 9.
