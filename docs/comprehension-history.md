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

## 2026-10-31T01:19:49Z, PR #184 at af157c9, against bb8e6bc

Ruling: better

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | better | same | same | better | better |
| Inherited architect | better | better | same | better | better |

Mid A, decided by:

- Self-sufficiency, Navigation, Overall: `public/css/styles.css:12` `TOKENS` header comment: says all three theme rules need `:has()`, names the engines without it and points to the `@supports not selector(:has(a))` block, where the old text called the swaps "rock-solid"
- Navigation, Self-sufficiency, Overall: `README.md:214` `## Glossary`: defines host, plugin, manifest, chrome, nav fragment, permission name, system plugin and denylist and links each to its home section
- Self-sufficiency: `README.md:815` `Plugin dependencies`: the scale bullet states the plugin count the per-plugin dependency design assumes

Inherited architect, decided by:

- Self-sufficiency, Locality, Overall: `public/css/styles.css:12` `1. TOKENS` comment: an editor of the theme mapping learns of the distant `:has()` fallback from the comment, where the old text said the swap could not fail
- Navigation, Self-sufficiency, Overall: `README.md:214` `## Glossary`: a cold reader reaches "chrome" or "denylist" and their home sections in one hop
- Self-sufficiency: `README.md:815` `### Plugin dependencies`: the scale bullet gives the plugin count the dependency design assumes

## 2026-10-31T07:26:19Z, PR #187 at 10152d2, against b336dee

Ruling: better

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | same | same | better | better | better |
| Inherited architect | same | same | better | better | better |

Mid A, decided by:

- Self-sufficiency, Overall: `e2e-tests/mock-oidc.ts:18` `idToken`: the helpers' signatures now say what `res`, `nonce` and the `codes` map hold
- Self-sufficiency: `e2e-tests/proxy.ts:14` `toKratos`: `(path: string): boolean` shows the routing predicate's contract
- Self-sufficiency: `e2e-tests/tsconfig.json:2` `extends`: the specs are held to the host's strict flags, and the Dockerfile comment explains the path link
- Shape, Overall: `src/ui/icons.ts:4` `ICON_NAMES`: the comment "the icons the UI actually references" is true again

Inherited architect, decided by:

- Self-sufficiency, Overall: `e2e-tests/mock-oidc.ts:18` `b64`: typed helpers replace a trace through the `createServer` callback
- Self-sufficiency: `e2e-tests/proxy.ts:14` `toKratos`: the predicate's contract is readable on its own line
- Self-sufficiency: `e2e-tests/Dockerfile:11` `COPY tsconfig.json`: the relative `extends` path works in the checkout and in the image, and a comment names the link
- Shape, Overall: `src/ui/icons.ts:4` `ICON_NAMES`: the registry matches its description, with no dead ids

## 2026-10-31T12:28:23Z, PR #200 at 3592a30, against a8a9744

Ruling: same

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | better | better | better | same | better |
| Inherited architect | worse | worse | better | same | same |
| Maintainability senior | same | same | better | same | same |
| Junior A | better | better | better | better | better |

Mid A, decided by:

- Navigation, Locality, Shape: `src/ui/chrome.ts:74` `shellUser`: the deleted `buildShellContext` and `buildDashboardModel` left two shell models side by side, and now every page reads one `chrome`
- Locality, Shape: `src/auth/routes.ts:58` `flowFailure`: a named unit shared by `flowPage` and `codeFlowSubmit`, where the old `flowPage` held the whole error ladder inline
- Shape: `src/auth/kratos-public.ts:117` `submitFlow`: takes a flow type and id instead of an action URL, and the Referer quirk is explained where it applies
- Locality: `src/http/static.ts:93` `versioned`: reads the module-level `hashes` map, so an asset href depends on what an earlier request hashed
- Navigation, Shape: `src/ui/stylesheet-floor.ts:30` `floorViolations`: a 249-line regex walker that only tests use sits in `src/ui/` beside runtime modules, though the README now points straight at it

Inherited architect, decided by:

