# AGENTS.md

Guidance for AI agents and contributors working in this repo. Read `README.md` for
commands and layout.

## How to work with tasks

Use the file `todo.md`.

For each todo item, interview the user extensively to deeply understand the scope and goal of each. When done, check the completed task in `todo.md`. Commit all changes and push to a new branch, create a PR and merge it when the CI/CD turns green.

## Project priorities (do not erode)

1. **Simplicity** — prefer the solution that is easiest to understand, smallest, and most readable.
2. **Few dependencies** — runtime deps stay minimal (today `ejs`, `lucide-static`,
   `@larvit/log` — the last itself zero-dependency, for structured/OTLP logging).
   Prefer the Node standard library; justify any new dependency; do not add
   frameworks. The app is
   **stateless — no database**. Auth/identity/OAuth are **Ory sidecar services**
   (Kratos/Keto/Hydra, backed by Postgres), reached over their REST APIs with
   built-in `fetch` — no SDK dependency. New capabilities ship as **plugin
   folders** under `plugins/` that fetch their data from upstream services, not as
   core code. See `README.md` for the architecture.
3. **Strict TypeScript** — `tsconfig.json` is strict (incl. `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `verbatimModuleSyntax`). Keep it that way. Prefer
   exact types and limit nullable and multi option types when possible. KISS.
4. **Environment-agnostic** — the app never asks *which environment* it runs in; there is
   no `NODE_ENV` (or equivalent) branching. Every behaviour is an **explicit config
   toggle** (e.g. `CACHE_TEMPLATES`, `REQUIRE_SECURE_SECRETS`, a future "disable email"),
   read once in `src/config.ts`. Compose files set the toggles per deployment.
5. **Semantic, accessible DOM** — markup is a first-class concern. Use the right element
   for the job (landmarks, one `<h1>` per page + sane heading order, lists, `<table>` with
   row/column headers, `<fieldset>`/`<legend>`, `<button>` vs `<a>`); add ARIA only to fill
   real gaps (`aria-current`, `aria-sort`, labels). Classes/ids name *meaning*, not looks.
   Prefer native semantics over `div` + ARIA. New views and partials keep this bar.
6. **Full, parallel E2E** — every user-facing flow (each page, form, guard, plugin route)
   has a Playwright E2E test, and a new surface ships *with* its E2E in the same change.
   Tests stay independent and side-effect-free so the suite runs `fullyParallel` — keep it
   that way as it grows (never serialise on shared state); parallelism is what keeps it
   fast. E2E runs in Docker against the live stack — see `README.md`.
7. **Powerful, fail-loud plugins** — the plugin API is the product's main surface and the
   only way to add domain features. It optimises for being **powerful, predictable, and
   overloadable** (a plugin can take over as much of a page as it wants), and the host
   **fails loud at boot/discovery** (bad manifest, version mismatch, or conflict stops
   startup with a clear message) rather than sandboxing at runtime. Runtime crash-isolation
   is a deliberate **non-goal** — diagnose at deploy time, not in production. Keep this
   contract stable; see `README.md` → Building plugins.

## Deliberate architectural deviations (don't re-flag)

Intentional, reasoned choices — an architecture review should honor them, not re-raise
them. Revisit only if the stated reason stops holding.

- **`src/` is grouped by concern**, not flat — `http/` (request pipeline), `auth/`
  (session-JWT hot path, guards, and the Ory REST clients), `i18n/` (locale resolution + the
  catalogs, `locales/` holding the data), `plugin-host/`
  (discovery/router/hooks/view-resolver + the `plugin-api.ts` author barrel + `system.ts`, the
  `ctx.system` capability surface), and `ui/` (design-system view-models + menu/chrome);
  `server.ts`/`config.ts`/`logger.ts` and the topology-guard `*.test.ts` stay at the root. Tests
  are co-located (`foo.test.ts` beside `foo.ts`). Add a new module to the folder that owns its
  concern rather than to the root; don't reintroduce a flat tree. The core ships **no domain
  screens** — even the admin GUI (users/groups/permissions) is a drop-in plugin (`examples/plugins/admin/`),
  not `src/` code.
- **`ctx.chrome` is lazily memoized — do not make it unconditional** or move it into the
  base request context. It protects the I/O-free hot path on the public, bot-hit landing
  (`/`). (Declined twice.)
- **Email is delegated to Kratos** (it renders + sends recovery/verification mail); `web`
  never touches SMTP. Customization is Kratos' built-in `courier.template_override_path`,
  not app code — keeping `web` stateless and dependency-light (see [Email](README.md#email)).
- **Plugins and config import the host only via package.json `imports`** — `#plugin-api`
  → `src/plugin-host/plugin-api.ts`, `#menu-config` → `src/ui/menu-config.ts` — never a
  relative `../../src/*` path. These two barrels are the whole author/operator contract
  surface; the `src/*` behind them may be refactored freely. Depth-independent and
  refactor-stable by design — don't "fix" a `#`-import back to a relative path.
  **One caveat:** `#plugin-api` re-exports the Ory client types for the `ctx.system` surface
  (`KratosAdmin`/`KetoClient`/`HydraAdmin` + their DTOs and error classes). Those shapes are
  therefore **contract-visible** — changing them is a plugin-API break needing a major
  `apiVersion` bump, not a free refactor. Keep the Ory clients stable, or bump the version.
- **A plugin/config folder must stay a plain folder — no `package.json` of its own.** Node
  resolves `#`-specifiers against the nearest parent `package.json`; a `package.json` inside
  the folder becomes its own scope and `#plugin-api`/`#menu-config` stop resolving. Accepted
  cost of the `#`-import contract (fits the stateless, no-per-plugin-deps ethos). A plugin
  kept in its own repo typechecks against the barrel only when mounted under the host tree
  (or by adding a local `imports` map / vendored stub).
- **`examples/` mirrors the drop-in mount dirs** — `examples/plugins/<id>/` copies to
  `plugins/<id>/`, `examples/config/menu.ts` to `config/menu.ts`. Both mirror folders are in
  `tsconfig.include` and resolve the host surface via `#`-imports, so each example typechecks
  in place *and* copies across unchanged. Never commit real plugins/config into the root
  mount dirs (`plugins/`, `config/`) — they ship empty (`.gitkeep`, git-ignored otherwise).
- **Authorization vocabulary: `User` → `Group` → `Permission`, and there is no `Role`.** Keto ships
  no namespaces — all four in `ory/keto/namespaces.keto.ts` are ours. `Permission` follows RBAC,
  where a permission is one operation ("read shifts") and a role is a *bundle* of them; a route
  gates on one operation, so it gates on a permission, and a bundle is just a group with several
  grants (groups nest). Ory's own "permission" (the `Resource` `permits`: view/edit/delete) is the
  separate per-row tier.
- **A permission name is always `<resource>:<action>`** — `scheduling:read`, `users:write`. A bare
  word names *who someone is* — a role — and roles are groups here; the old catch-all `admin`
  permission was exactly that mistake, split into `users:`/`groups:`/`permissions:`/`oauth2-clients:`
  × `read`/`write` 2026-08-05. **Enforced at discovery** (`isValidPermissionName` in
  `plugin-host/plugin.ts`, checked by `shapeError` over every route/nav `permission` and every
  declared name), fail-loud like every other manifest rule — not only in the admin GUI, which an
  operator removes by not copying the example in. Decisions around it:
  - **Names are authored in plugin code; only grants live in Keto.** The host collects every
    installed plugin's declarations into one catalog (`declaredPermissions` → `ctx.declaredPermissions`),
    and that catalog *is* the fixed list the admin screens offer. So there is **no Permissions admin
    screen**: nothing in a GUI invents a name, and holding one is a property of a user or a group,
    edited as a checkbox list on those two screens. A tuple in Keto naming something no installed
    plugin declares gates nothing and is not offered — and a save never revokes it, since the picker
    only speaks for what it showed. Decided with the maintainer 2026-08-05, replacing the CRUD
    Permissions screen.
  - `<resource>` is **global, not plugin-scoped** (hence `oauth2-clients`, not `clients`). Deliberate
    cross-plugin sharing is a goal, so the pre-2026-08-05 `<id>:<action>` guidance was wrong: users
    are the *host's*, not the admin plugin's. Cost: collision-freedom became a convention rather than
    structural. Accepted — the alternative penalizes the sharing case.
  - **Declaring a permission stays optional.** Requiring every gated route to declare its permission
    would make `findConflicts` see all overlaps, but would then warn on exactly the legitimate
    sharing case above. Shape is enforced; declaration is not.
  - **There is no name-minting path in the GUI at all**, which is what makes the discovery check the
    whole story: the only way a name comes into being is a plugin declaring it, and discovery refuses
    a badly-shaped declaration at boot. An earlier revision of this branch enforced the rule in the
    Permissions screen's create form instead and needed a second guard for the assign form, which
    could also mint one — deleting the screen removed both.
  - `ADMIN_PERMISSIONS` **defaults to empty**: every permission is owned by the plugin that gates on
    it, and a host-invented default would gate nothing. This makes the seed a function of what
    `bootstrap` discovers, and a plugin dropped in after first boot therefore needs
    `docker compose up -d` (which re-runs the one-shot), not `restart web`. The base file gives
    `bootstrap` and `web` the same baked `plugins/`; only `compose.override.yml`'s dev-only `.:/app`
    makes `web` diverge onto the host tree, so the matching `./plugins` mount for `bootstrap` lives
    **there and only there** — in the base file it would desynchronise prod and collide with the e2e
    stacks, which bind individual plugins *inside* `/app/plugins` (a nested mount into a read-only
    parent is EROFS and the container never starts). Valid while bootstrap is the only writer of
    grants.
  - **`actionForMethod` is plugin-local and must not migrate into `#plugin-api`.** Inside the admin
    example it buys one thing: the route table and the in-handler guard derive from one function, so
    29 routes × 2 gate sites cannot drift. As a general mechanism it would make authorization a
    function of the transport verb, and a route table must answer "what does this need?" on its own.
- **A `:read`-only holder must never be shown a write affordance.** The split created a real read-only
  operator (a helpdesk account with `users:read`), and the host's 403 is the backstop, not the UX: the
  list/detail models carry `canWrite` and the views drop create/save/delete/add/remove, while the
  permission picker still renders — disabled — because *seeing* who holds what is the point of `:read`.
  Two grant-specific guards go with it, both restoring behaviour the deleted Permissions screen had:
  you cannot revoke your own grants (self-lockout would need a `curl` against Keto to undo, which the
  operator persona can't do — same shape as the self-deactivate/self-delete guards), and a permission
  held *through a group* renders ticked-but-disabled rather than unticked, because showing it unticked
  stated the opposite of the truth and unticking it wrote nothing while looking like a successful
  revoke. Raised by the architecture + product reviews 2026-08-05.
- **`users:write` and `groups:write` are equivalent to full administrative access**, and the split
  does not change that: `groups:write` adds you to any group, including one holding every permission;
  `users:write` mints a recovery code for any account. The containment the split buys is real on the
  **read** half only (`users:read` is a safe helpdesk grant). Don't let the per-resource naming imply
  otherwise in docs. Raised by the architecture review 2026-08-05.
- **Plainpages says "user" everywhere; Ory's word for it is "identity".** Kratos calls the record
  an identity, but Ory's own docs state it uses that term *interchangeably* with "users" and
  "accounts" — so this is house style, not a renamed concept, and "user" is the word readers
  already know (Nielsen's heuristic #2: match between the system and the real world). One note in
  README → Auth records the mapping so nobody has to rediscover it. The single exception is the
  `Identity` DTO in `src/auth/kratos-admin.ts`, which mirrors Kratos' wire shape and keeps Ory's
  name — don't rename that one.
- **The locale lives in the URL, never in a cookie.** `?locale=sv-SE` → `Accept-Language` → `en-US`,
  and when the URL asked for one the host carries it onto the links it renders (`ctx.localeHref`).
  A cookie would make a page's language invisible in its address and unshareable; the cost is that a
  plugin must wrap its own hrefs. Matching is exact on a full tag (`sv-FI` ≠ `sv-SE`), except that a
  lone language from `Accept-Language` takes the first regional catalog for it. Decided 2026-08-03.
- **Catalogs are checked at boot, not at render.** Every locale is compared against its set's `en-US`
  — keys, string-vs-plural kind, and the plural categories `Intl.PluralRules` says that locale needs —
  and a mismatch stops startup, same fail-loud contract as a bad manifest. A plugin may ship fewer
  locales than the host (its strings fall back to `en-US` per key), never one the host lacks.
- **The core building blocks carry the locale; a plugin doesn't have to.** The shell (breadcrumbs),
  `pagination`, `filter-bar`, `data-table`, `auth-card`, `flow-body`, `field` and `menu` wrap every
  href they render in `localeHref`; the nav and the sign-in link are wrapped upstream in `chrome.ts`;
  and the two GET forms
  (filter bar, rows-per-page) carry it as a hidden `locale` input, since a GET submit replaces the
  whole query string and no href wrapper can reach it. Putting the obligation on each call site was
  tried first and missed five of eight sites inside one commit — including the admin screens.
  `ctx.localeHref` remains for hrefs a plugin's own markup emits (the admin example's delete links).
  **A form's `action` counts as a link** — a POST replaces the URL as completely as a GET submit, so
  the sign-out, consent and auth-card forms carry it too; without that, picking a language and then
  saving anything drops back to `Accept-Language`. The one round-trip that cannot carry it is the
  Kratos sign-in POST, whose action is an absolute off-site URL.
  Decided 2026-08-03 after an architecture review; a second pass then found breadcrumbs still raw,
  so: when a link renders from the core chrome, it is the chrome's job to carry the locale.
- **`locale` is a host-owned query param.** It is in `parseListQuery`'s reserved set (`list-query.ts`),
  so a localized list page doesn't hand a plugin a phantom `locale` filter; the i18n view locals (`t`, `locale`, `locales`, `localeHref`,
  `localeParam`, `localeSwitch`, `dir`) are likewise reserved names, merged after a handler's `data`
  so a collision loses the key instead of breaking the shell.
- **The language picker is on every page, POST-rendered ones included.** Maintainer's call
  2026-08-04, overriding an earlier decision to hide it there. The problem it was hiding is real: a
  POST-rendered URL frequently answers no GET (`POST /admin/users/:id/recovery`), so a link back to
  it dead-ends on a 405. The host therefore resolves the picker's target (`app.ts` → `switchBase`):
  this path when it answers GET, else the same-origin Referer, else `/`. Accepted cost: switching
  language on such a page leaves that POST's own result behind (a re-rendered form's input, or a
  one-time recovery code). Valid while the picker is expected on literally every page — if that ever
  softens, hiding it after a POST is the simpler answer.
