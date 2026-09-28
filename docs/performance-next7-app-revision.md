# Follow-up plan item 7 — app.js content revision

Date: 2026-09-28

## Result

Item 7 is complete.

Selected resource from item 6: `public/app.js`.

A minimal app-specific content revision was added. The rest of the project keeps the existing build URL scheme.

## Revision source

`public/version.json` now includes:

`appRevision: c6cb6b3d58e5423d11d628882c00564df7b73d21`

This is the Git blob SHA of the exact current `public/app.js` bytes.

`test:next:7` recomputes the Git blob SHA from the file bytes and requires it to equal `version.json.appRevision`. Therefore a future app.js change without updating the revision fails the regression.

## URL

Other startup resources still use:

`?v=190.2`

Only app.js adds the content revision:

`/app.js?v=190.2&r=c6cb6b3d58e5423d11d628882c00564df7b73d21`

The loader computes one `appBuildSuffix190`.

Both:

- the app.js preload;
- the actual executable app.js script

use that same suffix. The browser regression asserts that their resolved URLs are identical.

If appRevision is missing or malformed, runtime falls back to the existing build suffix. The source tree itself is protected by the regression above.

## Update and rollback verification

The real current startup was first verified with the normal Service Worker path:

- URL revision equals version.json.appRevision;
- fetching that URL returns bytes whose Git blob SHA equals appRevision.

A separate isolated diagnostic context then blocked Service Workers only so test-controlled server responses could model two distinct app contents.

The same browser context was exercised through:

1. content revision B;
2. rollback to content revision A.

For each navigation the test verified:

- preload URL equals executable script URL;
- URL `r=` equals the selected revision;
- the selected body is actually executed;
- fetching that URL returns bytes hashing to the selected revision.

The B and A URLs are different, and rollback returns/executes A bytes after B had already been used.

## Verification

Final CI run: `36415957342` — SUCCESS.

Passed:

- `npm run test:next:7`;
- `npm run test:next:4`;
- `npm run test:186:startup`;
- `npm run test:180:rollback-contract`.

Item-7 regression output:

- PASS appRevision equals Git blob SHA of public/app.js;
- PASS app.js preload and executable script use the identical revisioned URL;
- PASS current revision URL returns exact current app.js bytes;
- PASS synthetic update changes URL and executes/returns updated bytes;
- PASS synthetic rollback changes URL back and executes/returns rollback bytes.

The existing updater rollback contract also remains green.

## Files changed

Runtime/config:

- `public/version.json`;
- `public/index.html`.

Regression:

- `scripts/regression-next7-app-revision.cjs`;
- `package.json`.

No app.js runtime logic, Service Worker, server, database, updater logic, owner/manager/arbiter or whole-project build system was changed.

## Rollback

Revert the appRevision field and the app-specific URL suffix in index.html, then remove `test:next:7`.

No data migration is involved.

## Continuation

Item 7 is complete. Do not automatically start item 8.