- Navigation: `public/css/styles.css:25` `:root`: the old comment next to the palette answered the 3am question and the new text drops it
- Navigation: `src/ui/stylesheet-floor.ts:1` `floorViolations`: its header never says an unsupported value in a custom property blanks every `var()` reading it, so a cold reader walks the regex walker to find the cause
- Navigation, Shape: `src/ui/stylesheet-floor.ts:12` `import`: test-only tooling that pulls a devDependency sits beside runtime modules and is missing from the README file map
- Locality: `src/http/static.ts:64` `hashes`: a module-level map shared by every `publicAssets()` instance makes a fresh href depend on request history elsewhere
- Locality: `src/http/app.ts:188` `renderPage`: `assetHref` is appended last at three render sites, and only a comment keeps a fourth from emitting unversioned hrefs
- Shape: `src/ui/chrome.ts:74` `shellUser`: removes the second shell model that duplicated `PageChrome`
- Shape: `src/auth/routes.ts:58` `flowFailure`: one named unit shared by `flowPage` and `codeFlowSubmit`, each handler reads in a screen

Maintainability senior, decided by:

- Shape, Locality: `src/ui/chrome.ts:74` `shellUser`: the deleted `ShellModel` left two shapes for the same chrome, and now the shell has one input and one builder
- Shape, Locality: `src/auth/routes.ts:58` `flowFailure`: the old `flowPage` mixed about 60 lines of error mapping with `return_to` handling, and now `flowReturnTo` and `flowFailure` read on their own
- Locality: `src/http/static.ts:64` `hashes`: a hidden module-level cache filled by two readers, and `assetHref` is merged by hand at three render sites
- Shape, Navigation: `src/ui/stylesheet-floor.ts:119` `positive`: a 249-line regex walker that only a test uses sits among runtime view modules

Junior A, decided by:

- Navigation, Self-sufficiency: `src/ui/stylesheet-floor.ts:1` `floorViolations`: the README's "Two browser floors" points here and the header lists what is checked, where the base had a prose rule and a hand-written regex test
- Shape, Locality: `src/ui/chrome.ts:74` `shellUser`: one shell view model replaces `ShellModel` beside `PageChrome`, and its helpers sit beside their only caller
- Shape, Locality: `src/auth/routes.ts:58` `flowFailure`: named units replace about 60 inline lines in `flowPage`, and `codeFlowSubmit` reuses them
- Self-sufficiency: `src/auth/kratos-admin.ts:68` `createRecoveryCode`: the comment no longer claims Kratos mails the link
- Locality: `src/http/static.ts:64` `hashes`: a module-level mutable map backs asset versioning, hidden state the base didn't have

## 2026-10-31T12:30:19Z, PR #200 at 3592a30

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Junior A | 7 | 6 | 6.5 | 6.5 | 6.5 |
| Mid A | 7 | 6 | 6.5 | 6.5 | 6.5 |
| Maintainability senior | 7 | 6 | 6.5 | 6.5 | 6.5 |
| Inherited architect | 7 | 5.5 | 5.5 | 7.5 | 6.5 |
| Mean | 7.00 | 5.88 | 6.25 | 6.75 | 6.50 |

Junior A, hardest first:

- Locality, Overall: `src/ui/stylesheet-floor.ts:119` `positive`: a regex-built `@supports` evaluator whose header says what it enforces but not how it decides a guard names a feature
- Locality, Overall: `src/http/app.ts:185` `handleRequest`: about 165 lines in one closure where each stage reads state an earlier stage set
- Self-sufficiency: `src/auth/routes.ts:58` `flowFailure`: its 4xx branches can't fire from `codeFlowSubmit` because `submitFlow` throws only on 5xx, and the call site doesn't say so

Mid A, hardest first:

- Locality, Overall: `src/ui/stylesheet-floor.ts:119` `positive`: a hand-written CSS walker with three regex passes per declaration, opaque at line level
- Locality, Overall: `src/http/app.ts:185` `handleRequest`: a fixed order of about 15 stages that nothing in the code enforces
- Self-sufficiency, Shape: `src/auth/login.ts:40` `readPermissions`: the comment names the tuple `#members` where the code uses `granted`
- Locality: `src/auth/routes.ts:121` `codeFlowSubmit`: one idea split across `flow-view.ts`, `routes.ts` and `kratos-public.ts`

Maintainability senior, hardest first:

