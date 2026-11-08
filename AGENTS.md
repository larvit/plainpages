# AGENTS.md

Guidance for AI agents and contributors working in this repo. Read `README.md` for
commands and layout.

## Prose discipline

Every word in this repo is read again on every future task, so prose is a recurring cost. On **any**
change, sweep the prose you touched — this file, `README.md`, the example READMEs, and code
comments — and cut it back to what a competent reader could not infer:

- **Delete history.** Git holds it. No "this moved from X", "used to be Y", "was tried and
  rejected", "(declined twice)", dated changelog entries (a decision's date in `docs/decisions.md`
  is not one), or the symptom that prompted a fix. Record the decision and the reason it
  *currently* turns on, nothing else.
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
   **A page is a document**: it scrolls, and the chrome scrolls with it. Nothing may bound the
   viewport to hold content still — no `height: 100dvh` frame, no `overflow: hidden` on `body`, no
   `position: sticky` header. Each such box buys an app-like look with CSS the next reader has to
   reverse-engineer, and is one more thing to undo before the content under it can be reached.
   Overlays are not this: the skip link, the mobile off-canvas nav and its scrim sit *above* the
   document rather than holding it still, and have no other spelling — the document keeps scrolling
   behind the open nav, accepted rather than overlooked. Only the document scroller gets keyboard
   paging unconditionally and back/forward scroll restoration, and a page a box clips fails silently:
   nothing in a test or a console says content is unreachable below the fold.
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

## Decisions

Each title below is an entry in `docs/decisions.md`, with its reasoning and the premise it rests
on; a review honours them.

### Structure & contracts

- `src/` is grouped by concern, and the core ships no domain screens
- Plugins and config import the host only through the two barrels
- The Ory client types are contract-visible through the barrel
- The barrel is a package, so a plugin folder may carry its own `package.json`
- Plugin storage hands over credentials, not a client
- Plugin settings are declared, not discovered
- The trust boundary is the `web` process, not the plugin
- `ory/postgres/init/init.sql` is the only home for the Ory databases' ACL
- `bootstrap.ts` stays under `src/auth/`
- `BootContext.storage` keeps all six credential fields, and there is no `onShutdown` hook
- `config/` is a plain dir with no `package.json` of its own
- A plugin `package.json` without `"type": "module"` is refused, not warned
- `examples/` mirrors the drop-in mount dirs
- `ctx.chrome` is lazily memoized, never built unconditionally
- A plugin-owned render always runs on that plugin's context
- Email is delegated to Kratos

### Authorization

- The vocabulary is `User` → `Group` → `Permission`, and there is no `Role`
- A permission name is always `<resource>:<action>`, enforced at discovery
- Permission names are authored in plugin code; only grants live in Keto
- A permission's `<resource>` is global, not plugin-scoped
- Declaring a permission stays optional
- `ADMIN_PERMISSIONS` defaults to empty, and an unusable value is dropped with a warning
- `actionForMethod` is plugin-local and stays out of `@plainpages/plugin-api`
- A gate is one of `public`, `session` or `permission`, named exactly once
- The reference plugin's two shift pages duplicate a view model and markup
- A `:read`-only holder is never shown a write affordance
- `users:write` and `groups:write` each amount to full administrative access
- The CSRF token is unbound to the session
- Plainpages says "user" everywhere, where Ory says "identity"

### i18n

- The locale lives in the URL, never in a cookie
- The core building blocks carry the locale, so a plugin doesn't have to
- `locale` and the i18n view locals are reserved by the host
- Catalogs are checked at boot, not at render
- `locales/` at the repo root is a drop-in mount
- The language picker is on every page, POST-rendered ones included
- An unknown translation key renders as itself
- `t()` returns raw text, and the view escapes it
- RTL is out of scope until there is a real use case

### UI

- A dropdown is a `<button popovertarget>` and a `[popover]`, never a `<details>`
- The document is the one scroller
- `ICON_NAMES` is a host-owned registry, not a plugin contract

### Build, test & release

- Dependencies install to `/node_modules`, above `WORKDIR /app`
- A container whose output a human then edits or deletes runs as the invoking user
- Anything the browser logs fails the E2E test that provoked it
- The Ory-free specs run in all three engines; the Ory-backed ones stay on Chromium
- The docs-only CI skip is `*.md` anywhere in the tree
- CI docker logins share the runner host's Docker config

## Docker only — no host tooling

**Everything** (install, typecheck, test, run, build, deploy) goes through Docker /
Docker Compose. **Never run `node`, `npm`, or `tsc` on the host.**

```bash
docker compose up                                       # dev server, live reload
docker compose run --rm --no-deps web npm run typecheck  # strict type check (--no-deps: skip Ory)
docker compose -f compose.yml -f e2e-tests/compose.visual.yml run --user "$(id -u):$(id -g)" --rm --no-deps --build e2e npm run typecheck  # the E2E specs
docker compose run --rm --no-deps web npm test           # tests
docker compose -f compose.yml up --build -d              # production
```

## README structure (keep it this way)

`README.md` serves two readers, in this order — preserve it when editing:

1. **First-time reader (top).** A one/two-sentence tagline, then a **Quick start** that gets the
   stack up and a *minimal* plugin live. Nothing comes before Quick start. Keep its commands
   copy-pasteable; deeper detail lives in its own section, linked.