- **A plugin-owned render always runs on that plugin's context.** The landing slots (`home`,
  `dashboard`) and an `onRequest` short-circuit dispatch a plugin's handler, so they build the
  context with `contextFor(pluginId)` exactly as a plugin route does — otherwise `ctx.t` is the core
  translator and the plugin's own keys render as bare keys on the pages it owns. Found by review
  2026-08-03 after all three paths shipped with the host's context.
- **`locales/` at the repo root is a drop-in mount, like `plugins/` and `config/`** — `locales/<tag>.ts`
  for the core and `locales/plugins/<id>/<tag>.ts` for an installed plugin, each adding a language or
  replacing that tag's catalog wholesale. Adding a language must never require forking the image or a
  vendored plugin folder. The SHIPPED `en-US` (core's, or the plugin's own) stays the parity baseline
  even when the mount replaces it, so a mounted catalog is checked rather than trusted (one compared
  only against itself would boot green with the whole UI rendering keys), and each half is reported
  under the folder it actually lives in.
- **RTL is out of scope until there is a real use case.** `textDirection` sets `<html dir>` from the
  locale's script because that is free and correct, but the stylesheet keeps physical `left`/`right`
  properties — a genuine RTL locale needs those moved to logical ones first. Don't convert the CSS or
  file findings about it on spec. Maintainer's call 2026-08-04; valid while no deployment needs an
  RTL language. A catalog there
  for a new tag adds a language; one for a tag the image ships replaces that catalog wholesale, held
  to the same parity check. Adding a language must not require forking the image.