- Locality, Overall: `src/http/app.ts:185` `handleRequest`: a 167-line closure of complexity 43 whose order across closure state nothing names as a contract
- Self-sufficiency, Locality: `src/auth/routes.ts:58` `flowFailure`: on the submit path every 4xx branch is dead and nothing at the call site says which can fire
- Locality: `src/ui/stylesheet-floor.ts:119` `positive`: the one module whose correctness can't be checked by reading
- Self-sufficiency: `src/auth/bootstrap.ts:31` `permissionTuple`: the comment says `#members` while the code writes `granted`

Inherited architect, would restructure first:

- Shape, Navigation: `src/auth/flow-view.ts:152` `formAction`: the flow-to-route mapping has two homes, here and `routes.ts`, so a code flow's route and its form target are decided in different files
- Shape, Navigation: `src/ui/stylesheet-floor.ts:30` `floorViolations`: a CSS linter that never runs at runtime sits among the runtime view helpers
- Locality, Shape: `src/http/app.ts:185` `handleRequest`: a level of its own inside `createApp`
- Shape: `src/http/builtin-routes.ts:23` `matchBuiltinRoute`: holds no routes, because the table is inline in `app.ts:176` and `buildAuthRoutes`

## 2026-10-31T12:30:27Z, PR #200 rerun at 3592a30

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Junior A | 7 | 5.5 | 6 | 6.5 | 6 |
| Mid A | 7 | 6 | 6.5 | 6.5 | 6.5 |
| Maintainability senior | 7 | 5.5 | 6 | 6.5 | 6 |
| Inherited architect | 7 | 6 | 6 | 6.5 | 6.5 |
| Mean | 7.00 | 5.75 | 6.13 | 6.50 | 6.25 |

Junior A, hardest first:

- Locality, Overall: `src/ui/stylesheet-floor.ts:119` `positive`: a regex-built CSS walker that stayed opaque without tracing it by hand
- Locality, Overall: `src/http/app.ts:185` `handleRequest`: about 320 lines of interdependent locals, with a fixed stage order that only a top-to-bottom read shows
- Self-sufficiency, Shape: `src/auth/login.ts:40` `completeLogin`: the header says `#members` where the code uses `granted`

Mid A, hardest first:

- Locality, Overall: `src/http/app.ts:185` `handleRequest`: about 165 lines of order-dependent stages, with `renderPage` reassigned partway
- Locality, Overall: `src/ui/stylesheet-floor.ts:119` `positive`: how it decides a guard names a feature stayed opaque
- Self-sufficiency, Shape: `src/auth/bootstrap.ts:31` `seedPermissions`: the comment says `#members` where the code uses `granted`

Maintainability senior, hardest first:

- Locality, Overall: `src/http/app.ts:185` `handleRequest`: about 167 lines and complexity 43 in a fixed order nobody states
- Locality, Overall: `src/ui/stylesheet-floor.ts:119` `positive`: a hand-rolled regex CSS walker, partly opaque
- Locality, Shape: `src/plugin-host/plugin.ts:126` `RESERVED_PLUGIN_IDS`: a hand-kept mirror of the host's path segments that has already drifted, as it omits `error`
- Self-sufficiency, Shape: `src/auth/login.ts:40` `readPermissions`: the comment says `#members` where the code uses `granted`

Inherited architect, would restructure first:

- Locality, Overall: `src/http/app.ts:185` `handleRequest`: the most concerns and the highest complexity, already grandfathered, and every request-wide concern lands in it
- Shape, Navigation: `src/ui/stylesheet-floor.ts:15` `FLOOR`: the 3am rule's home is a test-only module under `ui/`
- Shape: `src/auth/routes.ts:275` `buildAuthRoutes`: the 19-module `src/auth/` mixes six concerns, and this file with `flow-view.ts` is where the next flow lands

## 2026-10-31T13:06:16Z, PR #202 at 8e73d16

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Junior A | 7 | 6 | 6.5 | 6.5 | 6.5 |
| Mid A | 7 | 6 | 6 | 6.5 | 6.5 |
| Maintainability senior | 7 | 6 | 6 | 6.5 | 6.5 |
| Inherited architect | 6.5 | 6 | 6 | 6.5 | 6.5 |
| Mean | 6.88 | 6.00 | 6.13 | 6.50 | 6.50 |

Junior A, hardest first:

