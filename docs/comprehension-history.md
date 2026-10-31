# Comprehension history

## 2026-10-31T00:16:02Z, PR #181 at 56ff987, against eed1050

Ruling: better

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | same | better | same | better | better |
| Inherited architect | same | better | same | better | better |

Mid A, decided by:

- Self-sufficiency, Locality: `public/css/styles.css:24` `:root`: the comment above the hex palette says why a colour must not be oklch(), where a colour is edited
- Locality: `src/ui/stylesheet-floor.test.ts:11` `declares no oklch() colour`: a colour edit that breaks the browser floor fails a test instead of an old engine

Inherited architect, decided by:

- Self-sufficiency, Locality: `public/css/styles.css:24` `:root`: the comment above the hex palette says why a colour must not be oklch(), where a colour is edited
- Locality: `src/ui/stylesheet-floor.test.ts:11` `declares no oklch() colour`: a red gate explains the symptom in the file it lands on
- Self-sufficiency: `README.md:1027` "Two browser floors": the colour rule now sits beside the floor rule

## 2026-10-31T00:43:19Z, PR #182 at 19987ba, against 3e70768

Ruling: better

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | better | better | better | better | better |
| Inherited architect | better | better | better | better | better |

Mid A, decided by:

- Navigation, Shape, Self-sufficiency, Overall: `public/css/auth.css:1` `auth.css`: about 120 lines of rules for markup no view renders are gone, so a cold reader no longer rules them out first
- Locality, Self-sufficiency, Overall: `public/css/styles.css:31` `--on-accent`: the text colour on the accent is one token where four hard-coded `#fff` stood
- Self-sufficiency, Navigation, Overall: `public/css/styles.css:287` `@supports not selector(:has(a))`: the nav comment, the partial's header and the rule all say the tree folds only where `:has()` works
- Locality: `public/css/styles.css:241` `@supports selector(:has(a))`: the nav-fold behaviour now sits in two blocks about 50 lines apart, the second order-dependent; the comment names it

Inherited architect, decided by:

- Navigation, Shape, Overall: `public/css/auth.css:1` `auth.css`: the false `:target` banner and the phantom state machine are gone, so every selector left names something a view emits
- Self-sufficiency, Overall: `views/partials/nav-tree.ejs:4` `nav-tree.ejs`: the header and `public/css/styles.css:194` now say the branch folds only where `:has()` works; the old text was untrue on old engines
- Locality, Overall: `public/css/styles.css:31` `--l-on-accent`: one token feeds `.btn-primary`, `.page-btn[aria-current]` and `.brand-mark`
- Locality: `public/css/styles.css:287` `@supports not selector(:has(a))`: its `.nav-disc` rule sits about 85 lines from the nav rules it overrides, and `stylesheet-floor.test.ts` guards the order for `.theme-switch` only
- Self-sufficiency: `src/ui/stylesheet-contrast.test.ts:29` `stylesheet-contrast.test.ts`: the darker badge colours now have a stated 4.5:1 reason someone can find

## 2026-10-31T01:09:38Z, PR #183 at 0f20b38, against 364b047

Ruling: better

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | same | same | same | better | better |
| Inherited architect | same | better | same | better | better |

Mid A, decided by:

- Self-sufficiency, Overall: `public/css/styles.css:1` `App Shell Template header`: the false `light-dark()` bullet is gone, so no reader has to work out which of two comments is lying
- Self-sufficiency, Overall: `public/css/styles.css:687` `@supports selector(:has(a))` in `@media (max-width: 860px)`: the guard and its comment say what an engine without `:has()` gets, without opening the CHANGELOG

Inherited architect, decided by:

- Self-sufficiency, Overall: `public/css/styles.css:5` `Architecture` header: the false `light-dark()` bullet is gone, so the header no longer contradicts the TOKENS comment
- Locality, Self-sufficiency, Overall: `public/css/styles.css:687` `@supports selector(:has(a))` in `@media (max-width: 860px)`: the guard and its comment put the dependency of the open state on `:has()` where an editor would change it