- **An unknown translation key renders as itself.** That single rule is what lets a nav label,
  branding, or a menu `rename` be either a key or plain text without a second field or a migration.
  Don't "fix" it into a loud failure: a manifest with plain labels must keep working.
- **`t()` returns raw text; the view escapes it.** Messages go through `<%= %>` like any other value,
  so nothing is double-escaped; a message carrying markup uses `<%- %>`, and then its `{{vars}}` are
  escaped at the call site (see `views/partials/pagination.ejs`). Don't move escaping into `t()` —
  every other value in a view would then be the odd one out.
- **CI docker logins share the runner host's Docker config.** The act_runner is host-mode, so
  `docker login`/`logout` in the workflows mutate one shared `~/.docker/config.json`:
  concurrent jobs can race (one job's logout can 401 another's push — recover by re-running),
  and tokens sit in that file between login and logout. Same class: concurrent runs share the
  workspace dir, so ci.sh's web-image build races another run's container creation on the
  `<project>-web` tag. Accepted for a single-maintainer cadence; serialize with a workflow
  `concurrency` group if it ever bites.
- **The docs-only CI skip is `*.md` anywhere in the tree, not just the root.** No test, build step or
  workflow reads a markdown file (`README-dockerhub.md` is pasted into Docker Hub by hand), so a
  nested `examples/plugins/admin/README.md` edit is as safe to skip as `README.md`, and narrowing it
  would spend the full gate on one. Both git channels in `ci.sh`'s `docs_only()` pass `--no-renames`:
  rename detection names only the destination, so `git mv src/app.ts notes.md` otherwise read as docs
  and skipped the gate over a source file that was gone. `src/ci-gate.test.ts` locks the flags as a
  *text* guard — the test image (`node:24.19.0-alpine3.24`) ships neither `git` nor `bash`, so it
  cannot exercise the function; behaviour was verified against a scratch repo across ten scenarios.
  Revisit if a `.md` ever becomes load-bearing. Decided 2026-08-05.
