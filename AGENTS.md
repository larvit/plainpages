# AGENTS.md

Guidance for AI agents and contributors working in this repo. Read `README.md` for
commands and layout.

## Maintaining this file

Every agent session reads this file in full, so its length is a cost paid on every task.
Keep it the shortest thing that still changes what someone does.

- **Trim as you add.** After any edit, re-read the whole file and compress: merge overlapping
  entries, cut prose that restates a rule, drop what the code or `README.md` already says.
  Question each section — same information, fewer words.
- **Record the decision and the reason it turns on, nothing else.** Not the investigation, not
  what was tried first, not how it was verified — that belongs in the PR that made the change.
- **Give every accepted risk an expiry** ("valid while X"), and delete the entry once X stops
  holding.
- **One home per fact.** Link to it rather than restating it — the same sentence in five files
  is five things to update and five chances to drift.

## How to work with tasks

Use the file `todo.md`.

For each todo item, interview the user extensively to deeply understand the scope and goal of
each. When done, check the completed task in `todo.md`. Commit all changes and push to a new
branch, create a PR and merge it when the CI/CD turns green.

## Project priorities (do not erode)

1. **Simplicity** — prefer the solution that is easiest to understand, smallest, and most readable.
2. **Few dependencies** — runtime deps stay minimal (today `ejs`, `lucide-static`, `@larvit/log`).
   Prefer the Node standard library; justify any new dependency; do not add frameworks. The app is
   **stateless — no database**. Auth/identity/OAuth are **Ory sidecar services** (Kratos/Keto/Hydra,
   backed by Postgres), reached over their REST APIs with built-in `fetch` — no SDK. New
   capabilities ship as **plugin folders** under `plugins/` that fetch their data from upstream
   services, not as core code.
3. **Strict TypeScript** — `tsconfig.json` is strict (incl. `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `verbatimModuleSyntax`). Keep it that way. Prefer exact types;
   limit nullable and multi-option types.
4. **Environment-agnostic** — the app never asks *which environment* it runs in; no `NODE_ENV`
   branching. Every behaviour is an **explicit config toggle** (e.g. `CACHE_TEMPLATES`,
   `REQUIRE_SECURE_SECRETS`), read once in `src/config.ts`. Compose files set them per deployment.
5. **Semantic, accessible DOM** — use the right element for the job (landmarks, one `<h1>` per page
   + sane heading order, lists, `<table>` with row/column headers, `<fieldset>`/`<legend>`,
   `<button>` vs `<a>`); add ARIA only to fill real gaps (`aria-current`, `aria-sort`, labels).
   Classes/ids name *meaning*, not looks. Prefer native semantics over `div` + ARIA. New views and
   partials keep this bar.
6. **Full, parallel E2E** — every user-facing flow (each page, form, guard, plugin route) has a
   Playwright E2E test, shipped in the same change as the surface. Tests stay independent and
   side-effect-free so the suite runs `fullyParallel` — never serialise on shared state.
7. **Powerful, fail-loud plugins** — the plugin API is the product's main surface and the only way
   to add domain features. It optimises for being **powerful, predictable, and overloadable** (a
   plugin can take over as much of a page as it wants), and the host **fails loud at boot/discovery**
   (bad manifest, version mismatch, conflict) rather than sandboxing at runtime. Runtime
   crash-isolation is a deliberate **non-goal** — diagnose at deploy time, not in production.

## Deliberate architectural deviations (don't re-flag)

Intentional, reasoned choices — an architecture review should honor them, not re-raise them.
Revisit only if the stated reason stops holding.

### Structure & contracts

- **`src/` is grouped by concern**, not flat — `http/` (request pipeline), `auth/` (session-JWT hot
  path, guards, Ory REST clients), `i18n/` (locale resolution + catalogs), `plugin-host/`
  (discovery/router/hooks/view-resolver + the `plugin-api.ts` author barrel + `system.ts` behind
  `ctx.system`), `ui/` (design-system view-models + menu/chrome). `server.ts`/`config.ts`/`logger.ts`
  and the topology-guard `*.test.ts` stay at the root; tests are co-located. Add a new module to the
  folder owning its concern; don't reintroduce a flat tree. The core ships **no domain screens** —
  even the admin GUI is a drop-in plugin (`examples/plugins/admin/`).
- **Plugins and config import the host only via package.json `imports`** — `#plugin-api` →
  `src/plugin-host/plugin-api.ts`, `#menu-config` → `src/ui/menu-config.ts`, never a relative
  `../../src/*` path. These two barrels are the whole contract surface; the `src/*` behind them may
  be refactored freely. Don't "fix" a `#`-import back to a relative path. Two consequences:
  - `#plugin-api` re-exports the Ory client types (`KratosAdmin`/`KetoClient`/`HydraAdmin` + their
    DTOs and error classes), so those shapes are **contract-visible** — changing them needs a major
    `apiVersion` bump, not a free refactor.
  - **A plugin/config folder must stay a plain folder — no `package.json` of its own**, which would
    become its own scope and stop `#`-specifiers resolving. A plugin kept in its own repo therefore
    typechecks against the barrel only when mounted under the host tree (or with a vendored stub).
- **`examples/` mirrors the drop-in mount dirs** — `examples/plugins/<id>/` copies to `plugins/<id>/`,
  `examples/config/menu.ts` to `config/menu.ts`. Both mirrors are in `tsconfig.include` and resolve
  the host via `#`-imports, so each typechecks in place *and* copies across unchanged. Never commit
  real plugins/config into the root mount dirs — they ship empty.
- **`ctx.chrome` is lazily memoized — do not make it unconditional** or move it into the base request
  context. It protects the I/O-free hot path on the public, bot-hit landing (`/`). (Declined twice.)
- **A plugin-owned render always runs on that plugin's context.** The landing slots (`home`,
  `dashboard`) and an `onRequest` short-circuit build their context with `contextFor(pluginId)`
  exactly as a plugin route does — otherwise `ctx.t` is the core translator and the plugin's own keys
  render as bare keys on the pages it owns.