- Locality, Overall: `src/http/app.ts:185` `handleRequest`: about 165 lines in a fixed order that only a top-to-bottom read shows
- Self-sufficiency, Shape: `src/auth/login.ts:40` `readPermissions`: the comment says `#members` where the code uses `granted`
- Self-sufficiency: `src/plugin-host/settings.ts:35` `SettingsOf`: nested conditional types that need the charter's rule to decode

Mid A, hardest first:

- Locality, Shape, Overall: `src/http/app.ts:185` `handleRequest`: complexity 43 inside the 318-line `createApp` closure, and `switchBase` reads `builtinRoutes` declared 60 lines later
- Locality, Shape: `src/ui/stylesheet-floor.ts:119` `positive`: a regex CSS walker whose how stayed opaque
- Self-sufficiency: `src/auth/bootstrap.ts:31` `permissionTuple`: the comment says `#members` where the code uses `granted`

Maintainability senior, hardest first:

- Locality, Shape, Overall: `src/http/app.ts:185` `handleRequest`: 167 lines and complexity 43 mixing twelve concerns whose order no type expresses
- Locality: `src/ui/stylesheet-floor.ts:119` `positive`: a hand-rolled regex CSS scanner traced by hand
- Self-sufficiency: `src/auth/gate.ts:13` `allows`: an empty gate is allowed, and the reason lives only in AGENTS.md

Inherited architect, would restructure first:

- Locality, Shape, Overall: `src/http/app.ts:185` `handleRequest`: the largest hub, where every request-wide concern lands
- Shape, Navigation: `src/auth/routes.ts:275` `buildAuthRoutes`: the 19-module `src/auth/` mixes four concerns with no sub-folder
- Shape, Navigation: `src/ui/stylesheet-floor.ts:30` `floorViolations`: test tooling sits among the runtime UI modules

## 2026-10-31T13:06:21Z, PR #202 rerun at 8e73d16

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Junior A | 7 | 5.5 | 6 | 6 | 6 |
| Mid A | 7 | 6 | 6 | 6 | 6.5 |
| Maintainability senior | 7 | 6 | 6 | 6 | 6.5 |
| Inherited architect | 7 | 5.5 | 6 | 7 | 6.5 |
| Mean | 7.00 | 5.75 | 6.00 | 6.25 | 6.38 |

Junior A, hardest first:

- Locality, Shape, Overall: `src/http/app.ts:185` `handleRequest`: closures over request state in a 318-line `createApp`, and it stayed opaque
- Self-sufficiency: `src/auth/routes.ts:58` `flowFailure`: the Kratos status semantics live outside the repo
- Self-sufficiency, Shape: `src/auth/login.ts:45` `readPermissions`: the comment says `#members` where the code uses `granted`

Mid A, hardest first:

- Locality, Shape, Overall: `src/http/app.ts:185` `handleRequest`: one pipeline whose steps mutate what later steps read
- Locality: `src/ui/stylesheet-floor.ts:119` `positive`: traced by hand
- Self-sufficiency, Shape: `src/auth/login.ts:45` `readPermissions`: the comment says `#members` where the code uses `granted`

Maintainability senior, hardest first:

- Locality, Shape, Overall: `src/http/app.ts:185` `handleRequest`: an unstated, load-bearing step order in shared closure state
- Locality: `src/ui/stylesheet-floor.ts:119` `positive`: a hand-rolled CSS scanner built on lookbehind regexes
- Self-sufficiency, Shape: `src/auth/bootstrap.ts:31` `permissionTuple`: the comment is false on the security-relevant path

Inherited architect, would restructure first:

- Locality, Shape, Overall: `src/http/app.ts:185` `handleRequest`: stage order lives only in line order, in a grandfathered complexity-43 function
- Shape, Navigation: `src/auth/routes.ts:275` `buildAuthRoutes`: 19 flat modules in `src/auth/`, and the next flow lands here
- Shape, Navigation: `src/ui/stylesheet-floor.ts:15` `FLOOR`: the 3am rule's home is a test-only module under `ui/`

## 2026-11-08T13:22:47Z, PR #214 at 84368ea, against c2389f8

Ruling: better

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | better | same | better | better | better |
| Inherited architect | better | same | better | better | better |

Mid A, decided by:

