# Build 178.27 — competing viewport writer verification

Base: Build 178.26 on `build/178-development`.

178.27 is conditional: transfer one writer only if 178.26 proves two active writers of the same concrete geometry property.

That precondition is not met.

## Result

The two numeric mobile viewport properties still have one active JavaScript writer each:

| Property | Active writer | Competing active writer | Action in 178.27 |
| --- | --- | --- | --- |
| `--fpchat-visible-height` on `#appRoot` | `viewport-fix.js` / `FPViewport173` | none proven | no migration |
| `--fpchat-viewport-correction-y` on `#appRoot` | `viewport-fix.js` / `FPViewport173` | none proven | no migration |

`viewport-layout136.js` observes some of the same browser events, but writes keyboard **state** (`fp-keyboard-open`, transition classes, `data-fp-keyboard`) rather than either viewport numeric property.

The CSS rules driven by that state change composer/pill geometry, but they do not write the `#appRoot` viewport variables.

## Why no runtime change

Moving `FPViewport136`, safe-area CSS, or keyboard CSS into `FPViewport173` solely to satisfy the wording of the step would merge different properties and change ownership without a demonstrated race.

That would violate the Build 178 rule: one property may have one owner, but different properties are allowed to have different owners.

The remaining `box.scrollTop = box.scrollHeight` fallback in `viewport-fix.js` is also not evidence of a viewport-geometry conflict. Its concrete property is `#messages.scrollTop`, so it remains a separately classified message-scroll compatibility fallback.

## Preserved formulas

178.27 explicitly leaves unchanged:

- raw visual viewport minimum: `> 240`, fallback minimum `240`;
- stale viewport gap: `max(120px, 16% of reference)`;
- bottom-pin window: `1500ms`;
- visible height output: `ceil(currentVisibleHeight())`;
- viewport correction clamp and rounded pixel output;
- keyboard obscured height: `max(0, baselineHeight - height)`;
- keyboard threshold: `max(110px, 16% of baselineHeight)`;
- iOS keyboard-open composer padding: `8px`;
- iOS keyboard-open new-message pill bottom: `66px`;
- default composer bottom safe-area: `8px + env(safe-area-inset-bottom)`;
- existing top/list safe-area formulas.

## Regression guard

`npm run test:178:geometry-owner` scans all `public/**/*.js` files for `setProperty/removeProperty` writers of both viewport variables and fails if any file other than `public/viewport-fix.js` becomes a writer.

It also freezes the existing viewport/keyboard/safe-area formulas listed above.

178.27 intentionally changes no runtime source file.