- **Email is delegated to Kratos** (it renders + sends recovery/verification mail); `web` never
  touches SMTP. Customization is Kratos' `courier.template_override_path`, not app code — keeping
  `web` stateless and dependency-light.

### Authorization

- **Vocabulary: `User` → `Group` → `Permission`, and there is no `Role`.** Keto ships no namespaces —
  all four in `ory/keto/namespaces.keto.ts` are ours. A permission is one operation ("read shifts");
  a role is a *bundle*, which here is just a group with several grants (groups nest). Ory's own
  "permission" (the `Resource` `permits`: view/edit/delete) is the separate per-row tier.
- **A permission name is always `<resource>:<action>`** — `scheduling:read`, `users:write`. A bare
  word names *who someone is* (a role), and roles are groups here; the old catch-all `admin` was
  exactly that mistake. **Enforced at discovery** (`isValidPermissionName` in `plugin-host/plugin.ts`,
  checked by `shapeError` over every route/nav `permission` and every declared name), fail-loud like
  any other manifest rule — not only in the admin GUI, which an operator removes by not copying it in.
  - **Names are authored in plugin code; only grants live in Keto.** The host collects every installed
    plugin's declarations into one catalog (`declaredPermissions` → `ctx.declaredPermissions`), and
    that catalog *is* the list the admin screens offer. Hence **no Permissions admin screen**: nothing
    in a GUI invents a name, and holding one is a property of a user or group, edited as a checkbox
    list there. A Keto tuple naming something no installed plugin declares gates nothing, is not
    offered, and is never revoked by an unrelated save — the picker only speaks for what it showed.
  - `<resource>` is **global, not plugin-scoped** (hence `oauth2-clients`, not `clients`): users are
    the *host's*, and cross-plugin sharing is a goal. Cost: collision-freedom is a convention rather
    than structural. Accepted — the alternative penalizes the sharing case.
  - **Declaring a permission stays optional.** Mandatory declaration would let `findConflicts` see all
    overlaps, but would then warn on exactly that legitimate sharing case. Shape is enforced;
    declaration is not.
  - `ADMIN_PERMISSIONS` **defaults to empty** (every permission is owned by the plugin gating on it),
    and **an unusable value is dropped with a warning, never fatal** — fail-loud belongs at the
    manifest boundary where a developer authored the mistake, whereas `bootstrap` gates `web`, so
    refusing operator env takes the whole stack down. `e2e-tests/compose.auth.yml` seeds a bad value
    so the container proves it survives one. The seed is a function of what `bootstrap` discovers, so
    a plugin dropped in after first boot needs `docker compose up -d` (re-runs the one-shot), not
    `restart web`. `bootstrap`'s matching `./plugins` mount belongs in `compose.override.yml` and
    nowhere else: in the base file it would desynchronise prod and collide with the e2e stacks, which
    bind individual plugins *inside* `/app/plugins` (a nested mount into a read-only parent is EROFS
    and the container never starts). Valid while bootstrap is the only writer of grants.
  - **`actionForMethod` is plugin-local and must not migrate into `#plugin-api`.** Inside the admin
    example it keeps the route table and the in-handler guard deriving from one function, so 29 routes
    × 2 gate sites cannot drift. Generalised, it would make authorization a function of the transport
    verb — a route table must answer "what does this need?" on its own.
