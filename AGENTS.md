# AGENTS.md

Guidance for AI agents and contributors working in this repo. Read `README.md` for
commands and layout.

## Project priorities (do not erode)

1. **Simplicity** — prefer the smallest, most readable solution.
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
   `exactOptionalPropertyTypes`, `verbatimModuleSyntax`). Keep it that way.
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
  (session-JWT hot path, guards, and the Ory REST clients), `admin/` (built-in screens),
  `plugin-host/` (discovery/router/hooks/view-resolver + the `plugin-api.ts` author barrel),
  and `ui/` (design-system view-models + menu/chrome); `server.ts`/`config.ts`/`logger.ts`
  and the topology-guard `*.test.ts` stay at the root. Tests are co-located (`foo.test.ts`
  beside `foo.ts`). Add a new module to the folder that owns its concern rather than to the
  root; don't reintroduce a flat tree.
- **`ctx.chrome` is lazily memoized — do not make it unconditional** or move it into the
  base request context. It protects the I/O-free hot path on the public, bot-hit landing
  (`/`). (Declined twice.)
- **Email is delegated to Kratos** (it renders + sends recovery/verification mail); `web`
  never touches SMTP. Customization is Kratos' built-in `courier.template_override_path`,
  not app code — keeping `web` stateless and dependency-light (see [Email](README.md#email)).

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
   Building plugins → menu/blocks/interactivity → Configuration → Auth → Email →
   Architecture → Testing → Production → Observability → the JWT-rotation runbook → the
   Project-layout file map → Extending. When adding a section, place it by this value (how
   early an adopter needs it), not by where it sits in the stack.

When editing: put content in the section it belongs to (don't prepend rationale above Quick
start); keep the ToC in sync when you add/rename/remove an `H2`/`H3`; and state each fact in
one home, linking to it rather than restating (credentials, env vars, rotation steps).

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
- English everywhere. Keep code comments short and information-dense.
- Pin all dependencies and Docker images to exact, human-readable **semantic
  versions** — never ranges (`^`, `~`) and never digests/hashes. npm deps are kept
  exact by `.npmrc` (`save-exact=true`) + `npm ci`; the base image by tag (e.g.
  `node:24.16.0-alpine3.24`).
- A plugin's `apiVersion` is a **hand-written literal** semver — the host version the
  plugin was built against — bumped by hand on rebuild, **never** the host's
  `HOST_API_VERSION` constant. Importing the constant makes every plugin always equal the
  host, so `checkApiVersion` can never fire and a breaking change slips through silently.
- Run the stability reviewer agent after every implementation of something that can be like
  a PR. That includes any change pushed directly to master.
  Skip this if the changes are purely documentation and/or comments.