- Navigation, Shape, Overall: `src/test-tooling/stylesheet-floor.ts:1` `floorViolations`: test-only modules no longer sit beside runtime code in `ui/` and `http/`, and `AGENTS.md:77` names the folder
- Self-sufficiency: `src/auth/login.ts:40` `readPermissions`: the comment now names `#granted`, which the code queries
- Shape: `src/test-tooling/stylesheet-floor.ts:122` `positive`: grouping and the per-group decision are separate named units
- Self-sufficiency: `src/test-tooling/stylesheet-floor.ts:10` file header: says why a custom property's value is checked for functions and units
- Self-sufficiency: `src/plugin-host/plugin.ts:234` `undeclaredGates`: its comment says why an undeclared gate matters

Inherited architect, decided by:

- Self-sufficiency, Shape, Overall: `src/auth/login.ts:40` `readPermissions`: the comment now names the relation the code queries
- Self-sufficiency: `src/auth/bootstrap.ts:31` `permissionTuple`: the contradicting comment is gone
- Navigation: `src/test-tooling/stylesheet-floor.ts:1` `floorViolations`: the folder is named in AGENTS.md and the README file map
- Shape: `src/test-tooling/stylesheet-floor.ts:122` `positive`: one loop split into `parenGroups`, `Group` and `keepGroup`
- Self-sufficiency: `src/auth/routes.ts:117` `codeFlowSubmit`: a comment says which `flowFailure` branch can fire there

## 2026-11-08T13:44:57Z, PR #215 at 3a3bd77, against 01f368d

Ruling: better

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | better | better | better | same | better |
| Inherited architect | better | better | better | better | better |

Mid A, decided by:

- Locality, Shape: `src/ui/paginate.ts:68` `buildPaginationModel`: the rows form's hidden inputs are read off hrefFor, so form and links can't drift, where each page used to list them by hand
- Shape, Navigation: `examples/plugins/admin/admin-users.ts:140` `buildUsersListModel`: three near-identical listPagination copies become one call each to a named helper
- Locality: `src/http/app.ts:271` `shared`: ctx and contextFor spread one option object instead of spelling the same list twice
- Shape: `src/ui/paginate.ts:1` header: names both steps truthfully, and PaginationModel types the partial's input
- Navigation: `src/http/context.ts:28` `RequestContext.assetHref`: versioning a plugin's asset is a documented contract member, not a host-internal local

Inherited architect, decided by:

- Shape, Locality, Navigation: `src/ui/paginate.ts:68` `buildPaginationModel`: one typed function in the module owning the page math replaces three hand-written copies in the example plugins
- Locality: `examples/plugins/admin/admin-users.ts:188` `listPagination`: the older version built the hidden inputs field by field, apart from listHref; the round trip through new URL is a little clever, paid for by its comment
- Locality, Shape: `src/http/app.ts:271` `shared`: the two buildContext calls differ only in the translator and params
- Self-sufficiency: `src/http/context.ts:28` `RequestContext.assetHref`: the contract field says on the spot what it does and how it differs from the view local
- Self-sufficiency: `README.md:1050` pagination sketch: URL to partial in five lines, with the param-renaming rule

## 2026-11-08T14:10:47Z, PR #216 at bb134a3, against 6ca63c6

Ruling: better

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | better | same | better | same | better |
| Inherited architect | same | better | better | same | better |

Mid A, decided by:

- Navigation, Shape: `src/http/request-tracking.ts:9` `trackRequest`: the per-request logger, span and access line now live in a named module instead of the tail of the 318-line `createApp`
- Navigation, Shape: `src/http/request-fields.ts:33` `clientAddress`: the caller-IP and X-Forwarded-For rule has its own pure function in a file named for it

Inherited architect, decided by:

- Locality, Shape: `src/http/request-tracking.ts:9` `trackRequest`: the exactly-once finalize and close listener are one named unit, changeable without reading `createApp`'s other state
- Locality, Shape: `src/http/request-fields.ts:33` `clientAddress`: pure function of peer, header and list, with the reasons for reading from the right beside it

## 2026-11-08T18:34:54Z, PR #220 at 1b53b01, against 14a07dd

Ruling: same

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | same | same | same | same | same |
| Inherited architect | same | same | worse | same | same |

Inherited architect, decided by:

