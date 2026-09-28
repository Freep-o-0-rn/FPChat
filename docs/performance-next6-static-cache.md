# Follow-up plan item 6 — repeated JS/CSS cache behavior

Date: 2026-09-28

## Scope

This executes only item 6 of `docs/performance-next-steps-prompts.md`.

No runtime or production configuration was changed.

Measured runtime HEAD before adding the benchmark harness:

`b75d01761706280cfc1e04d253739d32160c2ad2`

Build: **190.2**.

Successful benchmark:

- GitHub Actions run `36414543629`;
- artifact `10965878305`;
- digest `sha256:0410f672ad0ea0228a86ae24a827f98640903ed619b1487156dee59405d4f447`.

This is an isolated localhost Chromium/Linux stand. It does not establish production/CDN cache policy.

## Method

For each profile a browser context was first primed so ordinary site data, localStorage, HTTP cache state and Service Worker registration existed.

Two repeat-start scenarios were then measured separately.

### Ordinary opening

The priming page was closed and a new page was opened in the **same browser context**.

This models reopening the app/page without clearing site data.

### Reload

After the ordinary opening finished, the same page was explicitly reloaded with `page.reload()`.

Site data/cache remained intact.

### Network profiles

- normal: no artificial latency/bandwidth limit;
- slow: 200 ms latency, ~1 Mbit/s down, ~0.5 Mbit/s up.

The slow profile was applied to both page and active Service Worker targets, consistent with the correction from item 3.1.

For JS/CSS the benchmark records:

- response `Cache-Control`;
- `ETag`;
- request `If-None-Match` / `If-Modified-Since`;
- logical browser status;
- actual network status from CDP ExtraInfo;
- encoded transfer bytes;
- `fromDiskCache`;
- `requestServedFromCache`;
- Service Worker/prefetch flags.

This matters because Chromium can expose a logical 200 to the page while the underlying validation request is an HTTP 304.

## Aggregate result

| Scenario | JS/CSS requests | Encoded transfer | Actual 304 | Conditional requests | Disk-cache | Served-from-cache |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal ordinary open | 81 | 21.0 KiB | 81 | 72 | 0 | 0 |
| normal reload | 81 | 21.0 KiB | 80 | 70 | 0 | 0 |
| slow ordinary open | 76 | 19.5 KiB | 75 | 66 | 0 | 0 |
| slow reload | 77 | 19.5 KiB | 75 | 61 | 0 | 0 |

Observed response policy for these localhost static resources:

`Cache-Control: public, max-age=0`

All observed validated resources carried an `ETag`.

The dominant repeat behavior on this stand is therefore:

`cached representation + conditional network revalidation`

rather than an unconditional full body download.

No request in these measured JS/CSS traces was explicitly marked:

- `fromDiskCache=true`;
- `requestServedFromCache=true`.

That does not prove that no browser-internal cache storage exists. It only describes the path Chromium exposed for these navigations.

## Logical 200 vs actual 304

For repeatedly loaded JS/CSS, CDP commonly reported:

- logical response status: 200;
- actual network status from `responseReceivedExtraInfo`: **304**;
- request `If-None-Match` equal to the response ETag;
- only a few hundred encoded bytes transferred.

Example for `app.js`:

`If-None-Match: W/"31ab5-1a0e7b9ecd6"`

and response ETag:

`W/"31ab5-1a0e7b9ecd6"`

with actual network status 304.

Therefore the repeated startup is not re-downloading the full `app.js` body in this localhost scenario, but it still pays for network validation.

## Ordinary open vs reload

### Normal

- ordinary open wall: 370 ms;
- reload wall: 335 ms.

Both paths performed essentially the same validator-heavy JS/CSS pattern.

### Slow

- ordinary open wall: 4141 ms;
- reload wall: 4135 ms.

Again, both paths showed the same overall cache-validation behavior.

There is no evidence here that an explicit reload uniquely causes the repeated JS/CSS checks. They also occur on an ordinary reopen in the same browser context.

## Selected resource: app.js

One resource was selected for the requested deeper check:

`/app.js?v=190.2`

Reason:

- it is a required executable startup resource;
- app execution cannot proceed without it;
- its repeat revalidation is substantial under the slow profile;
- unlike a merely parallel feature file, its readiness is directly on the main application startup path.

Measured values:

| Scenario | Duration | Browser status | Actual network status | Transfer |
| --- | ---: | ---: | ---: | ---: |
| normal ordinary open | 47.4 ms | 200 | 304 | 267 B |
| normal reload | 42.3 ms | 200 | 304 | 267 B |
| slow ordinary open | **864.1 ms** | 200 | 304 | 267 B |
| slow reload | **867.8 ms** | 200 | 304 | 267 B |

For all four:

- `Cache-Control: public, max-age=0`;
- same weak ETag;
- matching `If-None-Match`;
- `fromDiskCache=false`;
- `requestServedFromCache=false`.

The ~864–868 ms value is not transfer time for the full app body; only 267 encoded bytes were transferred. It is the repeated conditional network-validation path under the constrained stand, including queuing/connection scheduling in the startup request set.

Other files were numerically slower in the same trace, for example `room-lifecycle.js` at roughly 1.03 s. `app.js` was selected instead because its role as a required executable startup resource makes the relationship to startup unambiguous.

This item does not claim that the full ~868 ms would disappear from end-to-end wall time if caching policy changed; many startup requests overlap.

## Does the URL change when app.js content changes?

No, not automatically.

This was checked using the real item-4 source change.

Before item 4:

- ref: `63664e5c013cfb44bda7f179b383a6460fd595d2`;
- `public/app.js` Git blob SHA:
  `80b9a3952322f27a15cda9292c5ba2e7ff2840e3`;
- `version.json` build: `190.2`.

Current:

- `public/app.js` Git blob SHA:
  `c6cb6b3d58e5423d11d628882c00564df7b73d21`;
- `version.json` build: still `190.2`.

So the file content definitely changed.

The loader expression before and after is the same:

`script.src = /app.js + buildSuffix`

and `buildSuffix` is derived from `version.json.build`.

Because the build remained `190.2`, the requested URL before and after the content change is still:

`/app.js?v=190.2`

Therefore this URL scheme is **build-versioned, not content-addressed**.

A file-content change by itself does not change the URL. The URL changes only when the build value used by the loader changes.

On this localhost stand, `max-age=0` plus ETag validation allowed the browser to detect changed content despite an unchanged URL. No conclusion is drawn about what a production CDN/browser cache would do with different response policy.

## Localhost server observation

The local server uses its ordinary static-file middleware and the actual measured response headers above.

This report intentionally does **not** translate those localhost headers into assumptions about:

- Cloudflare behavior;
- reverse-proxy overrides;
- production browser cache lifetime;
- CDN revalidation policy;
- immutable asset caching.

Those require direct production-header measurement in a separate task.

## Conclusion

Item 6 confirms three points.

1. Repeated JS/CSS startup on the isolated localhost stand performs widespread conditional revalidation rather than using an explicitly reported disk-cache hit.
2. `app.js` alone spends about 864–868 ms in this validation path on the slow stand while transferring only ~267 bytes.
3. `app.js` content changed during this performance series while its URL remained `/app.js?v=190.2`; resource URLs are not content-hashed.

No code/cache policy was changed in item 6.

## Files

Added:

- `scripts/benchmark-next6-static-cache.cjs`;
- `docs/performance-next6-static-cache-summary.json`;
- this report.

The full raw request trace is stored in CI artifact `10965878305`.

## Continuation

Item 6 is complete.

Do not automatically start item 7.
