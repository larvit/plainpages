# AGENTS.md

Guidance for AI agents and contributors working in this repo. Read `README.md` for
commands and layout.

## Prose discipline

Every word in this repo is read again on every future task, so prose is a recurring cost. On **any**
change, sweep the prose you touched — this file, `README.md`, the example READMEs, and code
comments — and cut it back to what a competent reader could not infer:

- **Delete history.** Git holds it. No "this moved from X", "used to be Y", "was tried and
  rejected", "(declined twice)", dated changelog entries, or the symptom that prompted a fix. Record
  the decision and the reason it *currently* turns on, nothing else.
- **Delete restatement.** A comment that says what the adjacent line says, a doc paragraph that
  re-explains a table above it, a file-map entry that expands the filename. The fix is deletion,
  not trimming.
- **Delete the self-evident** and anything already stated once elsewhere. **One home per fact** —
  link to it instead of repeating it; the same sentence in five files is five chances to drift.
- **Give every accepted risk an expiry** ("valid while X"), and delete the entry once X stops
  holding.
- **Keep** the surprising why, the footgun, the invariant, the external constraint, and the one-time
  setup a reader cannot dig out of the code. Once a line has earned its place, make it short and
  information-dense.

Trimming is not a separate task to schedule — do it in the same change, every time.

## How to work with tasks

Use the file `todo.md`.

For each todo item, interview the user extensively to deeply understand the scope and goal of
each. When done, check the completed task in `todo.md`. Commit all changes and push to a new
branch, create a PR and merge it when the CI/CD turns green.

## Project priorities (do not erode)

1. **Simplicity** — prefer the solution that is easiest to understand, smallest, and most readable.
2. **Few dependencies** — runtime deps stay minimal (today `ejs`, `lucide-static`, `@larvit/log`,
   `postgres`). Prefer the Node standard library; justify any new dependency; do not add frameworks.
   The **host is stateless — it owns no schema and stores nothing of its own**; a plugin may own a
   Postgres database, which the host provisions but never reads or writes inside. Auth/identity/OAuth are
   **Ory sidecar services** reached over their REST APIs with built-in `fetch` — no SDK. New
   capabilities ship as **plugin folders** under `plugins/` that get their data from an upstream
   service or their own database, not as core code.