- Shape: `views/partials/shell.ejs:74` `user.menu`: a third meaning of `menu` beside the sidebar switch at line 19 and the `.menu` popover class
- Shape: `src/plugin-host/plugin.ts:9` `import type { ProfileMenuEntry }`: a second contract type defined under `ui/`, with a type-only import cycle through `chrome.ts`

## 2026-11-08T19:50:52Z, PR #223 at f8a6119, against b7e9780

Ruling: better

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Mid A | better | better | better | same | better |
| Inherited architect | better | better | better | same | better |

Mid A, decided by:

- Navigation, Locality, Shape: `src/http/app.ts:183` `handleRequest`: a 20-line list of named stages replaces a 170-line closure
- Locality: `src/http/app.ts:213` `Host`: 19 fields passed to every stage, broader than any stage needs
- Shape, Navigation: `src/ui/chrome.ts:29` `ShellUser.profileLinks`: the name says what the field holds
- Navigation, Shape: `src/plugin-host/conflicts.ts:15` `findConflicts`: collision rules have their own file

Inherited architect, decided by:

- Locality, Shape, Navigation: `src/http/app.ts:183` `handleRequest`: named stages replace one 165-line closure
- Locality: `src/http/app.ts:213` `Host`: a 19-field bag wider than any stage needs
- Shape: `src/ui/chrome.ts:29` `ShellUser.profileLinks`: no longer collides with `MenuConfig` and the `menu` partial
- Navigation: `.gitea/workflows/release.yml:60` error pointer: names `docs/ci-cd.md`, one hop from the failure

## 2026-11-08T21:24:33Z, PR #228 at ed48c5a

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Junior A | 7.5 | 6 | 7 | 7 | 6.5 |
| Mid A | 7 | 6 | 6.5 | 6.5 | 6.5 |
| Maintainability senior | 7.5 | 6.5 | 7 | 6.5 | 7 |
| Inherited architect | 6 | 6 | 6.5 | 7 | 6.5 |
| Mean | 7.00 | 6.13 | 6.75 | 6.75 | 6.63 |

Junior A, hardest first:

- Locality, Overall: `src/http/app.ts:67` `createApp`: a closure bag whose order matters; `switchBase` uses `builtinRoutes` declared further down
- Locality, Overall: `src/http/app.ts:274` `prepareRequest`: builds the context, the factory and the memoized chrome together, and every page path must remember to set the CSRF cookie
- Locality, Self-sufficiency: `examples/plugins/auth-admin/admin-groups.ts:285` `lostToSelf`: the self-lockout rule is spread over four call sites and no single place states it
- Shape, Overall: `examples/plugins/auth-admin/admin-grants.ts:99` `buildPermissionPicker`: checked, inherited, read-only and undeclared rows interact and need a truth table
- Self-sufficiency: `src/auth/routes.ts:45` `flowReturnTo`: locale and return-to inputs interact, and no table gives the result per input
- Self-sufficiency: `src/auth/routes.ts:58` `flowFailure`: four Kratos error branches that need Ory knowledge the repo doesn't hold
- Locality: `src/ui/chrome.ts:55` `buildPluginChrome`: the locale rule is put into effect in three places with no single owner
- Self-sufficiency: `src/plugin-host/router.ts:4` header: promises order-independent specificity, but ties fall to discovery order

Mid A, hardest first:

- Locality, Overall: `examples/plugins/auth-admin/admin-groups.ts:285` `lostToSelf`: needs Keto's transitive group resolution rebuilt by hand, and over-reports
- Shape, Locality: `examples/plugins/auth-admin/admin-groups.ts:435` `groupsDelete`: deletes grants one at a time, so it can stop part-way
- Shape, Overall: `examples/plugins/auth-admin/admin-grants.ts:99` `buildPermissionPicker`: four overlapping ideas; `checked` means direct or effective
- Self-sufficiency: `src/auth/routes.ts:58` `flowFailure`: Kratos status codes map to different outcomes and need outside knowledge
- Shape, Locality: `src/http/app.ts:183` `handleRequest`: the 19-field `Host` bag and the state threaded between stages
- Shape: `src/test-tooling/stylesheet-floor.ts:122` `positive`: a hand-rolled parser for `@supports` conditions
- Self-sufficiency: `src/plugin-host/settings.ts:35` `ValueOfDecl`: type-level inference with a `const` generic
- Self-sufficiency: `src/auth/jwt-middleware.ts:75` `verifyToken`: a denylisted token is thrown as expired so it gets re-minted
- Self-sufficiency: `examples/plugins/auth-admin/plugin.ts:22` `on`: each write-intent GET states its `"write"` override in the route table and in the handler

