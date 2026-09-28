# Follow-up plan item 9 — static JS/CSS compression

Date: 2026-09-28

## Result

Item 9 is complete.

The accessible localhost stand had no static compression before this item.

A single compression mechanism was added in the existing Node server, limited to static JS/CSS responses.

Production/Cloudflare configuration was not changed.

## Preflight

Raw requests were sent with:

- `Accept-Encoding: br, gzip`;
- `Accept-Encoding: gzip`;
- `Accept-Encoding: identity`.

Before the change, both app.js and styles.css returned:

- no `Content-Encoding`;
- no `Vary: Accept-Encoding`;
- full uncompressed bodies.

Examples:

### app.js

Identity/raw body:

`203445 B`

The same 203445 B was transferred even when the client advertised Brotli/gzip.

### styles.css

Identity/raw body:

`22435 B`

Again, the same full body was transferred for Brotli/gzip-capable clients.

Browser cold-start before compression:

| Profile | Startup | JS/CSS encoded transfer |
| --- | ---: | ---: |
| normal | 394 ms | 1,267,065 B |
| slow | 11,481 ms | 1,158,897 B |

Slow profile:

- 200 ms latency;
- ~1 Mbit/s download;
- ~0.5 Mbit/s upload.

On slow baseline app.js alone:

- encoded transfer: 203797 B;
- duration: 4123 ms.

## Implementation

The server uses Node's built-in `zlib`; no compression package or new build system was added.

A single middleware wraps only eligible static responses.

Eligible:

- GET;
- `.js`;
- `.css`.

Excluded:

- `sw.js`;
- `/api/*`;
- HTML;
- `version.json`;
- non-JS/CSS resources;
- range requests.

Bodies below 1 KiB are left uncompressed.

Negotiation:

1. Brotli when accepted and not lower-priority than gzip;
2. gzip when accepted;
3. identity when compression is unsupported/rejected.

Parameters:

- Brotli quality 4;
- gzip level 6.

Compressed variants are cached in memory by exact content SHA-1 plus encoding, so repeated responses do not recompress unchanged bytes.

## HTTP negotiation

Every eligible JS/CSS response declares:

`Vary: Accept-Encoding`

Existing cache metadata remains in place:

- ETag;
- Cache-Control;
- item-8 immutable policy for revisioned app.js;
- ordinary max-age=0 behavior for other static resources.

The compression layer does not replace or broaden those cache policies.

## Raw size result

### app.js

| Encoding | Transfer |
| --- | ---: |
| identity | 203445 B |
| Brotli | **51434 B** |
| gzip | 52734 B |

Brotli reduces the app.js body by about **74.7%** relative to identity.

### styles.css

| Encoding | Transfer |
| --- | ---: |
| identity | 22435 B |
| Brotli | **5528 B** |
| gzip | 5327 B |

For this specific CSS file gzip happened to be slightly smaller than Brotli at the chosen fast Brotli quality. The browser still negotiates Brotli under the current preference rule.

The item does not tune compression levels per resource.

## Client without compression support

With:

`Accept-Encoding: identity`

the server returns:

- no `Content-Encoding`;
- exact original app.js bytes;
- `Vary: Accept-Encoding`.

With:

`br;q=0, gzip;q=0, identity;q=1`

the server also returns the exact uncompressed body.

With:

`br;q=0, gzip;q=1`

the server returns gzip.

Therefore q=0 is honored and clients without compression support remain compatible.

## Cache / validator behavior

The regression also sends a compressed app.js request with its ETag via `If-None-Match`.

The server returns HTTP 304 while retaining `Vary: Accept-Encoding`.

This preserves validator behavior across negotiated representations.

Item-8 long-lived immutable app.js caching remains active for the exact revisioned URL.

## Excluded surfaces

The regression confirms no `Content-Encoding` and no compression variance is added to:

- `/`;
- `/version.json`;
- `/sw.js`;
- `/api/__next9_missing__`.

So the item is limited to static JS/CSS delivery.

## Browser result after compression

Chromium negotiated Brotli for startup JS/CSS.

### Normal profile

Before:

- startup: 394 ms;
- JS/CSS encoded transfer: 1,267,065 B.

After:

- startup: 374 ms;
- JS/CSS encoded transfer: **375,257 B**.

Delta:

- transfer: **-891,808 B (-70.38%)**;
- startup: **-20 ms (-5.08%)** in this one run.

app.js:

- 203797 B → **51808 B**;
- 72.2 ms → **43.3 ms**.

### Slow profile

Before:

- startup: 11,481 ms;
- JS/CSS encoded transfer: 1,158,897 B.

After:

- startup: **5753 ms**;
- JS/CSS encoded transfer: **343,216 B**.

Delta:

- transfer: **-815,681 B (-70.38%)**;
- startup: **-5728 ms (-49.89%)** in this one run.

app.js:

- 203797 B → **51808 B**;
- 4123 ms → **1723.3 ms**.

That is:

- app.js transfer: about **-74.58%**;
- app.js slow duration: about **-2399.7 ms (-58.20%)**.

## Interpretation

The byte reduction is direct and repeatable from the encoded transfer measurements.

The startup-time comparison is only one run per profile and must not be treated as a stable percentile or physical-device result.

The large slow-profile improvement is plausible because the baseline transferred over 1 MB through a 1 Mbit/s cap, but this item does not claim the same percentage on production or real mobile hardware.

## Verification

Final GitHub Actions run:

`36419759923` — SUCCESS.

Passed:

- `npm run test:next:9`;
- `npm run test:next:8`;
- `npm run test:next:7`;
- `npm run test:186:startup`;
- normal compressed benchmark;
- slow compressed benchmark.

Item-9 regression confirms:

- Brotli and gzip negotiation;
- Vary: Accept-Encoding;
- preserved ETag/304 behavior;
- identity and q=0 compatibility;
- excluded HTML/version.json/sw.js/API surfaces;
- Chromium startup negotiates compressed app.js.

Final artifact:

- id `10969415405`;
- digest `sha256:8a518a4f918b272bcbd9f2bb1ce9818e9ce7dbe069e25be453f1ca327197ea8e`.

Historical preflight artifacts remain:

- normal: run `36419046699`, artifact `10967179484`;
- slow: run `36419329084`, artifact `10967254875`.

## Files changed

Runtime/server:

- `server.js`.

Regression/benchmark:

- `scripts/regression-next9-static-compression.cjs`;
- `scripts/benchmark-next9-static-compression.cjs`;
- `package.json`.

Documentation:

- `docs/performance-next9-static-compression-summary.json`;
- this report;
- `docs/performance-progress.md`.

No client manager/arbiter, Service Worker, DB/schema, updater, HTML/version cache policy or production proxy/CDN configuration was changed.

## Production limit

All measurements are from the isolated localhost application server and Chromium/Linux.

Cloudflare/reverse-proxy response transformation was not modified or measured.

## Rollback

Revert the `staticCompression190` middleware and zlib import, then remove `test:next:9` and the item-9 benchmark/docs.

No data migration is involved.

## Continuation

Item 9 is complete.

Do not automatically start item 10.