3. **Strict TypeScript** — `tsconfig.json` is strict (incl. `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `verbatimModuleSyntax`). Keep it that way. Prefer exact types;
   limit nullable and multi-option types.
4. **Environment-agnostic** — no `NODE_ENV` branching. Every behaviour is an **explicit config
   toggle** read once in `src/config.ts`; compose files set them per deployment.
5. **Semantic, accessible DOM** — the right element for the job (landmarks, one `<h1>` per page +
   sane heading order, lists, `<table>` with row/column headers, `<fieldset>`/`<legend>`, `<button>`
   vs `<a>`); ARIA only to fill real gaps. Classes/ids name *meaning*, not looks.
6. **Full, parallel E2E** — every user-facing flow has a Playwright test, shipped in the same change
   as the surface. Tests stay independent and side-effect-free so the suite runs `fullyParallel`.
7. **Powerful, fail-loud plugins** — the plugin API is the product's main surface and the only way to
   add domain features. It optimises for being powerful, predictable and overloadable, and the host
   **fails loud at boot/discovery** rather than sandboxing at runtime. Runtime crash-isolation is a
   deliberate **non-goal**.

## Deliberate architectural deviations (don't re-flag)

Intentional, reasoned choices — an architecture review should honor them, not re-raise them.
Revisit only if the stated reason stops holding.

### Structure & contracts

- **`src/` is grouped by concern**, not flat — `http/`, `auth/`, `i18n/`, `plugin-host/`, `ui/`,
  with `server.ts`/`config.ts`/`logger.ts` and the topology-guard `*.test.ts` at the root; tests are
  co-located. Add a new module to the folder owning its concern. The core ships **no domain
  screens** — even the admin GUI is a drop-in plugin (`examples/plugins/admin/`).
- **Plugins and config import the host only through a barrel** — `@plainpages/plugin-api` →
  `plugin-api/index.ts` → `src/plugin-host/plugin-api.ts`, `#menu-config` → `src/ui/menu-config.ts`,
  never a relative `../../src/*` path. These two barrels are the whole contract surface; don't "fix"
  either back to a relative path. Three consequences:
  - `@plainpages/plugin-api` re-exports the Ory client types (`KratosAdmin`/`KetoClient`/`HydraAdmin` + their
    DTOs and error classes), so those shapes are **contract-visible** — changing them needs a major
    `apiVersion` bump, not a free refactor.
  - **The barrel is a package, not a `#`-import, so a plugin folder may carry its own
    `package.json`** and depend on npm packages (README → Plugin dependencies). The Dockerfile links
    it into `/node_modules`, above every plugin scope. Never let a copy reach a plugin's own
    `node_modules`: two instances of the barrel break `instanceof` across the boundary, which
    `plugin-api.test.ts` guards by asserting both paths reach one module.
  - **Plugin storage hands over credentials, not a client** (README → Plugin storage). The host takes
  `postgres` to run the provisioning DDL, and `storage-provisioning.ts` is the only module importing
  it — `storage.ts` beside it stays pure so `web` never loads a driver (`src/postgres.test.ts` guards
  both halves; the claim silently went false once already). It is never re-exported through the
  barrel, so no driver shape enters the contract. Three properties hold the design together, so
  don't trade one away in isolation: passwords are `HMAC-SHA256(PLUGIN_DB_SECRET, id)` rather than
  stored, which is what keeps the host stateless — whoever holds that secret holds every plugin
  database, so it ranks with the DB password itself; the provisioning DSN reaches `bootstrap` only
  (`src/compose.test.ts` guards the split); and provisioning never drops anything, so uninstalling a
  plugin cannot destroy data — boot logs the orphans instead. Because the host's copy sits in the
  ambient `/node_modules`, a plugin can `import "postgres"` without declaring it — incidental, not a
  packaging promise, and a plugin must still depend on its own driver.
- **The trust boundary is the `web` process, not the plugin.** Per-plugin databases and roles bound
  *accidents*, not hostile plugins: `PLUGIN_DB_SECRET` is in `web`'s environment during `onBoot`, and
  a plugin already holds `ctx.system`'s Ory admin clients — so cross-plugin DB isolation is
  containment, and README says so rather than implying a sandbox. Consistent with priority #7
  (crash-isolation is a non-goal). `server.ts` still deletes the secret from `process.env` right
  after `loadConfig`, which is before discovery imports any plugin module — the ordering is the whole
  point, so move it earlier if anything, **never later**. **Valid while plugins are
  operator-installed code, not third-party uploads.**
- **`bootstrap.ts` stays under `src/auth/`** even though it now provisions plugin databases as well
  as seeding Ory. It is the one-shot service's entrypoint, not an auth module; moving it to
  `src/bootstrap.ts` would edit `compose.yml`, five e2e compose files and `src/compose.test.ts` for a
  rename. Reconsider when a third seeding concern lands.
- **`BootContext.storage` keeps all six credential fields, and there is no `onShutdown` hook.** While
  `HOST_API_VERSION` is frozen both are free to revisit; after the freeze, adding is compatible and
  removing is not, so the shape errs small elsewhere. Pools handed to a plugin are reaped on process
  exit — revisit if a plugin ever needs an orderly drain. **Valid while the freeze holds.**
- **`config/` is still a plain dir — no `package.json` of its own**, or `#menu-config` resolves
    against that instead and boot fails loud. An operator's menu override has no use for
    dependencies; if that changes, it needs the same package treatment.
- **A plugin `package.json` without `"type": "module"` is refused, not warned.** Allowing it costs a
  warning and a re-parse per file, not a break — Node detects module syntax, so even a `.js` helper
  loads — and an operator on a read-only third-party mount cannot apply the remedy. Refused anyway
  because the direction is safe: refuse→warn relaxes freely, warn→refuse breaks installed plugins.
  **Valid while nothing is installed in the wild.**
- **`examples/` mirrors the drop-in mount dirs** — `examples/plugins/<id>/` copies to
  `plugins/<id>/`, `examples/config/menu.ts` to `config/menu.ts`. Both mirrors are in
  `tsconfig.include` and resolve the host through the barrels, so each typechecks in place *and*
  copies across unchanged. Never commit real plugins/config into the root mount dirs — they ship empty.
- **`ctx.chrome` is lazily memoized — do not make it unconditional** or move it into the base request
  context. It protects the I/O-free hot path on the public, bot-hit landing (`/`).
- **A plugin-owned render always runs on that plugin's context.** The landing slots (`home`,
  `dashboard`) and an `onRequest` short-circuit build their context with `contextFor(pluginId)`
  exactly as a plugin route does — otherwise `ctx.t` is the core translator and the plugin's own keys
  render as bare keys on the pages it owns.