- **A `:read`-only holder must never be shown a write affordance.** The list/detail models carry
  `canWrite` and the views drop create/save/delete/add/remove; the permission picker still renders,
  disabled, because *seeing* who holds what is the point of `:read`. A **write-intent GET** (a create
  form, a delete-confirm page) is the exception to `actionForMethod` and gates on `:write`, since a
  page whose only purpose is to start a write should refuse a reader rather than render a form whose
  submit 403s. Two grant-specific guards go with it: you cannot revoke your own **direct** grants
  (self-lockout would need a `curl` against Keto to undo), and a permission held *through a group*
  renders ticked-but-disabled, because unticked stated the opposite of the truth. **Known gap:** the
  group paths are unguarded — unticking a permission on a group you belong to, leaving it, or deleting
  it can still strip your own access. The robust "last effective holder" check needs a reverse Keto
  query and is deferred.
- **`users:write` and `groups:write` are equivalent to full administrative access**: `groups:write`
  adds you to any group, including one holding every permission; `users:write` mints a recovery code
  for any account. The containment the split buys is real on the **read** half only (`users:read` is
  a safe helpdesk grant). Don't let the per-resource naming imply otherwise in docs.
- **Plainpages says "user" everywhere; Ory's word is "identity".** Ory's own docs use the terms
  interchangeably, so this is house style, not a renamed concept. The single exception is the
  `Identity` DTO in `src/auth/kratos-admin.ts`, which mirrors Kratos' wire shape — don't rename it.

### i18n

- **The locale lives in the URL, never in a cookie.** `?locale=sv-SE` → `Accept-Language` → `en-US`,
  and when the URL asked for one the host carries it onto the links it renders. A cookie would make a
  page's language invisible in its address and unshareable; the cost is that a plugin wraps its own
  hrefs. Matching is exact on a full tag (`sv-FI` ≠ `sv-SE`), except that a lone language from
  `Accept-Language` takes the first regional catalog for it.
- **The core building blocks carry the locale; a plugin doesn't have to.** The shell (breadcrumbs),
  `pagination`, `filter-bar`, `data-table`, `auth-card`, `flow-body`, `field` and `menu` wrap every
  href in `localeHref`; nav and sign-in are wrapped in `chrome.ts`; the two GET forms carry it as a
  hidden `locale` input, since a GET submit replaces the whole query string. **A form's `action`
  counts as a link** — sign-out, consent and auth-card forms carry it too, or picking a language and
  then saving anything drops back to `Accept-Language`. Putting the obligation on each call site was
  tried and missed five of eight sites in one commit. `ctx.localeHref` remains for hrefs a plugin's
  own markup emits. The one round-trip that cannot carry it is the Kratos sign-in POST (absolute
  off-site URL).
- **`locale` is a host-owned query param** — in `parseListQuery`'s reserved set, so a localized list
  page doesn't hand a plugin a phantom `locale` filter. The i18n view locals (`t`, `locale`, `locales`,
  `localeHref`, `localeParam`, `localeSwitch`, `dir`) are likewise reserved, merged after a handler's
  `data` so a collision loses the key instead of breaking the shell.
- **Catalogs are checked at boot, not at render.** Every locale is compared against its set's `en-US`
  — keys, string-vs-plural kind, and the plural categories `Intl.PluralRules` requires — and a
  mismatch stops startup. A plugin may ship fewer locales than the host (its strings fall back to
  `en-US` per key), never one the host lacks.
- **`locales/` at the repo root is a drop-in mount**, like `plugins/` and `config/` — `locales/<tag>.ts`
  for the core, `locales/plugins/<id>/<tag>.ts` for a plugin; a new tag adds a language, an existing
  one replaces that catalog wholesale. Adding a language must never require forking the image. The
  SHIPPED `en-US` stays the parity baseline even when the mount replaces it, so a mounted catalog is
  checked rather than trusted (one compared only against itself would boot green with the whole UI
  rendering keys).