Maintainability senior, hardest first:

- Locality, Overall: `examples/plugins/auth-admin/admin-groups.ts:285` `lostToSelf`: the self-lockout guards rebuild Keto's transitive membership and no sentence states the invariant
- Shape, Overall: `src/http/app.ts:67` `createApp`: a long closure factory that is safe to read but not safe to change
- Shape, Self-sufficiency: `examples/plugins/auth-admin/admin-grants.ts:99` `buildPermissionPicker`: direct, effective and undeclared grant sets with a staleness token on top
- Self-sufficiency: `src/plugin-host/settings.ts:35` `ValueOfDecl`: type-level inference whose comments say what it does, not how
- Self-sufficiency: `src/auth/routes.ts:45` `flowFailure`: a matrix of Kratos statuses and flow states
- Locality: `src/auth/jwks.ts:68` `cachingJwks`: subtle cache state, and the denylist reuses the `expired` flag
- Shape: `src/test-tooling/stylesheet-floor.ts:122` `positive`: a hand-written parser for `@supports` conditions
- Locality: `src/auth/bootstrap.ts:86` `seedAdmin`: calls Kratos and Keto with raw fetch instead of the client modules
- Self-sufficiency: `examples/plugins/auth-admin/views/partials/group-detail-body.ejs:2` locals header: documents `identity` and `del`, omits `canWrite` and `permissions`

Inherited architect, would restructure first:

- Navigation, Overall: `src/auth/routes.ts:1` `src/auth`: 19 modules holding sessions, Ory clients, flows, the OAuth2 provider and one-shot CLIs
- Navigation: `src/auth/bootstrap.ts:1` `bootstrap.ts`: a one-shot process that also provisions plugin storage, placed under auth
- Navigation, Locality: `src/ui/chrome.ts:55` `buildPluginChrome`: builds the chrome for every page, the host's own included
- Navigation: `views/index.ejs:1` `index.ejs`: the built-in /dashboard, and `home.ejs` is "/", and neither filename says so
- Locality: `public/css/styles.css:326` `.btn-primary`: one visual fact spans the partial, the rule, the tokens and the floor policy in `src/test-tooling/`
- Shape, Locality: `examples/plugins/auth-admin/admin-groups.ts:113` `admin-groups.ts`: pure view models, Keto queries, lockout policy and handlers in one 463-line file
- Shape: `src/http/app.ts:213` `Host`: a 19-field bag that every cross-cutting feature edits
- Self-sufficiency: `src/plugin-host/system.ts:1` header: calls the built-in admin screens the reference consumer, but they are a drop-in plugin

## 2026-11-08T21:30:30Z, PR #228 rerun at 0727d15

| Seat | Navigation | Locality | Shape | Self-sufficiency | Overall |
|---|---|---|---|---|---|
| Junior A | 7.5 | 6 | 6.5 | 6.5 | 6.5 |
| Mid A | 7 | 6 | 6.5 | 7 | 6.5 |
| Maintainability senior | 7.5 | 6.5 | 7 | 7 | 7 |
| Inherited architect | 7 | 6.5 | 6 | 7.5 | 6.5 |
| Mean | 7.25 | 6.25 | 6.50 | 7.00 | 6.63 |

Junior A, hardest first:

- Locality, Shape, Overall: `src/http/app.ts:274` `prepareRequest`: a 19-field `Host` bag and a twice-memoized chrome threaded through one closure, and two return conventions (send and return null, or return a result)
- Locality, Self-sufficiency: `examples/plugins/auth-admin/admin-groups.ts:285` `lostToSelf`: the self-lockout rule differs from the users side and nothing says whether that is deliberate
- Shape, Self-sufficiency: `examples/plugins/auth-admin/admin-groups.ts:18` `LIST_FETCH_SIZE`: the comment says a Keto page but the call is Kratos `listIdentities`
- Self-sufficiency: `src/auth/routes.ts:58` `flowFailure`: branches on Kratos status and body text that need Ory knowledge
- Shape, Self-sufficiency: `src/auth/jwt-middleware.ts:75` `verifyToken`: a revoked token is reported as expired, with the effect in another file
- Locality: `src/i18n/load.ts:43` `loadI18n`: four catalog sources kept apart with a nested spread on one line
- Self-sufficiency: `src/server.ts:25` boot order: deleting `PLUGIN_DB_SECRET` is order-dependent and its reason sits in the decision log
- Self-sufficiency: `src/plugin-host/system.ts:1` header: calls the built-in admin screens the reference consumer