- **Email is delegated to Kratos** (it renders + sends recovery/verification mail); `web` never
  touches SMTP. Customization is Kratos' `courier.template_override_path`, not app code.

### Authorization

- **Vocabulary: `User` → `Group` → `Permission`, and there is no `Role`.** Keto ships no namespaces —
  all four in `ory/keto/namespaces.keto.ts` are ours. A permission is one operation ("read shifts");
  a role is a *bundle*, which here is just a group with several grants (groups nest). Ory's own
  "permission" (the `Resource` `permits`: view/edit/delete) is the separate per-row tier.
- **A permission name is always `<resource>:<action>`** — `scheduling:read`, `users:write`. A bare
  word names *who someone is* (a role), and roles are groups here. **Enforced at discovery**
  (`isValidPermissionName` in `plugin-host/plugin.ts`, checked by `shapeError` over every route/nav
  `permission` and every declared name), fail-loud like any other manifest rule — not only in the
  admin GUI, which an operator removes by not copying it in.
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
  - `ADMIN_PERMISSIONS` **defaults to empty**, and **an unusable value is dropped with a warning,
    never fatal** — fail-loud belongs at the manifest boundary where a developer authored the
    mistake, whereas `bootstrap` gates `web`, so refusing operator env takes the whole stack down
    (`e2e-tests/compose.auth.yml` seeds a bad value to prove the container survives one). The seed is
    a function of what `bootstrap` discovers, so a plugin dropped in after first boot needs
    `docker compose up -d`, not `restart web`. `bootstrap`'s matching `./plugins` mount belongs in
    `compose.override.yml` and nowhere else: in the base file it would desynchronise prod and collide
    with the e2e stacks, which bind individual plugins *inside* `/app/plugins` (a nested mount into a
    read-only parent is EROFS and the container never starts). Valid while bootstrap is the only
    writer of grants.
  - **`actionForMethod` is plugin-local and must not migrate into `@plainpages/plugin-api`.** Inside the admin
    example it keeps the route table and the in-handler guard deriving from one function, so 29 routes
    × 2 gate sites cannot drift. Generalised, it would make authorization a function of the transport
    verb — a route table must answer "what does this need?" on its own.
- **A `:read`-only holder must never be shown a write affordance.** The list/detail models carry
  `canWrite` and the views drop create/save/delete/add/remove; the permission picker still renders,
  disabled, because *seeing* who holds what is the point of `:read`. A **write-intent GET** (a create
  form, a delete-confirm page) is the exception to `actionForMethod` and gates on `:write`. Two
  grant-specific guards go with it: you cannot revoke your own **direct** grants (self-lockout would
  need a `curl` against Keto to undo), and a permission held *through a group* renders
  ticked-but-disabled, because unticked stated the opposite of the truth. **Known gap:** the group
  paths are unguarded — unticking a permission on a group you belong to, leaving it, or deleting it
  can still strip your own access. The robust "last effective holder" check needs a reverse Keto
  query and is deferred.