- **Plainpages is pre-announcement: no tags, no releases.** The repo carried tags up to `v0.2.2` from
  the `auto-release` job; all of them — and the semver container tags — were deleted 2026-08-05, and
  the job is gated behind the `AUTO_RELEASE` Actions variable (unset ⇒ skipped, the fail-safe
  direction on every unknown-`vars` path). A version only communicates to consumers, and there are
  none; same reasoning that freezes `HOST_API_VERSION` at 1.0.0. Note the coupling:
  `registry-cleanup` keeps a hash image only while its commit is a branch head *or* release-tagged,
  so with zero tags only branch heads survive the nightly prune — a hand-cut tag must sit on `main`'s
  tip. `mirror.yml` pushes tags with `--prune` so the deletions actually reach the public GitHub
  mirror; that makes the runner's tag view load-bearing (hence `fetch-tags: true`) and means a tag
  or Release created on GitHub is swept away, so releases are cut on Gitea only. Valid until the
  maintainer says Plainpages is ready to show people.
- **A dropdown is a `<button popovertarget>` + `[popover]`, never a `<details>`.** The browser then
  owns open/close, which is the only zero-JS way to dismiss a menu by clicking outside it (the whole
  point), and the panel sits in the top layer so a row kebab is no longer clipped by `.table-wrap`'s
  `overflow`. Four rules hold it together, none of them cosmetic. The panel carries
  **`position-anchor: auto`** — a bare `anchor()` resolves to nothing in Chromium, Firefox *and*
  WebKit alike, which is why the popover test in `visual.spec.ts` runs in all three rather
  than resting on a one-time manual measurement. The panel stays the trigger's **next sibling inside
  the `.menu` wrapper**, because the open-state style and the old-browser fallback both read that
  adjacency, and a two-element partial cannot be dropped into an arbitrary layout. The `menu` partial
  **requires a caller-named `id`** and fails loud without one: it is the `popovertarget` idref, and
  generated random ids were tried and rejected the same day — nondeterministic HTML forecloses the
  still-open caching decision and names nothing a reader can use. And **neither `aria-expanded` nor
  `aria-haspopup` is written**: a zero-JS invoker cannot keep the first truthful, and the second would
  promise `role="menu"` keyboard semantics these panels do not implement. `<details>` stays where it
  means disclosure rather than popup: the nav tree. `shell.ejs` hand-rolls the same block for the
  profile menu because its trigger composes escaped user values and its one item is a CSRF POST form,
  neither of which the partial's `Item` shapes cover — keep the two in step, or fold it in if
  `todo.md`'s "does the profile dropdown still earn a dropdown" settles the other way. Decided 2026-08-05.