- **The language picker is on every page, POST-rendered ones included.** A POST-rendered URL often
  answers no GET (`POST /admin/users/:id/recovery`), so the host resolves the picker's target
  (`app.ts` → `switchBase`): this path when it answers GET, else the same-origin Referer, else `/`.
  Accepted cost: switching language there leaves that POST's own result behind. Valid while the picker
  is expected on literally every page — if that softens, hiding it after a POST is simpler.
- **An unknown translation key renders as itself.** That single rule lets a nav label, branding, or a
  menu `rename` be either a key or plain text without a second field or a migration. Don't "fix" it
  into a loud failure: a manifest with plain labels must keep working.
- **`t()` returns raw text; the view escapes it.** Messages go through `<%= %>` like any other value;
  one carrying markup uses `<%- %>`, and then its `{{vars}}` are escaped at the call site. Don't move
  escaping into `t()` — every other value in a view would become the odd one out.
- **RTL is out of scope until there is a real use case.** `textDirection` sets `<html dir>` because
  that is free and correct, but the stylesheet keeps physical `left`/`right` properties; a genuine RTL
  locale needs those moved to logical ones first. Don't convert the CSS or file findings about it on
  spec. Valid while no deployment needs an RTL language.

### UI

- **A dropdown is a `<button popovertarget>` + `[popover]`, never a `<details>`.** The browser then
  owns open/close — the only zero-JS way to dismiss by clicking outside — and the panel sits in the
  top layer, so a row kebab is no longer clipped by `.table-wrap`'s `overflow`. Four rules hold it
  together: the panel carries **`position-anchor: auto`** (a bare `anchor()` resolves to nothing in
  all three engines); it stays the trigger's **next sibling inside the `.menu` wrapper**, which the
  open-state style and the old-browser fallback both read; the partial **requires a caller-named `id`**
  and fails loud without one, since that is the `popovertarget` idref (generated ids were tried and
  rejected — nondeterministic HTML forecloses the caching decision); and **neither `aria-expanded` nor
  `aria-haspopup` is written**, because a zero-JS invoker cannot keep the first truthful and the second
  would promise `role="menu"` semantics these panels don't implement. `<details>` stays where it means
  disclosure rather than popup: the nav tree. `shell.ejs` hand-rolls the same block for the profile
  menu (its trigger composes escaped user values and its one item is a CSRF POST form, neither of which
  the partial's `Item` shapes cover) — keep the two in step.
- **`ICON_NAMES` (`src/ui/icons.ts`) is a host-owned registry, not a frozen plugin contract.** It is
  deliberately not re-exported from `#plugin-api`; README → Nav & permission gates tells an author that
  a new icon means registering it there. So the palette may narrow when the last reference to an id
  goes, and a plugin needing one gets it re-registered in the same change. Accepted cost: an unknown
  sprite id renders blank instead of failing loud (the `every icon <use> resolves` e2e test catches
  anything reaching the nav). Removing an id is a core edit — weigh it per icon rather than sweeping.

### Build, test & release

- **Deps install to `/node_modules`, above `WORKDIR /app`** — Node resolves upward, so dev's `.:/app`
  bind mount has nothing to shadow. Not a volume at `/app/node_modules`: the daemon creates a mount
  destination as root whatever `--user` says, leaving a root-owned dir in the checkout. Nothing may
  sit at that path now — it shadows `/node_modules` silently (`src/compose.test.ts` guards the compose
  files, `.dockerignore` the image).
- **A container that writes into the checkout runs as `--user "$(id -u):$(id -g)"`** — the E2E runner
  (artifacts) and a lockfile edit both do, or the output is root-owned and needs `sudo` to delete,
  which a dev box may not have at all. Two consequences: `e2e-tests/artifacts/` is *tracked*
  (`.gitkeep`), since an absent bind-mount source is daemon-created as root and that uid then cannot
  write it; and the runner image points `HOME` + npm's cache at `/tmp`, since an arbitrary uid has no
  home in it. Baking a `USER` in instead does not work — the image's `pwuser` is 1001, and no fixed
  uid matches every host. `src/compose.test.ts` guards every documented command, `src/ci-gate.test.ts`
  the gate's own.
- **Anything the browser logs fails the E2E test that provoked it.** Every spec takes its `test` from
  `e2e-tests/console-guard.ts`, which fails a test on a console error/warning or uncaught exception on
  any page it opened. A zero-JS app has nothing to say in the console, so the bar is *zero* rather than
  a curated tolerance list; the two exceptions are narrow — a module-level allowance for the COOP header
  Chromium drops (the e2e stacks serve plain http over container hostnames), and `allowConsole(re)` for
  a test whose own page provokes a message on purpose. `src/e2e-console-guard.test.ts` locks the wiring
  in the *unit* gate, since a spec importing `test` straight from Playwright — or minting a page with
  a raw `newPage()` instead of `watchedPage()` — would run unwatched and green. The buffer clears at
  teardown so a `beforeAll` is watched too; accepted cost is that a page outliving its test can log
  late and fail the next one.
- **The Ory-free specs run in all three engines; the Ory-backed ones stay on Chromium.**
  `visual.spec.ts` + `language.spec.ts` are side-effect-free, so parallel runs don't collide, and a
  console message only appears in the engine that renders the page (`ORY_FREE` in
  `e2e-tests/playwright.config.ts`). The rest write users, groups and sessions to one shared backend,
  so widening them means a stack per engine. Screenshots are written per project name.
- **The docs-only CI skip is `*.md` anywhere in the tree, not just the root.** No test, build step or
  workflow reads a markdown file, so a nested `examples/plugins/admin/README.md` edit is as safe to
  skip as `README.md`. Both git channels in `ci.sh`'s `docs_only()` pass `--no-renames`: rename
  detection names only the destination, so `git mv src/app.ts notes.md` otherwise read as docs and
  skipped the gate over a source file that was gone. `src/ci-gate.test.ts` locks the flags as a *text*
  guard — the test image ships neither `git` nor `bash`. Revisit if a `.md` ever becomes load-bearing.
- **CI docker logins share the runner host's Docker config.** The act_runner is host-mode, so
  `docker login`/`logout` in the workflows mutate one shared `~/.docker/config.json`: concurrent jobs
  can race (one job's logout can 401 another's push — recover by re-running), and tokens sit in that
  file between login and logout. Same class: concurrent runs share the workspace dir, so ci.sh's
  web-image build races another run's container creation on the `<project>-web` tag. Accepted for a
  single-maintainer cadence; serialize with a workflow `concurrency` group if it ever bites.
- **Plainpages is pre-announcement: no tags, no releases.** All tags and semver container tags were
  deleted, and `auto-release` is gated behind the `AUTO_RELEASE` Actions variable (unset ⇒ skipped,
  the fail-safe direction on every unknown-`vars` path). A version only communicates to consumers and
  there are none — the same reasoning that freezes `HOST_API_VERSION`. Two couplings: `registry-cleanup`
  keeps a hash image only while its commit is a branch head *or* release-tagged, so with zero tags a
  hand-cut tag must sit on `main`'s tip; and `mirror.yml` pushes tags with `--prune` (so its
  `fetch-tags: true` is load-bearing), meaning a tag or Release created on GitHub is swept away and
  releases are cut on Gitea only. Valid until the
  maintainer says Plainpages is ready to show people.