- **`users:write` and `groups:write` are equivalent to full administrative access**: `groups:write`
  adds you to any group, including one holding every permission; `users:write` mints a recovery code
  for any account. The containment the split buys is real on the **read** half only (`users:read` is
  a safe helpdesk grant). Don't let the per-resource naming imply otherwise in docs.
- **Plainpages says "user" everywhere; Ory's word is "identity".** House style, not a renamed
  concept. The single exception is the `Identity` DTO in `src/auth/kratos-admin.ts`, which mirrors
  Kratos' wire shape — don't rename it.

### i18n

- **The locale lives in the URL, never in a cookie.** `?locale=sv-SE` → `Accept-Language` → `en-US`,
  and when the URL asked for one the host carries it onto the links it renders. A cookie would make a
  page's language invisible in its address and unshareable; the cost is that a plugin wraps its own
  hrefs. Matching is exact on a full tag (`sv-FI` ≠ `sv-SE`), except that a lone language from
  `Accept-Language` takes the first regional catalog for it.
- **The core building blocks carry the locale; a plugin doesn't have to.** The shell, `pagination`,
  `filter-bar`, `data-table`, `auth-card`, `flow-body`, `field` and `menu` wrap every href in
  `localeHref`; nav and sign-in are wrapped in `chrome.ts`; the two GET forms carry it as a hidden
  `locale` input, since a GET submit replaces the whole query string. **A form's `action` counts as a
  link** — sign-out, consent and auth-card forms carry it too, or picking a language and then saving
  anything drops back to `Accept-Language`. The obligation stays on the building block, never on each
  call site. `ctx.localeHref` remains for hrefs a plugin's own markup emits. The one round-trip that
  cannot carry it is the Kratos sign-in POST (absolute off-site URL).
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
  locale needs those moved to logical ones first. Valid while no deployment needs an RTL language.

### UI

- **A dropdown is a `<button popovertarget>` + `[popover]`, never a `<details>`.** The browser then
  owns open/close — the only zero-JS way to dismiss by clicking outside — and the panel sits in the
  top layer, so a row kebab is not clipped by `.table-wrap`'s `overflow`. Four rules hold it
  together: the panel carries **`position-anchor: auto`** (a bare `anchor()` resolves to nothing in
  all three engines); it stays the trigger's **next sibling inside the `.menu` wrapper**, which the
  open-state style and the old-browser fallback both read; the partial **requires a caller-named
  `id`** and fails loud without one, since that is the `popovertarget` idref (never generate one —
  nondeterministic HTML forecloses the caching decision); and **neither `aria-expanded` nor
  `aria-haspopup` is written**, because a zero-JS invoker cannot keep the first truthful and the
  second would promise `role="menu"` semantics these panels don't implement. `<details>` stays where
  it means disclosure rather than popup: the nav tree. `shell.ejs` hand-rolls the same block for the
  profile menu (its trigger composes escaped user values and its one item is a CSRF POST form) — keep
  the two in step.
- **`ICON_NAMES` (`src/ui/icons.ts`) is a host-owned registry, not a frozen plugin contract**, so it
  is deliberately not re-exported from `@plainpages/plugin-api`. The palette may narrow when the last reference
  to an id goes, and a plugin needing one gets it re-registered in the same change. Accepted cost: an
  unknown sprite id renders blank instead of failing loud (the `every icon <use> resolves` e2e test
  catches anything reaching the nav).

### Build, test & release