- **`ICON_NAMES` (`src/ui/icons.ts`) is a host-owned registry, not a frozen plugin contract.** It is
  deliberately not re-exported from `#plugin-api`, and README → Nav & permission gates already tells an
  author that using a new icon means registering it there. So the palette may narrow when the last
  reference to an id goes — `i-gear` left with the settings menu 2026-08-05 — and a plugin needing one
  gets it re-registered in the same change. Accepted cost: an unknown sprite id renders a blank icon
  instead of failing loud; the `every icon <use> resolves to a defined <symbol>` e2e test catches it for
  anything reaching the nav. Removing an id is a core edit, so weigh it per icon rather than sweeping the
  registry — a few ids are registered ahead of a caller (see `todo.md`).
- **Anything the browser logs fails the E2E test that provoked it.** Every spec takes its `test` from
  `e2e-tests/console-guard.ts`, which watches every page a test opens: a console error or warning, or
  an uncaught exception, fails that test. A zero-JS app has nothing to say in the console, so the bar
  is *zero* rather than a curated list of tolerated noise — and the two exceptions are explicit and
  narrow: one module-level allowance for the COOP header Chromium drops because the e2e stacks serve
  plain http over container hostnames (a deployment serves https, where it applies), and
  `allowConsole(re)` for a test whose own page provokes a message on purpose — the 404 spec, whose
  navigation Chromium and WebKit log. Each record carries the message's origin URL, so that allowance
  can name the page under test and still see a sub-resource of it 404. `src/e2e-console-guard.test.ts`
  locks the wiring in the *unit* gate: a spec importing `test` straight from Playwright — or minting a
  page with a raw `newPage()` instead of `watchedPage()` — would run unwatched and green. The buffer
  clears at teardown rather than setup so a `beforeAll` is watched too (full-flow runs a whole login in
  one); the accepted cost is that a page outliving its test, as a serial describe's does, can log late
  and fail the next test instead of its own. Verified by negative control in all three engines.