2. **Returning developer (rest).** A **Contents** ToC right after Quick start, then sections ordered
   by **what an adopter reaches for first**, not by architectural layering: Goals → Audience → Overview → Glossary → Users, groups
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
- Before finishing a change, run the typechecks and tests above; all must pass.
- Tests use the built-in `node --test` runner — no test framework dependency.
- English everywhere.
- Pin all dependencies and Docker images to exact, human-readable **semantic versions** — never
  ranges (`^`, `~`) and never digests. npm deps via `.npmrc` (`save-exact=true`) + `npm ci`; images
  by tag.
- **Touching dependencies means revisiting `renovate.json`.** `Release-Bump` is an *allowlist*: its
  rules name exactly what carries the trailer, so a dependency outside them never escalates the
  release version and nothing fails to say so. A new manifest, compose file, custom manager or dep
  type is a decision: can it reach a running Plainpages? If yes it needs a rule; if no, record nothing
  and let it ride the next patch.
- **`HOST_API_VERSION` *is* the release version.** Its `major.minor` must equal the release tag's, and
  both release paths refuse a tag that disagrees (`release-tooling/contract-version.ts`). The patch
  digit may lag on purpose: `checkApiVersion`
  ignores patch, and auto-release cuts patch releases with no commit to bump a constant in. So a
  dependency update big enough to force a **minor** is plugin-visible by definition — `auto-release`
  stops rather than tagging, and the fix is to bump `HOST_API_VERSION` to that `X.Y.0` in a PR, merge
  it, then tag. Never bump it to "catch up" with a patch release. **The contract surface
  includes `views/partials/*.ejs`** — the view resolver makes every core partial an `include()` root
  for a plugin's views, so their option names and emitted markup are author-visible. Know the hole
  that leaves: discovery fails loud on a bad `apiVersion`, but `include("menu", { open: true })`
  silently ignores a dropped option, so the partial vocabulary is a surface the version check cannot
  police for you.
- **The contract surface also includes the packaging promises** (README → Plugin dependencies): the
  barrel is ambient at `/node_modules` with nothing for a plugin to declare, `"type": "module"` is
  mandatory, and the host neither upgrades nor dedupes a plugin's dependencies. Same hole as the
  partials — move the publish point, rename the package or start hoisting and every installed plugin
  breaks with no version signal. Note the promise is deliberately *not* "your deps are yours alone":
  build-time dedupe for baked images stays open, module-instance sharing stays unpromised.
- **Publishing `@plainpages/plugin-api` to a registry is deferred, not rejected.** Today it is
  `private` and shaped as a shim — `index.ts` re-exports `../src/…`, so `npm pack` would ship a
  broken tree. The trigger is the first plugin author outside this repo — the first who cannot
  typecheck against a mounted host tree. Whoever does it must first make the artifact self-contained
  (types-only `.d.ts`, or move the barrel into `plugin-api/`).
- A plugin's `apiVersion` is a **hand-written literal** semver — the host version it was built
  against — bumped by hand on rebuild, **never** the host's `HOST_API_VERSION` constant. Importing
  the constant makes every plugin always equal the host, so `checkApiVersion` can never fire.
- **Plugin route handlers are thin and per-route, keyed on `ctx.params`.** Register one handler per
  `{method, path}` in the manifest (the host extracts `:id`/`:name` and 404s malformed `%`-encoding).
  Don't funnel many routes into one dispatcher that re-parses `ctx.url.pathname`: it duplicates the
  URL shape, ignores the router's params, and has to re-handle HEAD. Factor shared per-request setup
  into a small `withX` wrapper — see `examples/plugins/auth-admin/`.
- **A function stays within 50 lines and complexity 20** (ESLint's defaults, measured by
  `src/function-limits.test.ts`). Split one that outgrows them; never add it to the test's
  `grandfathered` list or raise a ceiling there.
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
- Use well formed, standard compliant, rich URIs. **State lives in the URL or on the server, never in
  a cookie.** Prefer state in the URL over POSTing it, for example on list pages with filters and
  pagination. A message for the page a redirect lands on rides its query string — `info-msg`,
  `warn-msg`, `error-msg` — since a fragment never reaches the server. A cookie carries only what
  must be bound to the browser: the session (`plainpages_jwt`) and the CSRF token (`plainpages_csrf`).
  Do `ids=x&ids=y`, not `ids[]=x&ids[]=y` and not `ids=x,y`.

## Comments

Default to **no comment**. Delete one that restates the adjacent code, repeats a convention used
elsewhere, justifies self-evident code, or records history. Write one only for what a competent
reader of *this* codebase could not infer: a surprising why, a footgun, an invariant, an external
constraint. See [Prose discipline](#prose-discipline).

## Scoring run

The comprehension panel's seats fill their prompts from these fields.

- **Language:** strict TypeScript on Node 24, with EJS views and plain CSS
- **Kind:** a server-rendered web GUI host with a plugin system
- **Domain:** web authentication, authorization and server-rendered admin GUIs
- **Domain docs:** the Ory Kratos, Keto and Hydra documentation
- **3am question:** a visitor on an old TV browser reports that the sign-in button is blank. Which file and rule?