- **A stricter manifest rule breaks already-copied plugins, and while `HOST_API_VERSION` is frozen the
  failure names a symptom rather than the cause.** `plugins/` is an operator-owned drop-in mount, so an
  operator's copy is whatever version they took. `checkApiVersion` is the right mechanism — a breaking
  manifest change bumps the major and a stale plugin is refused by *version* — but that only works once
  the freeze lifts. Until then a stricter rule ships with a README → Upgrading entry and a re-copy hint
  in the discovery error. Fail-loud stays right either way: the alternative is a route gating on a name
  nobody can be granted, i.e. a permanent silent 403. **Valid while `HOST_API_VERSION` stays frozen.**

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

1. **First-time reader (top).** A one/two-sentence tagline, then a **Quick start** that gets the
   stack up and a *minimal* plugin live. Nothing comes before Quick start — no philosophy, no
   rationale. Keep its commands copy-pasteable; deeper detail lives in its own section, linked.
2. **Returning developer (rest).** A **Contents** ToC right after Quick start, then sections ordered
   by **what an adopter reaches for first**, not by architectural layering: Overview → Users, groups
   & permissions → Building plugins → menu/blocks/interactivity → Configuration → Auth → Email →
   Architecture → Testing → Production → Observability → JWT-rotation runbook → Project-layout file
   map → Extending. Place a new section by how early an adopter needs it. **Users, groups &
   permissions precedes Building plugins** because a manifest's `permission:` gate is unreadable
   without the model, and it is the one home for that model.

When editing: put content in the section it belongs to; keep the ToC in sync when you add/rename/
remove an `H2`/`H3`; state each fact in one home and link to it.