- **The Ory-free specs run in all three engines; the Ory-backed ones stay on Chromium.**
  `visual.spec.ts` + `language.spec.ts` are side-effect-free, so three parallel runs don't collide,
  and a console message only appears in the engine that renders the page — the reason the per-test
  `@engines` tag is gone: the whole Ory-free suite is the engine matrix now (`ORY_FREE` in
  `e2e-tests/playwright.config.ts`). The rest write users, groups and sessions to one shared backend,
  where a second engine's run would race the first, so widening them means giving each engine its own
  stack. Screenshots are written per project name for the same reason. Decided 2026-08-05.

## Docker only — no host tooling

**Everything** (install, typecheck, test, run, build, deploy) goes through Docker /
Docker Compose. **Never run `node`, `npm`, or `tsc` on the host.**

```bash
docker compose up                                       # dev server, live reload
docker compose run --rm --no-deps web npm run typecheck  # strict type check (--no-deps: skip Ory)
docker compose run --rm --no-deps web npm test           # tests
docker compose -f compose.yml up --build -d              # production
```

## README structure (keep it this way)

`README.md` serves two readers, in this order — preserve it when editing:

1. **First-time reader (top).** A one/two-sentence tagline, then a **Quick start** that gets
   the stack up (`docker compose up`, sign in) and a *minimal* plugin live. Nothing comes
   before Quick start — no philosophy, no rationale. Keep its commands copy-pasteable and the
   example plugin as small as possible; deeper detail lives in its own section, linked.