Mid A, hardest first:

- Locality, Shape, Overall: `src/http/app.ts:274` `prepareRequest`: the request order lives only in the sequence of a long closure, and `serveHome` skips `sendResult`
- Shape: `src/test-tooling/stylesheet-floor.ts:122` `positive`: a hand-written, regex-heavy reader of `@supports` conditions
- Locality: `src/auth/jwt-middleware.ts:75` `verifyToken`: revocation reported as expired works only through `resolveUser` in another file
- Self-sufficiency: `src/auth/routes.ts:58` `flowFailure`: Kratos statuses that need outside knowledge
- Locality: `src/auth/jwks.ts:68` `cachingJwks`: four interacting behaviours in one closure
- Shape: `src/i18n/load.ts:43` `loadI18n`: merges four catalog sources, with the chain order described in two files
- Locality: `src/i18n/locale.ts:81` `chosenLocale`: infers an explicit choice from the output of a URL builder
- Shape, Self-sufficiency: `examples/plugins/scheduling/plugin.ts:37` header: says "Roles" and `<id>:<action>` where the project has neither
- Self-sufficiency: `compose.yml:166` comment: says consent comes next, but `src/auth/oauth-consent.ts` exists

Maintainability senior, hardest first:

- Shape, Overall: `src/test-tooling/stylesheet-floor.ts:122` `positive`: a regex-driven mini-parser whose header states the rules but not how the helpers carry them
- Self-sufficiency: `src/auth/routes.ts:58` `flowFailure`: five branches that assume Kratos' error vocabulary
- Locality: `src/http/app.ts:274` `prepareRequest`: where the language picker points after a POST is spread over four units in three files
- Shape: `src/i18n/load.ts:43` `loadI18n`: three catalog sets, each with its own baseline, and a nested spread
- Locality: `src/auth/jwt-middleware.ts:84` `verifyToken`: the denylist travels as `expired`, so `resolveSession` can't show it
- Shape: `src/ui/chrome.ts:55` `buildPluginChrome`: labels are translated twice and `markCurrent` mutates the nodes
- Locality, Shape: `examples/plugins/auth-admin/admin-users.ts:348` `usersPermissions`: the stale-page, self-revoke and diff guards interact across two files, and `pickerOrNothing`'s promise is broken on the self-delete paths
- Shape: `src/plugin-host/router.ts:4` header: promises order-independent specificity, but ties fall to discovery order

Inherited architect, would restructure first:

- Shape, Navigation, Overall: `src/auth/bootstrap.ts:1` `src/auth`: 19 modules across the session, Kratos flows, OAuth2 and a second process entrypoint
- Navigation, Self-sufficiency: `src/auth/bootstrap.ts:1` header: lists the JWKS, admin and Keto steps but not the plugin storage step, and the file reads the environment outside `config.ts`
- Shape, Navigation: `views/index.ejs:1` `index.ejs`: the dashboard, with `home.ejs` as the landing page, and neither name says so
- Shape: `src/ui/chrome.ts:55` `buildPluginChrome`: builds the chrome for every page, not only plugin pages
- Locality, Navigation: `src/test-tooling/stylesheet-floor.ts:10` header: the custom-property footgun sits in test tooling instead of beside the tokens at `public/css/styles.css:9`
- Locality: `src/auth/bootstrap.ts:170` `provisionPluginStorage`: plugin storage lives in three places, across `storage.ts`, `storage-provisioning.ts` and `bootstrap.ts`
- Locality, Shape: `src/http/app.ts:183` `handleRequest`: every new manifest field or slot adds a stage here and a field to `Host`
- Self-sufficiency: `src/plugin-host/system.ts:1` header: calls the built-in admin screens the reference consumer