- **Deps install to `/node_modules`, above `WORKDIR /app`** — Node resolves upward, so dev's `.:/app`
  bind mount has nothing to shadow. Not a volume at `/app/node_modules`: the daemon creates a mount
  destination as root whatever `--user` says, leaving a root-owned dir in the checkout. Nothing may
  sit at that path now — it shadows `/node_modules` silently (`src/compose.test.ts` guards the compose
  files, `.dockerignore` the image).
- **A container whose output a human then edits or deletes runs as `--user "$(id -u):$(id -g)"`** —
  the E2E runner (artifacts) and a lockfile edit, or the output is root-owned and needs `sudo`, which
  a dev box may not have. Not universal: `bootstrap` writes `jwks.json` as root when it is absent on
  first boot; the committed dev key makes that rare, and when it happens the rotation runbook's
  host-side `>` needs the file re-owned first (valid while the dev key ships committed). Three
  consequences: `e2e-tests/artifacts/` is *tracked* (`.gitkeep`), since an absent bind-mount source is
  daemon-created as root and that uid then cannot write it (README → Upgrading); the runner image sets
  `HOME=/tmp`, since an arbitrary uid has no passwd entry and would land on an unwritable `/`; and
  rootless Docker wants the flag *dropped*, container root already being the invoking user. Baking a
  `USER` in instead does not work — the image's `pwuser` is 1001 and no fixed uid matches every host.
  `src/compose.test.ts` guards every documented command, `src/ci-gate.test.ts` the gate's own.
- **Anything the browser logs fails the E2E test that provoked it.** Every spec takes its `test` from
  `e2e-tests/console-guard.ts`, which fails a test on a console error/warning or uncaught exception on
  any page it opened. A zero-JS app has nothing to say in the console, so the bar is *zero* rather than
  a curated tolerance list; the two exceptions are narrow — a module-level allowance for the COOP header
  Chromium drops (the e2e stacks serve plain http over container hostnames), and `allowConsole(re)` for
  a test whose own page provokes a message on purpose. `src/e2e-console-guard.test.ts` locks the wiring
  in the *unit* gate, since a spec importing `test` straight from Playwright — or minting a page with
  a raw `newPage()` instead of `watchedPage()` — would run unwatched and green. Accepted cost: a page
  outliving its test can log late and fail the next one.
- **The Ory-free specs run in all three engines; the Ory-backed ones stay on Chromium.**
  `visual.spec.ts` + `language.spec.ts` are side-effect-free, so parallel runs don't collide, and a
  console message only appears in the engine that renders the page (`ORY_FREE` in
  `e2e-tests/playwright.config.ts`). The rest write users, groups and sessions to one shared backend,
  so widening them means a stack per engine.
- **The docs-only CI skip is `*.md` anywhere in the tree, not just the root** — no test, build step or
  workflow reads a markdown file. Both git channels in `ci.sh`'s `docs_only()` pass `--no-renames`:
  rename detection names only the destination, so `git mv src/app.ts notes.md` would otherwise read as
  docs and skip the gate over a source file that was gone. `src/ci-gate.test.ts` locks the flags as a
  *text* guard — the test image ships neither `git` nor `bash`. Revisit if a `.md` ever becomes
  load-bearing.
- **CI docker logins share the runner host's Docker config.** The act_runner is host-mode, so
  `docker login`/`logout` in the workflows mutate one shared `~/.docker/config.json`: concurrent jobs
  can race (one job's logout can 401 another's push — recover by re-running), and tokens sit in that
  file between login and logout. Same class: concurrent runs share the workspace dir, so ci.sh's
  web-image build races another run's container creation on the `<project>-web` tag. Accepted for a
  single-maintainer cadence; serialize with a workflow `concurrency` group if it ever bites.
- **Plainpages is pre-announcement: no tags, no releases.** `auto-release` is gated behind the
  `AUTO_RELEASE` Actions variable (unset ⇒ skipped, the fail-safe direction on every unknown-`vars`
  path) — a version only communicates to consumers and there are none. Two couplings:
  `registry-cleanup` keeps a hash image only while its commit is a branch head *or* release-tagged, so
  with zero tags a hand-cut tag must sit on `main`'s tip; and `mirror.yml` pushes tags with `--prune`
  (its `fetch-tags: true` is load-bearing), so a tag or Release created on GitHub is swept away and
  releases are cut on Gitea only. Valid until the maintainer says Plainpages is ready to show people.