2. **Returning developer (rest).** A **Contents** ToC immediately after Quick start, then
   sections ordered by **what a developer adopting Plainpages reaches for, in priority
   order** — not by architectural layering. The value that sets the order: getting up and
   running **building plugins** comes first, then **configuring and securing** the system
   (Configuration, Auth); the **inner workings** (Architecture) and ops/runbooks are
   deliberately deferred — they're not top of mind when starting out. Concretely: Overview →
   Users, groups & permissions → Building plugins → menu/blocks/interactivity →
   Configuration → Auth → Email → Architecture → Testing → Production → Observability → the
   JWT-rotation runbook → the Project-layout file map → Extending. When adding a section, place
   it by this value (how early an adopter needs it), not by where it sits in the stack.

   **Users, groups & permissions precedes Building plugins** because a manifest's
   `permission:` gate is unreadable without the model, and operators need it as much as plugin
   authors. It is the one home for that model — the plugin and auth sections link to it rather
   than restating it.

When editing: put content in the section it belongs to (don't prepend rationale above Quick
start); keep the ToC in sync when you add/rename/remove an `H2`/`H3`; and state each fact in
one home, linking to it rather than restating (credentials, env vars, rotation steps).

**Don't document internals here.** How a script reaches a decision, why one run behaved
differently from another, what a function guards — a developer doesn't need it day to day and
can read it off the code or a run's log in seconds. Prose like that only makes the README
longer and harder to consume, for humans and machines alike. It belongs in the code it
describes, or nowhere. The README earns its length on what you cannot dig out: how to use and
operate Plainpages, the external contracts, and one-time setup (secrets, accounts, tokens).
Same test before adding a row to a table or the file map — a clause, not a paragraph.

## Rules

- Node 24 runs `.ts` directly (type stripping). Keep all TypeScript **erasable**
  (`erasableSyntaxOnly` is on): no `enum`, `namespace`, parameter properties, or
  decorators. Import local modules with their `.ts` extension.
- **No `.mjs`.** Write modules as `.ts` (Prio 1) — even standalone scripts run in bare
  `node:24` containers (the e2e mock servers, `examples/shifts-upstream/server.ts`): Node
  strips types and detects ESM from syntax, no package.json needed. If a file genuinely
  must be plain JavaScript, use `.js` (Prio 2); `"type": "module"` is already set in both
  `package.json`s, so `.js` is ESM.
- **No build step** and no compiled artifacts — do not add a bundler or `tsc` emit.
- Before finishing a change, run the typecheck and tests above; both must pass.
- Tests use the built-in `node --test` runner — no test framework dependency.
- English everywhere. Keep code comments short and information-dense. Self explained code
  without any comment at all is the preferred solution.
- Do not comment about history in the code or README. Like "This function included X before,
  but it moved to Y".
- Do not comment about the absence of things, if it is not very unexpected. Banned is things
  like "This function does not calculate pi, that is done in function Z".