**Don't document internals here.** How a script reaches a decision, what a function guards — a
developer can read that off the code in seconds, and it only makes the README longer for humans and
machines alike. It belongs in the code, or nowhere. The README earns its length on what you cannot
dig out: how to use and operate Plainpages, the external contracts, and one-time setup. Same test
before adding a row to a table or the file map — a clause, not a paragraph.

## Rules

- Node 24 runs `.ts` directly (type stripping). Keep all TypeScript **erasable**
  (`erasableSyntaxOnly` is on): no `enum`, `namespace`, parameter properties, or decorators. Import
  local modules with their `.ts` extension.
- **No `.mjs`.** Write modules as `.ts` — even standalone scripts run in bare `node:24` containers
  (the e2e mock servers, `examples/shifts-upstream/server.ts`). If a file genuinely must be plain
  JavaScript, use `.js`; `"type": "module"` is set in both `package.json`s, so `.js` is ESM.
- **No build step** and no compiled artifacts — do not add a bundler or `tsc` emit.
- Before finishing a change, run the typecheck and tests above; both must pass.
- Tests use the built-in `node --test` runner — no test framework dependency.
- English everywhere. Keep code comments short and information-dense; self-explained code with no
  comment at all is preferred.
- Do not comment about history ("this moved from X"), or about the absence of things.
- Pin all dependencies and Docker images to exact, human-readable **semantic versions** — never
  ranges (`^`, `~`) and never digests. npm deps via `.npmrc` (`save-exact=true`) + `npm ci`; images
  by tag.
- **`HOST_API_VERSION` is frozen at 1.0.0 until the first external install**, even for additive
  contract changes. With no third-party plugin in the wild a bump can only produce noise. The
  promotion trigger is the first external plugin — from then on follow the versioning table in
  README → Contract versioning. **The frozen surface includes `views/partials/*.ejs`**: the view
  resolver makes every core partial an `include()` root for a plugin's views, so their option names
  and emitted markup are author-visible. Know the hole that leaves — discovery fails loud on a bad
  `apiVersion`, but `include("menu", { open: true })` silently ignores a dropped option. Promotion
  must cover the partial vocabulary too.
- A plugin's `apiVersion` is a **hand-written literal** semver — the host version it was built
  against — bumped by hand on rebuild, **never** the host's `HOST_API_VERSION` constant. Importing
  the constant makes every plugin always equal the host, so `checkApiVersion` can never fire.
- **Plugin route handlers are thin and per-route, keyed on `ctx.params`.** Register one handler per
  `{method, path}` in the manifest (the host extracts `:id`/`:name` and 404s malformed `%`-encoding).
  Don't funnel many routes into one dispatcher that re-parses `ctx.url.pathname`: it duplicates the
  URL shape, ignores the router's params, and has to re-handle HEAD. Factor shared per-request setup
  into a small `withX` wrapper — see `examples/plugins/admin/`.
- **`handleRequest` (`src/http/app.ts`) is a known complexity hotspot** — ~160 lines tracking
  canonical host, static, locale, session + re-mint, CSRF, chrome, hooks, plugin routing, builtin
  routing, 405/404 and error mapping. The pure parts are already extracted and separately tested;
  what remains is orchestration. Planned split along those seams; don't grow it further without
  taking one out.
- Reviews are maintainer-triggered (e.g. via the larv-review skill) — never auto-run reviewer agents.
- **A user-visible string belongs in a catalog, not in the code or a view.** Core strings go in
  `src/i18n/locales/en-US.ts` (then every other locale, or the boot fails); a plugin's go in its own
  `i18n/`. Operator/developer-facing text — boot errors, log messages, guard messages — stays English.
  A pure view-model builder takes an optional `t` defaulting to its own English, so a unit test reads
  in words; handlers pass `ctx.t`.
- **One verb per action in the English UI: sign in, sign out, create account.** Not "log in", "log
  out" or "sign up", inflections included — a second spelling for one button reads as a second thing;
  the noun ("a sign-in error") is unaffected. A plugin's catalog and every other locale follow the
  same rule in their own language. An unmapped Kratos id renders Kratos' own wording — map the id when
  it matters. **Held by the author, never by a test:** slightly different wording is often the right
  call, and a build-failing check takes that judgment away.
- Use well formed, standard compliant, rich URIs. Prefer state in the URL over POSTing it, for
  example on list pages with filters and pagination. Do `ids=x&ids=y`, not `ids[]=x&ids[]=y` and not
  `ids=x,y`.
