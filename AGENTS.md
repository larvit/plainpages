# AGENTS.md

Guidance for AI agents and contributors working in this repo. Read `README.md` for
commands and layout.

## Project priorities (do not erode)

1. **Simplicity** — prefer the smallest, most readable solution.
2. **Few dependencies** — runtime deps stay minimal (today `ejs` + `lucide-static`).
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

## Docker only — no host tooling

**Everything** (install, typecheck, test, run, build, deploy) goes through Docker /
Docker Compose. **Never run `node`, `npm`, or `tsc` on the host.**

```bash
docker compose up                                       # dev server, live reload
docker compose run --rm --no-deps web npm run typecheck  # strict type check (--no-deps: skip Ory)
docker compose run --rm --no-deps web npm test           # tests
docker compose -f compose.yml up --build -d              # production
```

## Rules

- Node 24 runs `.ts` directly (type stripping). Keep all TypeScript **erasable**
  (`erasableSyntaxOnly` is on): no `enum`, `namespace`, parameter properties, or
  decorators. Import local modules with their `.ts` extension.
- **No build step** and no compiled artifacts — do not add a bundler or `tsc` emit.
- Before finishing a change, run the typecheck and tests above; both must pass.
- Tests use the built-in `node --test` runner — no test framework dependency.
- English everywhere. Keep code comments short and information-dense.
- Pin all dependencies and Docker images to exact, human-readable **semantic
  versions** — never ranges (`^`, `~`) and never digests/hashes. npm deps are kept
  exact by `.npmrc` (`save-exact=true`) + `npm ci`; the base image by tag (e.g.
  `node:24.16.0-alpine3.24`).
