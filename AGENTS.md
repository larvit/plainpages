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
  (session-JWT hot path, guards, and the Ory REST clients), `plugin-host/`
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
- **Plainpages says "user" everywhere; Ory's word for it is "identity".** Kratos calls the record
  an identity, but Ory's own docs state it uses that term *interchangeably* with "users" and
  "accounts" — so this is house style, not a renamed concept, and "user" is the word readers
  already know (Nielsen's heuristic #2: match between the system and the real world). One note in
  README → Auth records the mapping so nobody has to rediscover it. The single exception is the
  `Identity` DTO in `src/auth/kratos-admin.ts`, which mirrors Kratos' wire shape and keeps Ory's
  name — don't rename that one.
- **CI docker logins share the runner host's Docker config.** The act_runner is host-mode, so
  `docker login`/`logout` in the workflows mutate one shared `~/.docker/config.json`:
  concurrent jobs can race (one job's logout can 401 another's push — recover by re-running),
  and tokens sit in that file between login and logout. Same class: concurrent runs share the
  workspace dir, so ci.sh's web-image build races another run's container creation on the
  `<project>-web` tag. Accepted for a single-maintainer cadence; serialize with a workflow
  `concurrency` group if it ever bites.

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
- Reviews are maintainer-triggered (e.g. via the larv-review skill) — never auto-run reviewer
  agents. Decided 2026-08-02, replacing the earlier run-after-every-implementation rule.
- Use well formed, standard compliant, rich URIs. Prefer state in the URL over POST:ing in for
  for example list pages with filters and pagination. Do: "ids=x&ids=y" and not "ids[]=x&ids[]=y"
  and not "ids=x,y".