- **A stricter manifest rule breaks already-copied plugins**, and while `HOST_API_VERSION` is frozen
  the failure names a symptom rather than the cause — `checkApiVersion` would refuse a stale plugin by
  *version*, but only once the freeze lifts. Until then a stricter rule ships with a README →
  Upgrading entry and a re-copy hint in the discovery error. Fail-loud stays right either way: the
  alternative is a route gating on a name nobody can be granted, i.e. a permanent silent 403.
  **Valid while `HOST_API_VERSION` stays frozen.**

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
   stack up and a *minimal* plugin live. Nothing comes before Quick start. Keep its commands
   copy-pasteable; deeper detail lives in its own section, linked.
2. **Returning developer (rest).** A **Contents** ToC right after Quick start, then sections ordered
   by **what an adopter reaches for first**, not by architectural layering: Overview → Users, groups
   & permissions → Building plugins → menu/blocks/interactivity → Configuration → Auth → Email →
   Architecture → Testing → Production → Observability → JWT-rotation runbook → Project-layout file
   map → Extending. Place a new section by how early an adopter needs it. **Users, groups &
   permissions precedes Building plugins** because a manifest's `permission:` gate is unreadable
   without the model, and it is the one home for that model.

Keep the ToC in sync when you add/rename/remove an `H2`/`H3`. **Don't document internals** — how a
script reaches a decision, what a function guards; a developer reads that off the code in seconds.
The README earns its length on how to use and operate Plainpages, the external contracts, and
one-time setup. A file-map or table row gets a clause, not a paragraph.

## Rules

- Node 24 runs `.ts` directly (type stripping). Keep all TypeScript **erasable**
  (`erasableSyntaxOnly` is on): no `enum`, `namespace`, parameter properties, or decorators. Import
  local modules with their `.ts` extension.
- **No `.mjs`.** Write modules as `.ts` — even standalone scripts run in bare `node:24` containers.
  If a file genuinely must be plain JavaScript, use `.js`; `"type": "module"` is set in both
  `package.json`s, so `.js` is ESM.
- **No build step** and no compiled artifacts — do not add a bundler or `tsc` emit.
- Before finishing a change, run the typecheck and tests above; both must pass.
- Tests use the built-in `node --test` runner — no test framework dependency.
- English everywhere.
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
- **The frozen surface also includes the packaging promises** (README → Plugin dependencies): the
  barrel is ambient at `/node_modules` with nothing for a plugin to declare, `"type": "module"` is
  mandatory, and the host neither upgrades nor dedupes a plugin's dependencies. Same hole as the
  partials — move the publish point, rename the package or start hoisting and every installed plugin
  breaks with no version signal. Note the promise is deliberately *not* "your deps are yours alone":
  build-time dedupe for baked images stays open, module-instance sharing stays unpromised.
- **Publishing `@plainpages/plugin-api` to a registry is deferred, not rejected.** Today it is
  `private` and shaped as a shim — `index.ts` re-exports `../src/…`, so `npm pack` would ship a
  broken tree. The trigger is the same as the freeze's: the first external plugin, which is also the
  first author who cannot typecheck against a mounted host tree. Whoever does it must first make the
  artifact self-contained (types-only `.d.ts`, or move the barrel into `plugin-api/`).
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

## Comments

Default to **no comment**. Delete one that restates the adjacent code, repeats a convention used
elsewhere, justifies self-evident code, or records history. Write one only for what a competent
reader of *this* codebase could not infer: a surprising why, a footgun, an invariant, an external
constraint. See [Prose discipline](#prose-discipline).