- Pin all dependencies and Docker images to exact, human-readable **semantic
  versions** — never ranges (`^`, `~`) and never digests/hashes. npm deps are kept
  exact by `.npmrc` (`save-exact=true`) + `npm ci`; the base image by tag (e.g.
  `node:24.16.0-alpine3.24`).
- **`HOST_API_VERSION` is frozen at 1.0.0 until the first external install**, even for additive
  contract changes (i18n added four `RequestContext` fields and several barrel exports without a
  minor bump). Valid while nothing is installed against it: with no third-party plugin in the wild,
  a version bump can only produce noise. The promotion trigger is the first external plugin — from
  then on, follow the versioning table in README → Contract versioning as written. Decided 2026-08-03.
  **The frozen surface includes `views/partials/*.ejs`**, not just the manifest and the barrel: the
  view resolver makes every core partial an `include()` root for a plugin's views, so their option
  names and emitted markup are author-visible (under this freeze the popover change dropped the `menu`
  partial's `open?` and rewrote its markup). Know the hole that leaves — discovery fails loud on a bad
  `apiVersion`, but `include("menu", { open: true })` silently ignores the option and a plugin styling
  `.menu > summary` silently loses it. Promotion must cover the partial vocabulary too. Added 2026-08-05.
- A plugin's `apiVersion` is a **hand-written literal** semver — the host version the
  plugin was built against — bumped by hand on rebuild, **never** the host's
  `HOST_API_VERSION` constant. Importing the constant makes every plugin always equal the
  host, so `checkApiVersion` can never fire and a breaking change slips through silently.
- **Plugin route handlers are thin and per-route, keyed on `ctx.params`.** Register one handler
  per `{method, path}` in the manifest (the host extracts `:id`/`:name` and 404s malformed
  `%`-encoding — no manual path-slicing/decoding). Don't funnel many routes into one dispatcher
  that re-parses `ctx.url.pathname`: it duplicates the URL shape, ignores the router's params, and
  has to re-handle HEAD. Factor shared per-request setup (auth gate, `ctx.system` capability
  resolution, target fetch) into a small `withX` wrapper — see `examples/plugins/admin/`.
- **`handleRequest` (`src/http/app.ts`) is a known complexity hotspot** — ~160 lines tracking
  canonical host, static, locale, session + re-mint, CSRF, chrome, hooks, plugin routing, builtin
  routing, 405/404 and error mapping. The pure parts are already extracted and separately tested; what
  remains is orchestration. Planned split along those seams; don't grow it further without taking one
  out. Raised by the architecture review 2026-08-03, deliberately not done inside the i18n change.
- Reviews are maintainer-triggered (e.g. via the larv-review skill) — never auto-run reviewer
  agents. Decided 2026-08-02, replacing the earlier run-after-every-implementation rule.
- **A user-visible string belongs in a catalog, not in the code or a view.** Core strings go in
  `src/i18n/locales/en-US.ts` (then every other locale, or the boot fails); a plugin's go in its own
  `i18n/`. Operator/developer-facing text — boot errors, log messages, guard messages — stays English.
  A pure view-model builder takes an optional `t` defaulting to its own English, so a unit test reads
  in words; handlers pass `ctx.t`.
- **One verb per action in the English UI: sign in, sign out, create account.** Not "log in",
  "log out" or "sign up", inflections included — a second spelling for one button reads as a second
  thing; the noun ("a sign-in error", "the sign-in identifier") is unaffected. A plugin's catalog and
  every other locale follow the same rule in their own language. An unmapped Kratos id renders
  Kratos' own wording — map the id when it matters. **Held by the author, never by a test:** as the
  UI grows, slightly different wording is often the right call, and a check that fails the build on
  a word takes that judgment away. Maintainer's call 2026-08-05, dropping the guard that shipped
  with the rule.
- Use well formed, standard compliant, rich URIs. Prefer state in the URL over POST:ing in for
  for example list pages with filters and pagination. Do: "ids=x&ids=y" and not "ids[]=x&ids[]=y"
  and not "ids=x,y".
