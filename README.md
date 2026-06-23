# Plainpages

A self-hostable **foundation for admin and operational web UIs** — the kind of
back-office you build for a webshop, a scheduling system for schools, a water
treatment plant, or any tool where staff register, find, and work with data.

Plainpages gives you the parts that are the same every time — **authentication,
authorization, a config-driven menu, and a server-rendered, zero-JS design
system** — and lets you add everything domain-specific by **dropping in plugin
folders**. The only screens it ships itself are the ones for running the system:
**users, groups, and permissions**. Everything else is a plugin.

Priorities (unchanged from day one): **simplicity, few dependencies, strict
TypeScript, no build step, Docker-only, environment-agnostic** (no `NODE_ENV` —
every behaviour is an explicit config toggle). Heavy lifting that *isn't* simple to do
well — identity, sessions, SSO, OAuth2, permission checks — is delegated to **Ory**
sidecar services rather than reinvented.

"Simple" here is about the **whole architecture staying simple** — not just at the
start, but after you've dropped in 240 plugins and run it hard in production. The
shape doesn't change as it grows: every plugin is the same self-contained folder,
the hot path is the same I/O-free JWT check, and there's no app database to scale
or migrate.

## Who this is for

**Experienced developers building back-office, admin, and dashboard products** — for
their own use or for a client. You know HTTP, Docker, and identity providers, and
you'd rather assemble pages from building blocks than fight a framework or hand-roll
auth for the tenth time. Plainpages hands you the boring-but-hard parts (auth, authz,
menu, design system, plugin host) and stays out of your domain logic. It's not a
no-code tool and doesn't hide its moving parts: if "Ory is down ⇒ no logins" (see
[Auth](#auth-sessions--permissions)) reads as obvious rather than a surprise,
you're the audience.

## Project goals

Plainpages deliberately targets **low-end systems, odd hardware, and low-bandwidth
environments** — a tablet on a factory floor, an old thin client at a reception desk,
a remote site on a flaky link. That's *why* the baseline is boring, standards-compliant
**HTML + CSS** with zero JavaScript: it loads fast, degrades gracefully, and works on
whatever browser is already there. Where a modern **CSS** feature removes the need for
JavaScript (theme switching, popovers, disclosure) we use it — the trade we avoid is
shipping a client-side runtime, not using the platform. That standards-first stance also
makes **semantic, accessible markup** a priority: real landmarks, one `<h1>` per page,
lists and tables with proper headers, a skip link, and ARIA (`aria-current`/`aria-sort`)
only where the platform leaves a gap (see [AGENTS.md](AGENTS.md)).

> **Status.** The full architecture this README describes is built and exercised end-to-end by the
> Playwright suites: the Node 24 + EJS server, the zero-JS **design system** (app shell, nav tree, data
> table, filters, pagination, forms), the **plugin host** (discovery, router, per-plugin views + static,
> the `config/menu.ts` override + branding), the **Ory stack** (Postgres, Kratos + the session→JWT
> tokenizer, Keto, Hydra), the **auth** wiring that consumes it (themed sign-in / register / reset /
> SSO, the session→JWT hot path, the users/groups/roles admin screens), **Hydra's login / consent /
> logout handlers**, and **production & ops hardening** (the prod compose profile, response security
> headers, **structured logging + OTLP observability**, the
> **[JWT key-rotation runbook](#jwt-signing-key--rotation)**).

## The MVP — "clone, one command, hack on a plugin"

The bar for a first usable release: **clone, run one command, get a working
register/login, and start building your own plugin** — no manual key generation, no
hand-edited Ory config, no separate database. That command brings up the whole stack
(web + Ory + Postgres), generates signing keys, seeds an admin on first boot, and drops
you at a public landing page with a one-click path to sign in (the gated dashboard lives at
`/dashboard`); from there you copy the example plugin folder and write your own page. SSO and
the OAuth2-provider role (Hydra) come after — not required to start.

## Architecture

Plainpages runs as a small set of containers, orchestrated by Docker Compose:

| Container      | Role |
| -------------- | ---- |
| `web`          | The Node 24 + TypeScript app: server-rendered EJS, the plugin host, the building-block partials. Stays tiny. |
| `kratos`       | **Ory Kratos** — identity: login, registration, password reset, SSO, sessions. |
| `keto`         | **Ory Keto** — permissions: the authorization decisions (`can user X do Y on Z?`). |
| `hydra`        | **Ory Hydra** — OAuth2/OIDC provider, so other apps can log in *through* plainpages. |
| `postgres`     | **Ory's** storage only (Kratos/Keto/Hydra). The `web` app never connects to it. |

The `web` app is an Ory **relying party**: it never stores passwords. At login it
turns the Kratos session into a short-lived, **locally-validated JWT** (the Kratos
session tokenizer) carrying the user's coarse roles — so every later request gates
the menu and pages by **verifying the JWT in-process, with no per-request call to
Ory**. Keto answers the rarer fine-grained checks; Hydra is used only when the app
acts as an OAuth2 **login & consent provider** for other apps. It reaches the Ory
services over their **REST APIs using Node's built-in `fetch`** — no SDK
dependency. See [Auth, sessions & permissions](#auth-sessions--permissions).

So the `web` app is **stateless** and its npm footprint stays tiny — a small,
pinned set of runtime deps (today **`ejs`** for templating, **`lucide-static`**
for icons, and **`@larvit/log`** — itself zero-dependency — for structured/OTLP
logging), grown only with justification and never a framework. Auth, sessions,
SSO, and OAuth2 add *services*, not npm packages; data lives upstream (see
[Stateless — no application database](#stateless--no-application-database)).

## What's included vs. what you add

- **Included:** sign-in / register / reset (themed, Kratos-backed), and the admin
  screens for **users, groups, permissions** (users via Kratos, the relationship
  graph via Keto).
- **You add:** everything domain-specific, as **plugins** — a list page, a form, a
  scheduler, a register, a dashboard. Plugins get the same building blocks the
  built-in screens use.

## Requirements

- Docker
- Docker Compose

That's it. Do not install or run Node/npm on the host — use the commands below.

## Development

```bash
docker compose up            # http://localhost:3000, live reload via `node --watch`
```

`docker compose up` brings up the full stack — web + Postgres + Kratos/Keto/Hydra —
merging `compose.override.yml`, which mounts the source and restarts the server on
change. A one-shot `bootstrap` service then seeds first-boot state with **zero manual
prep** — it generates the JWT signing key if absent, creates a demo admin
(`admin@plainpages.local` / `admin`) in Kratos, and grants it the `admin` role plus every
discovered plugin's declared permission tokens in Keto, so permission checks (and any dropped-in
plugin) resolve out of the box; it is idempotent, so every `up` re-runs it
safely. It finishes by printing a banner with the login URL and seeded credentials.
**Change the demo admin before production.** The web app waits for Kratos + Keto
to be healthy *and* the bootstrap to finish before starting (each Ory service has a
readiness healthcheck). Dev publishes the host-facing Ory ports —
Kratos public `4433` (the browser POSTs self-service flows there) and Hydra public
`4444`; prod (`docker compose -f compose.yml up`) keeps them internal. Kratos
recovery/verification emails are caught by **mailpit** in dev — read the codes at
http://localhost:8025. To work on your own plugin, see
[Where plugins live](#where-plugins-live-and-how-to-mount-them).

## Configuration

Read from the environment once at boot (`src/config.ts`) and validated there — a bad
URL, an out-of-range `PORT`, a non-boolean toggle, or a missing/throwaway enforced secret
fails loud before the server starts. A clean clone needs **none** of these; every value
defaults to the dev stack.

The app is **environment-agnostic**: there is no `NODE_ENV`. Behaviour that used to flip
on "production" is now its own explicit toggle, so a deployment turns on exactly what it
wants. `compose.yml` (base) sets the hardened toggles; `compose.override.yml` (dev,
auto-merged by `docker compose up`) turns them back off for live editing.

| Var | Default | Notes |
| --- | --- | --- |
| `APP_URL` | _unset_ (dev: `http://localhost:3000`) | the canonical public URL — the **single source** for the host this deployment lives on; set ⇒ off-host visitors are redirected here, unset ⇒ no redirect (see [Canonical host](#canonical-host-one-public-url)) |
| `PORT` | `3000` | web listen port |
| `CACHE_TEMPLATES` | `false` | cache compiled EJS templates (`true` in prod) |
| `SECURE_COOKIES` | `false` | mark our session/CSRF cookies `Secure` (`true` in prod https; off in dev http) |
| `REQUIRE_SECURE_SECRETS` | `false` | when `true`, `CSRF_SECRET` must be supplied and differ from the dev throwaway |
| `LOG_LEVEL` | `info` | min severity logged: `error`/`warn`/`info`/`verbose`/`debug`/`silly`/`none` |
| `LOG_FORMAT` | `text` | log line format: `text` (human-readable, dev) or `json` (structured, prod) |
| `SERVICE_NAME` | `plainpages` | OTLP `service.name` on every log + span — brand it as your own deployment |
| `OTLP_ENDPOINT` | _unset_ | OpenTelemetry Collector HTTP base URI; set ⇒ export logs + traces (unset ⇒ console only) |
| `OTLP_PROTOCOL` | `http/json` | OTLP wire format: `http/json` or `http/protobuf` |
| `KRATOS_PUBLIC_URL` / `KRATOS_ADMIN_URL` | `http://kratos:4433` / `:4434` | identity (self-service / admin) |
| `KETO_READ_URL` / `KETO_WRITE_URL` | `http://keto:4466` / `:4467` | permission check / write |
| `HYDRA_ADMIN_URL` | `http://hydra:4445` | OAuth2 provider admin API (login/consent handshake) |
| `JWKS_URL` | `file://…/tokenizer/jwks.json` | the Kratos tokenizer signing key; verifies the session JWT |
| `JWT_ISSUER` / `JWT_AUDIENCE` | _unset_ | optional: when set, the session JWT's `iss` / `aud` must match (the dev tokenizer sets neither) |
| `JWT_CLOCK_SKEW_SEC` | `60` | exp/nbf leeway (s) for Kratos↔web clock drift (the auth E2E sets `0`) |
| `ORY_TIMEOUT_SEC` | `5` | per-call timeout for outbound Kratos/Keto/Hydra (and http JWKS) fetches, so a hung Ory can't park a request |
| `REVOCATION_DENYLIST` | `false` | when `true`, enable the optional [instant role/session revoke denylist](#instant-revoke-the-optional-denylist) |
| `REVOCATION_TTL_SEC` | `900` | how long a revoke entry lives; keep ≥ tokenizer TTL (10m) + clock skew |
| `CSRF_SECRET` | dev throwaway | signs our double-submit CSRF token; enforced by `REQUIRE_SECURE_SECRETS` |

### Canonical host (one public URL)

A site is often reachable at several URLs that resolve to the same place — `localhost` vs
`127.0.0.1`, an apex vs `www.`, an IP vs a domain. That matters here because **cookies are
host-scoped**: the themed login form POSTs to Kratos, and Kratos' CSRF cookie is set on the host the
browser is on. Reach the app on one host but let the form post from another and that cookie is lost —
Kratos rejects the flow and bounces to its error page. (The original symptom: open the banner's
`http://localhost:3000`, sign in, land on `http://127.0.0.1:3000/error` "Page not found".)

`APP_URL` is the **single source of truth** for the public host. Set it and the web app **redirects
any off-host GET/HEAD visitor to it** (308, path + query preserved) *before* a flow starts, so the
browser, the themed forms, and the cross-origin Kratos POST all share one cookie host. Static assets
under `/public/` are served on any host (so health checks don't bounce). Everything else derives from
the same `APP_URL`: the first-run banner, and — via compose — Kratos' browser-facing URLs
(`compose.override.yml` maps `${APP_URL}` onto every `ui_url`, return URL, and `allowed_return_urls`).
Set `APP_URL` and the whole stack follows; there is no second place to edit. A genuine Kratos flow
error now renders a themed **`/error`** page (a path back to sign-in), not the catch-all 404.

The redirect is an **explicit opt-in** (per the no-`NODE_ENV` rule): **unset ⇒ no redirect**, so a
deploy that forgets `APP_URL` never bounces real users to a stale default. The clean clone still works
with zero config because the bundled Kratos and the dev stack both default to `localhost` (the dev
override sets `APP_URL=http://localhost:3000`); browse `localhost:3000` and login just works, and
`127.0.0.1` is canonicalised onto it.

> **Behind a reverse proxy:** the proxy must pass the public `Host` through (or rewrite Kratos'
> `base_url`/`ui_url`s to match what the browser sees). If it rewrites `Host` to an internal upstream
> name while `APP_URL` is the public domain, the canonical redirect will loop — preserve `Host`.
>
> **Dev caveat (custom host).** Only if you point `APP_URL` at a non-default host (e.g. a LAN IP to
> test from a tablet) must you also point the dev-published Kratos port at that host: set
> `KRATOS_PUBLIC_BROWSER_URL=http://<that-host>:4433/` (it shares `APP_URL`'s host but keeps the Ory
> port, so it can't be `APP_URL` verbatim). In production Ory is fronted same-origin, so this doesn't arise.

### What you must supply (the only manual prep)

A clean clone needs **none** of the above — `docker compose up` brings up the whole
stack with dev-throwaway secrets, an auto-generated signing key, and a seeded admin
(see [Development](#development)). Exactly **two** things can't be auto-generated, and
**both are production-only** — neither blocks a clean clone:

1. **Production secrets** — replace the committed dev throwaway `CSRF_SECRET` (env), plus the
   **JWT signing key** (mount a real `jwks.json` or set
   `…_JWKS_URL` — see [JWT signing key & rotation](#jwt-signing-key--rotation)). Set
   `REQUIRE_SECURE_SECRETS=true` and the app refuses to boot until `CSRF_SECRET` is
   supplied and differs from the throwaway.
2. **SSO provider client id/secret** — **optional**; password login works without them.
   Supplying a provider's creds via env activates it; no creds ⇒ no SSO button (see
   [Social sign-in (SSO)](#social-sign-in-sso)).

Everything else is generated or seeded on first boot — Ory migrations, the dev signing
key, the demo admin identity and its Keto roles, the Keto OPL model — so there is nothing
else to hand-configure.

### Social sign-in (SSO)

Off by default — a clean clone is password-only. Kratos activates a provider purely
from the environment (no code, no rebuild): set `SELFSERVICE_METHODS_OIDC_ENABLED=true`
and `SELFSERVICE_METHODS_OIDC_CONFIG_PROVIDERS` to a JSON array of providers (`google`,
`microsoft`, …), each carrying its `client_id`/`client_secret` and referencing the
committed claims mapper `ory/kratos/oidc/claims.jsonnet`. The themed sign-in/register
pages derive one button per provider from the live flow's `oidc` nodes, so no creds ⇒ no
provider ⇒ no button, and the whole SSO section disappears when none are configured — no
code change to add or remove one. Open-source Kratos has **no native SAML** — front it
with an OIDC bridge (Ory Polis) and register that bridge as a generic OIDC provider the
same way.

### JWT signing key & rotation

The session tokenizer signs each session→JWT with an **ES256** key at
`ory/kratos/tokenizer/jwks.json`. The committed one is a **dev throwaway** (like the
cookie/cipher secrets in `kratos.yml`) — a clean clone works; **never run it in
production**. Mint a fresh key with the bundled generator:

```bash
docker compose run --rm -T --no-deps web node src/gen-jwks.ts > ory/kratos/tokenizer/jwks.json
```

**Install in production.** Two endpoints must read the *same* key material:

- **Kratos (signer)** — mount the file over `…/tokenizer/jwks.json`, or set
  `SESSION_WHOAMI_TOKENIZER_TEMPLATES_PLAINPAGES_JWKS_URL=base64://<the JWKS JSON, base64>`.
- **web (verifier)** — `JWKS_URL` (default `file://…/tokenizer/jwks.json`). A `file://`
  set is re-read live (5-min TTL, plus an immediate reload on an unknown `kid`); a
  `base64://` set is immutable and rotates only on a web redeploy. **For rotation, use
  `file://` on the web side** so it picks up new keys without a restart.

**Why rotation is zero-downtime.** Kratos signs with the **first** key in the set and
stamps its `kid` in each JWT header; web selects the verify key by that `kid`. So a
set can hold the new key *and* the old one at once — tokens minted before and after the
swap both verify.

#### Scheduled rotation

The token TTL is **10 min** (`kratos.yml` → `whoami.tokenizer.…ttl`); the wait window
below is one TTL + clock skew, round up to **~12 min**. Run from the repo root (paths are
container-relative; with the dev bind-mount they edit the real file).

1. **Prepend a fresh key** (new key first, old key kept) — write via a temp file so the
   shell's `>` can't truncate the input before it's read:
   ```bash
   docker compose run --rm -T --no-deps web sh -c \
     'node src/gen-jwks.ts --prepend ory/kratos/tokenizer/jwks.json' > /tmp/jwks.json \
     && mv /tmp/jwks.json ory/kratos/tokenizer/jwks.json
   ```
2. **Restart Kratos** so it signs with the new first key: `docker compose restart kratos`.
   (web needs no restart — it hot-reloads the file. The hot path verifies JWTs locally, so
   a brief Kratos blip only touches login/re-mint.)
3. **Verify** new logins mint the new `kid` — decode the `plainpages_session` cookie's JWT
   header, or watch web's logs for a `jwks reload on kid miss` debug line as old clients
   present the new key.
4. **Wait ~12 min**, then **prune** the superseded key:
   ```bash
   docker compose run --rm -T --no-deps web sh -c \
     'node src/gen-jwks.ts --prune ory/kratos/tokenizer/jwks.json' > /tmp/jwks.json \
     && mv /tmp/jwks.json ory/kratos/tokenizer/jwks.json
   ```
   No Kratos restart needed — it already signs with that key; this only drops a now-unused
   verify key.

**Rollback** (before the prune): the old key is still in the set, so revert step 1's file
and `restart kratos` — in-flight tokens never broke.

#### Emergency rotation (key compromise)

Skip the overlap — you want every token signed with the leaked key to die now. **Replace**
the set with a single fresh key (no `--prepend`):

```bash
docker compose run --rm -T --no-deps web node src/gen-jwks.ts > ory/kratos/tokenizer/jwks.json
docker compose restart kratos
```

Every existing JWT now fails signature verification → its bearer falls back to anonymous
and must re-authenticate (the re-mint only covers *expired* tokens, not bad signatures,
so a forged/leaked-key token can't be silently refreshed). The instant-revoke denylist
 is unnecessary here — the signature itself is already invalid.

## Type check & tests

```bash
docker compose run --rm --no-deps web npm run typecheck   # strict tsc --noEmit
docker compose run --rm --no-deps web npm test            # node --test (units)
```

`--no-deps` keeps these off the Ory stack — units need no Postgres/Kratos/Keto, and `web`
otherwise drags up its `depends_on` services.

### End-to-end (Playwright)

E2E runs in the official Playwright image (browsers preinstalled) against the live `web`
service — no Node/browsers on the host. There are four suites:

**Visual + design system** (`visual.spec.ts`) — Ory-free, so it stays fast. It screenshots the live
pages and asserts the rendered design system — the app shell, theme switch, mobile off-canvas layout,
icon sprite, CSRF-guarded sign-out, the public landing, the 404 page, and plugin permission-gating.

```bash
docker compose -f compose.yml -f compose.e2e.yml run --build --rm e2e   # run the suite
docker compose -f compose.yml -f compose.e2e.yml down -v                 # tear down after
```

**Auth — token timeout + refresh** (`auth-refresh.spec.ts`) — the full-stack counterpart: it
boots the real Ory stack (Postgres + Kratos + Keto + bootstrap), shortens the session→JWT TTL to
8s (`ory/kratos/e2e.yml`) and sets `JWT_CLOCK_SKEW_SEC=0`, then logs in the seeded admin and proves
the "stay signed in" hot path: the lapsed JWT is silently **re-minted** from the live Kratos
session (roles re-read from Keto), and once that session is revoked the stale cookie is **cleared**.

```bash
docker compose -f compose.yml -f compose.e2e-auth.yml run --build --rm e2e   # run the suite
docker compose -f compose.yml -f compose.e2e-auth.yml down -v                 # tear down after
```

**OAuth2 login + consent** (`oauth-login.spec.ts`) — another app logs in *through* us: it boots the
real stack (incl. Hydra), registers an OAuth2 client, starts an authorization flow, and drives the
handlers end-to-end — `/oauth2/login` bounces an unauthenticated user to the themed login and
**accepts** the challenge once a Kratos session exists; `/oauth2/consent` then shows the consent
screen for the third-party client and **Allow** drives Hydra to issue the authorization code.

```bash
docker compose -f compose.yml -f compose.e2e-oauth.yml run --build --rm e2e   # run the suite
docker compose -f compose.yml -f compose.e2e-oauth.yml down -v                 # tear down after
```

**Full browser flow** (`full-flow.spec.ts`) — the real Playwright UI against the live stack: the
themed **password login** and a **mocked-SSO** login (an in-network mock OIDC provider,
`e2e/mock-oidc.mjs`), **menu filtering by role**, the **users/groups/roles** admin CRUD, a
permission-gated **plugin page**, and **logout**. Because the themed form posts straight to Kratos
and cookies are host-scoped, a tiny same-origin gateway (`e2e/proxy.mjs`) fronts web + Kratos on one
host (`ory/kratos/e2e-proxy.yml` points Kratos at it) — exactly as a production reverse proxy would.

```bash
docker compose -f compose.yml -f compose.e2e-full.yml run --build --rm e2e   # run the suite
docker compose -f compose.yml -f compose.e2e-full.yml down -v                 # tear down after
```

`--build` rebuilds the runner so spec edits are always picked up (the image bakes in `e2e/`).

**Dev-stack login regression** (`devstack-login.spec.ts`) — drives the *plain* `docker compose up`
topology (not the same-origin gateway above) with the runner on the **host network**, so the browser
sees `http://localhost:3000` (web) and `http://127.0.0.1:4433` (Kratos public) exactly as a host
browser does. It signs in the seeded admin from the URL the first-run banner advertises
(`http://localhost:3000`) **and** from the wrong host (`http://127.0.0.1:3000`), asserting both reach
the dashboard signed in — the latter via the [canonical-host redirect](#canonical-host-one-public-url).
It guards against the regression where the advertised login URL dumps the user on the `/error` "Page
not found" page; the proxied full-flow suite can't catch this (it fronts web + Kratos on one origin).
Part of `scripts/ci.sh` — it needs host networking and the host ports `3000`/`4433` free (Linux).

```bash
docker compose -f compose.yml -f compose.override.yml -f compose.e2e-devstack.yml run --build --rm e2e   # run it
docker compose -f compose.yml -f compose.override.yml -f compose.e2e-devstack.yml down -v                # tear down
```

Screenshots + an HTML report land in `e2e/artifacts/` (git-ignored). Every user-facing flow
is covered end-to-end; tests are independent and run **fully in parallel** for speed
([AGENTS.md](AGENTS.md) §6) — keep new tests side-effect-free so the suite stays fast.

### The full gate (one command)

`scripts/ci.sh` is the whole gate in one reproducible command — typecheck → unit tests → each E2E
suite against its own fresh stack, with a guaranteed `down -v` after each (even on failure) and a
non-zero exit on the first failure. Run it locally before a release, or wire it into your CI service:

```bash
bash scripts/ci.sh
```

Each E2E suite **owns a clean stack** — never point two suites at one backend (auth-refresh revokes
the admin's sessions; full-flow writes users/groups/roles to Keto), which is why the gate runs them
serially, one stack up/down per suite.

## Building a plugin

A plugin is a folder under `plugins/`. The host discovers it at boot — no
registration step, no central wiring. The full, authoritative API surface —
manifest shape, handler/`RequestContext` contract, versioning, conflict rules,
hooks, and the dev/test story — is **[docs/plugin-contract.md](docs/plugin-contract.md)**
(`src/plugin.ts` holds the types). A complete, runnable reference ships in
**[`plugins/scheduling/`](plugins/scheduling/)** — a public overview page, a permission-gated
list page fetching upstream data, a CSRF-guarded form forwarding writes upstream, and a mix of
public + role-gated nav. Copy it and adapt. The sketch below is the shape.

There are two replaceable landing slots: `/` is a **public** front page (default: an intro with
sign-in / register links) and `/dashboard` is the **gated** post-login app home (default: the People
list). A plugin owns either by exporting a `home` (public `/`) or `dashboard` (gated `/dashboard`)
handler — one owner each. See the contract's
[landing pages section](docs/plugin-contract.md#the-landing-pages-home--dashboard).

```
plugins/scheduling/      # folder name = the plugin id; mounted at /scheduling
  plugin.ts              # default export: the typed manifest (see below)
  views/                 # EJS templates for this plugin's pages
    shifts.ejs
  public/                # CSS / assets, served under /public/scheduling/
    scheduling.css
```

The manifest is **TypeScript** — typed, commented, no separate schema to keep in
sync. The `id` and mount path are **derived from the folder name**, not declared:

```ts
import { definePlugin } from "../../src/plugin-api.ts"; // the stable author barrel (see docs)
import { listShifts, overview } from "./shifts.ts";

export default definePlugin({
  apiVersion: "1.0.0",      // semver of the host contract this was built against (a literal — see docs)

  // Nav fragment, composed into the global menu. Permission-gated: items the current user can't
  // access are hidden. `public: true` shows an item to everyone (signed in or not). Arbitrary
  // depth. `icon` is a Lucide icon by its sprite id (src/icons.ts).
  nav: [
    {
      label: "Scheduling", icon: "i-cal",
      children: [
        { label: "Overview", href: "/scheduling", public: true },             // shown to everyone
        { label: "Shifts", href: "/scheduling/shifts", permission: "scheduling:read" },
      ],
    },
  ],

  // Route handlers, mounted under the plugin's path (/scheduling). `permission` is a coarse role
  // (a JWT-claim check) enforced before the handler runs; `public: true` makes a page reachable by
  // anyone (mutually exclusive with `permission`).
  routes: [
    { method: "GET", path: "/", public: true, handler: overview },
    { method: "GET", path: "/shifts", permission: "scheduling:read", handler: listShifts },
  ],
});
```

The handler (`listShifts`) fetches its data from an upstream service and renders
it — the plugin holds no state of its own (see below); the reference points
`SCHEDULING_UPSTREAM` at its backend (the dev compose ships a tiny mock,
`examples/shifts-upstream/`). A `view` result renders against the native app shell
via **`ctx.chrome`** (branding, the global nav, the signed-in user), and a write form
guards itself with **`ctx.verifyCsrf`** + the token in `ctx.chrome.csrfToken`. It logs
through **`ctx.log`** and traces upstream calls with **`ctx.log.fetch`** (or `tracedFetch`),
joining the request's trace (see [Observability](#observability)). Each plugin is
**self-contained** (its own nav, routes, views, CSS), so installing one is "drop the
folder, restart." An operator stays in control via a central override.

### Where plugins live (and how to mount them)

The host scans **`/app/plugins/`** inside the `web` container — so "installing a
plugin" means getting its folder there. There are two ways, depending on where the
plugin's source lives:

**1. In your clone (the default dev loop).** Create `plugins/<id>/` in the working
tree. `docker compose up` already bind-mounts the whole tree (`compose.override.yml`:
`.:/app`), so the folder is live in the container — restart to pick it up. This is the
"copy the example plugin and go" path.

**2. A plugin kept in its own repo, or added to a prebuilt image.** Bind-mount the
plugin folder onto `/app/plugins/<id>` with a small compose override. Plugins are
stateless, so mount it read-only:

```yaml
# compose.plugins.yml — mount external plugin folders into the host
services:
  web:
    volumes:
      - ../scheduling-plugin:/app/plugins/scheduling:ro   # host path : /app/plugins/<id>
```

```bash
# Dev: list the files explicitly (a third file disables the implicit override merge)
docker compose -f compose.yml -f compose.override.yml -f compose.plugins.yml up
# Prod (image already built, no source mount):
docker compose -f compose.yml -f compose.plugins.yml up -d
```

A named volume or volume container works the same way (target `/app/plugins/<id>`),
but a bind mount matches the edit-and-reload loop. For a **baked** production image,
just keep the plugin in the build context and it's `COPY`'d in at build time — pinned
and reproducible; mount a volume only to add plugins to an already-built image.

> Discovery — scanning `plugins/`, importing each `plugin.ts` default export, and validating
> it (id, `apiVersion`, conflicts) — runs at boot (`src/discovery.ts`); a bad plugin stops
> startup with a precise message. The router (`src/router.ts`) then mounts each route at `/<id>`,
> resolves `:name` params, runs the permission gate, and turns the handler's `RouteResult` into
> the response; a `view` result renders `plugins/<id>/views/<view>.ejs` (`src/view-resolver.ts`),
> which may `include()` the core building-block partials. A plugin's `public/` assets are served
> at `/public/<id>/` (`src/static.ts`). The mount mechanics above are how the files get into the
> container either way.

## The menu system

The menu is **driven entirely by config** and assembled from two sources:

1. **Plugin fragments** — each plugin contributes its own `nav` (above).
2. **A central override** — `config/menu.ts` (loaded by `src/menu-config.ts`, validated at boot)
   — where the operator reorders, renames, groups, or hides items (by node `id`), and sets
   branding (app name, logo, default theme). The override always wins, applied before the
   per-user filter. A clean clone needs no `config/menu.ts`; defaults apply.

Every nav item may carry a `permission`; the rendered tree is **filtered per
user** by reading the roles in the session JWT (no per-request authz call — see
[Auth, sessions & permissions](#auth-sessions--permissions)), so the menu
only ever shows what that person can reach. An item (or a whole page) may instead be
marked **`public: true`** to show it to **everyone, signed in or not** — the blessed,
explicit way to expose a public page and its menu entry (a no-permission item is already
public; `public` just says so on purpose, and is mutually exclusive with `permission`).
The markup is the recursive, zero-JS
nav tree from the design foundation (header/leaf × clickable/static, counts,
arbitrary depth). Branding (name, logo, default theme) renders in the app shell — the sidebar
brand shows the configured logo (else a default mark), and the theme sets the theme-switch default.

**One menu, one shell, everywhere.** There is a single menu (`src/chrome.ts` `buildPluginChrome`),
rendered by the same app shell on **every** page — the dashboard, the admin screens, plugin pages,
and the login / registration / recovery / front (`/`) pages. So it looks identical signed in or out;
it just shows fewer items to an anonymous visitor (only `public` ones, plus a Sign-in link), filtered
by the same per-user rule. The sidebar collapses to a burger on a narrow screen. A page that wants a
focused, chrome-free layout (e.g. a print view) opts out with the shell's `menu: false`.

## Email

The only emails are the **recovery** and **verification** codes from Kratos' self-service flows, and
**Kratos renders and sends them** (delegated, like the rest of identity — `web` never touches SMTP).
Dev catches them in **mailpit** (http://localhost:8025); prod points Kratos at a real server via
`COURIER_SMTP_CONNECTION_URI` (`courier.smtp` in `ory/kratos/kratos.yml`).

**Customizing the email content** is a built-in Kratos feature — no code here. Set
`courier.template_override_path` to a mounted directory and drop Go templates in it, keyed by type:

```
<override-path>/recovery_code/valid/email.subject.gotmpl
<override-path>/recovery_code/valid/email.body.gotmpl        (+ email.body.plaintext.gotmpl)
<override-path>/verification_code/valid/email.subject.gotmpl
<override-path>/verification_code/valid/email.body.gotmpl
```

The `ory/kratos/` tree is already mounted into the Kratos container, so an override dir there is the
simplest place. See Ory's [courier message templates](https://www.ory.sh/docs/kratos/emails-sms/custom-message-templates)
docs for the full template-type list and the data each template receives.

## Building blocks

Plainpages is a **component library, not a page generator** — you assemble pages from partials
and helpers rather than declaring a schema and getting magic. The vocabulary is a set of reusable
EJS partials + TS helpers, fully styled and zero-JS:

- **Partials:** app shell, nav tree, filter bar, data table (sort / select / row
  actions), pagination, form fields, badges, menus, auth cards.
- **Helpers:** `composeNav` (menu from config), `parseListQuery`
  (`?q=…&status=…&sort=…&page=…` → filter/sort/pagination), `paginate` (page math), and the auth
  guards a handler calls to authorize (`src/guards.ts`): `requireSession` (assert a session — a
  `GuardError` the host turns into a redirect to sign in), `can(role)` (a coarse JWT-claim check,
  zero I/O), `check(relation, object)` (the one live Keto call, for relationship rules).

## Interactivity: zero-JS spine, opt-in enhancement

The core and all building blocks **work with zero JavaScript** — menus, theme
switching, and filtering are pure CSS + GET forms. On the [low-end, low-bandwidth
targets](#project-goals) we care about this is usually *faster*: a round-trip returning
a small, pre-rendered HTML page beats a client-side runtime that must boot, fetch JSON,
and re-render before anything shows. List state (`?q=…&status=…&sort=…&page=…`) lives
**in the URL**, so a view is bookmarkable, shareable, and reproducible — the URL is the
only state the UI keeps.

Plugins that genuinely need it — live dashboards, bulk actions, client-side
validation — may **opt into progressive enhancement** (htmx, Alpine, or vanilla
JS) on top of working server-rendered HTML. The baseline never depends on it.

## Auth, sessions & permissions

Identity comes from **Kratos**; the hot path stays I/O-free by carrying coarse
authorization in a **locally-validated JWT**, and **Keto** is reserved for the rare
fine-grained, must-be-fresh check.

### Login → session JWT (the Kratos session tokenizer)

The themed sign-in / register / reset / SSO screens drive Kratos self-service flows.
**SSO is optional and self-configuring:** each provider's button renders only when its
credentials are present, and the whole SSO section disappears when none are configured —
leaving plain password login. A developer never has to touch SSO to get started. On
success, rather than keeping the opaque Kratos cookie and calling `whoami` on every
request, the app **exchanges the session for a signed JWT once** via the Kratos
**session tokenizer** (`whoami` with a `tokenize_as` template) and stores it as the
session cookie.

```
  ── AT LOGIN / REFRESH  (the only time Ory is on the path) ──────────
   Kratos verifies credentials
     └─► app reads the user's roles from Keto       (direct + transitive via groups)
     └─► app writes them as a derived projection on the identity (admin API)
     └─► whoami(tokenize_as: "plainpages")  ─►  signed JWT
           claims: { sub, email, roles:[…from Keto], exp ≈ 10m }
     └─► stored as the session cookie

  ── EVERY REQUEST  (hot path — pure CPU, no I/O) ───────────────────
   Browser ─cookie(JWT)─► web : verify signature (cached JWKS)
                                read claims.roles
                                filter menu · gate routes
```

**Keto is the single source of truth for roles.** Coarse roles are Keto relations
(e.g. `role:admin#members@user:alice`); the admin screens write them *only* to Keto.
But the tokenizer's claims mapper can read only the **identity**, not call Keto — so at
login the app reads the roles from Keto and refreshes a **derived projection**: a
read-only copy written onto the identity's `metadata_public` for the tokenizer to see,
which the template maps into the JWT `roles` claim. (It must be `metadata_public`, not
`metadata_admin`: the session Kratos hands the tokenizer carries only *public* metadata —
and the user can already read these coarse roles in their own JWT, so nothing is leaked.)
That projection is a per-login cache, authoritative nowhere; nothing edits it by hand, and
a stale one self-heals on the next login.

A role can be granted to a user directly or to a **group** the user belongs to; login
resolves both (enumerate the defined roles, ask Keto to resolve each membership), so the
JWT `roles` match what the admin **Effective access** view shows.

Cost: **a handful of Keto reads + one identity refresh per login** — never per request. JWKS
is cached, so even signature verification hits the network only on key rotation. The
app stays stateless; "stay signed in" = re-mint the JWT on a short TTL, the one
moment authz is recomputed from Keto.

#### Two trade-offs — both deliberate

This design buys an I/O-free hot path that scales to **tens of thousands of concurrent
users** on modest hardware. In return:

- **Role changes lag by up to one TTL (~10m).** Gating reads the JWT, not Keto, so a
  granted or revoked role only takes effect when the token is next minted (re-login or
  TTL refresh). For an admin tool this is intentional — the alternative is a Keto call
  per request, which we traded away. For instant revoke, turn on the optional
  [revocation denylist](#instant-revoke-the-optional-denylist) — it closes the gap for
  security-critical cases without putting Keto back on the hot path.
- **Ory is on the critical path for sign-in.** If Kratos is down no one can log in; if
  it stays down past the TTL, existing sessions can't refresh and the UI goes dark.
  That's the direct consequence of being stateless and delegating identity — no local
  fallback, by design. Run Ory with the availability you'd give any auth provider.

### Instant revoke — the optional denylist

Off by default; turn it on with `REVOCATION_DENYLIST=true` (`src/denylist.ts`). For
security-critical revoke (offboarding, a compromised account) the ~10m role/session lag
above is too long. When enabled, an admin **deactivating** or **deleting** a user, or
**granting/revoking** a role to a *user*, records that subject as revoked-now; the hot path
then rejects every token for it minted **before** the revoke and forces a re-mint — which
re-reads roles from Keto, or clears a now-dead session. A fresh re-login (its JWT issued
*after* the revoke) passes, so a role downgrade lands immediately without locking the account.

It's an in-memory, auto-evicting map — no database, like the JWKS cache, so it stays inside the
stateless model. Entries self-evict after `REVOCATION_TTL_SEC` (default 900s ≥ the 10m token TTL
+ skew), by which point any pre-revoke token has expired anyway. The check is pure CPU — **Keto
stays off the hot path**. Two deliberate bounds: it's instant on the **single instance** that
handled the revoke (across replicas/restarts the guarantee falls back to the token TTL — back the
denylist with a shared store for hard multi-instance instant-revoke), and a **group** membership
change is transitive across many users, so it's left to lag — deactivate the user, or use a direct
user-role change, for an instant effect.

### Three tiers of "may I?"

```
  coarse  (menu / route / feature)        → JWT claim     · in-process, zero I/O
  fine + attribute (owner / tenant / …)   → upstream service that owns the row
  fine + relationship (shared / inherited)→ Keto, live check at the action
```

- **Coarse** gates the menu and routes — read straight from the JWT.
- **Attribute-based row rules** (ownership, tenant, status) live in the **upstream
  service** that holds the data: it's the source of truth and the check is free.
- **Relationship-based rules** (sharing, delegation, inherited/transitive access,
  or authz that must mean the same thing across several services) go to **Keto** —
  that's what ReBAC is for. Reserve it for those; don't pay its tuple-sync cost for
  rules a service can already answer from its own data.

The built-in users / groups / permissions screens write authorization **only to
Keto** — coarse roles and fine-grained relationships alike. Roles reach the JWT by
being read from Keto at login and projected through the tokenizer (above); nothing
authors them anywhere else.

### OAuth2 provider (Hydra)

Only relevant when **other apps** authenticate *through* plainpages. The app
implements Hydra's login & consent steps — authenticating the user via their Kratos
session — and Hydra issues the access / refresh / id tokens those apps use. Nothing
in the menu or first-party pages needs Hydra.

The **login challenge** is wired (`src/oauth-login.ts` at `/oauth2/login`): Hydra hands
the browser here, the app resolves it against the Kratos session and accepts (or bounces
an unauthenticated user to the themed login, returning here once signed in). The **consent
challenge** is wired too (`src/oauth-consent.ts` at `/oauth2/consent`): a first-party client
(its Hydra `metadata.first_party: true`) — or one Hydra already skipped — is auto-granted the
requested scopes; any other client gets a themed consent screen (naming the signed-in account, with
a sign-out escape) whose CSRF-guarded Allow/Deny accepts or rejects. id_token claims (email, name)
come from the Kratos identity. RP-initiated **logout** is wired too (`/oauth2/logout`): Hydra hands
the browser here, the app accepts the `logout_challenge` and resumes to Hydra's post-logout redirect
— the first-party `POST /logout` still owns ending the Kratos session + our JWT cookie.

Those clients are registered from the admin **OAuth2 clients** screen (`/admin/clients`,
`src/admin-clients.ts`): register (Hydra shows the generated `client_secret` **once**, on the
confirmation page — confidential clients), list, and delete. Confidential vs public (PKCE) and the
first-party auto-consent flag are set at registration; writes go only to Hydra.

## Stateless — no application database

Plainpages and its plugins hold **no state of their own**. The only database in the
stack is **Postgres, and it belongs to Ory** (Kratos/Keto/Hydra); the `web` app
never connects to it.

A plugin gets its data by **calling an upstream service** from its route handler —
a REST API, an ERP, a plant historian, the customer's own backend — and renders
the response with the building blocks; writes are forwarded the same way. The
partials only need rows to render and don't care where they came from.

This keeps `web` trivially scalable and crash-safe: any instance can serve any
request, because the session lives in Kratos and the data lives upstream.

## Production / deployment

```bash
docker compose -f compose.yml up --build -d   # base config only, no source mount
```

`compose.yml` is the full prod stack — web + Postgres + the three Ory services
(Kratos/Keto/Hydra, with migrations + the one-shot bootstrap) — and mounts no source.
Secrets come from the environment (`CSRF_SECRET`, `POSTGRES_USER`/`POSTGRES_PASSWORD`); the
base already sets `REQUIRE_SECURE_SECRETS=true`, so a missing or dev-throwaway `CSRF_SECRET`
fails the boot rather than running insecure.

Before going live, supply the production secrets and any SSO credentials — the **only**
manual prep ([What you must supply](#what-you-must-supply-the-only-manual-prep)); the rest
is auto-generated.

Every response carries security headers (`src/security-headers.ts`, set once per request): a
strict `Content-Security-Policy` (the core is **zero-JS** — `script-src 'self'`, no inline
scripts, so an injected `<script>` can't run), `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` + `frame-ancestors 'none'`, `Referrer-Policy`, and — when
`SECURE_COOKIES=true` (https) — HSTS. The CSP allows **same-origin** assets only, so a branding
logo must live under `/public/` (or be a `data:` URI); a plugin route can override any header
per-response via `RouteResult.headers` (e.g. to ship its own JS).

A deep link reached while signed out — or after the ~10m session JWT lapses mid-task — bounces to
the themed sign-in and, once authenticated, returns to the **page that was requested** (`return_to`,
validated **host-relative** by `localPath` in `src/safe-url.ts`, so a crafted `?return_to=` can't
turn login completion into an open redirect). If Ory is unreachable on the sign-in path itself, the
user gets an honest **503** ("sign-in is temporarily unavailable"), distinct from the catch-all 500.

The server drains in-flight requests on `SIGTERM`/`SIGINT` rather than cutting them
mid-response, so container restarts are clean.

## Observability

Logging is **structured** and **OTLP-native**, on [`@larvit/log`](https://www.npmjs.com/package/@larvit/log)
(zero-dependency). One app logger tags every line with `service.name` (`SERVICE_NAME`, default
`plainpages` — brand your own deployment); each request is cloned into a short-lived **trace span**,
made ambient for the whole handler (an `AsyncLocalStorage`), so logs and traces correlate. Three
explicit toggles (no `NODE_ENV`):

- `LOG_LEVEL` (default `info`) — `error` · `warn` · `info` · `verbose` · `debug` · `silly` · `none`.
- `LOG_FORMAT` — `text` in dev (human-readable), `json` in prod (the base compose sets it) for a log
  pipeline.
- `SERVICE_NAME` — the `service.name` on every log and span.

Every request emits one access line (`method`, `path` — the query is dropped, it can carry tokens —
`status`, `ms`, `requestId`); login/logout, admin writes (who-did-what), and missing-role/CSRF
rejections log at `info`/`warn`, and the catch-all 500 + the Ory-unreachable re-mint at `error`/`warn`.
An inbound W3C `traceparent` is **adopted**, so a request continues a trace started by an upstream
proxy/gateway.

**Distributed tracing — every outbound call.** Because the request logger is ambient, **all** outbound
HTTP — the Kratos/Keto/Hydra clients and the JWKS fetch — runs through it (`tracedFetch`), so each
becomes a **client span** under the request and carries the `traceparent` downstream (Ory continues
the same trace). A **plugin** does the same: `ctx.log` is its request logger and `ctx.log.fetch(url)`
(or defaulting an upstream client to the exported `tracedFetch`, as the reference plugin does) traces
its upstream calls too. The result is one trace per request spanning web → Ory/upstream.

**OTLP export (off by default).** Point `OTLP_ENDPOINT` at an OpenTelemetry Collector's HTTP base URI
(e.g. `http://otel-collector:4318`) and logs **and** spans also export there — feed Grafana Loki
(logs) + Tempo (traces), or any OTLP backend. `OTLP_PROTOCOL` selects the wire format (`http/json`
default, or `http/protobuf` for collectors that only accept protobuf). Export is fire-and-forget — it
never blocks or fails a served request, and nothing exports when the endpoint is unset (zero cost). A
collector outage is survivable but noisy: each request's failed export writes a line to stderr (it's
retried per request, not queued), so run a local collector/agent you trust.

## Layout

```
src/server.ts        Entry point — starts the HTTP server (reads PORT, default 3000)
src/app.ts           Request routing + EJS rendering (incl. the themed Kratos self-service routes)
src/static.ts        Static file serving (path-traversal protection) + routePublic(): /public/<id>/ → a plugin's public/
src/jwt.ts           JWS signature verify via node:crypto, no jose (decode + verify a compact JWS against one JWK)
src/jwt-middleware.ts resolveSession()/authenticate(): per-request session-JWT verify — key by kid → signature → exp/nbf/iss/aud (clock skew) → ctx.user/roles; flags a lapsed token for re-mint
src/jwks.ts          JwksProvider — resolve the verify key by kid; createJwksProvider() picks by scheme: staticJwks (base64) or cachingJwks (file/http: TTL cache + rotation-on-miss reload)
src/kratos-public.ts createKratosPublic(): Kratos public-API fetch client — self-service flow init/get/submit, browser logout, whoami, session→JWT tokenize
src/kratos-admin.ts  createKratosAdmin(): Kratos admin-API fetch client — identity CRUD + surgical metadata_public update (login role projection)
src/keto-client.ts   createKetoClient(): Keto fetch client — check / list / expand relations (read API) + write / delete tuples (write API)
src/hydra-admin.ts   createHydraAdmin(): Hydra admin-API fetch client — OAuth2 login + consent challenge get/accept/reject + OAuth2 client CRUD
src/fetch-timeout.ts withTimeout(): bound every outbound Ory call — wrap the injected fetch so each request aborts after a deadline unless the caller passed its own signal; server.ts wires it into the Kratos/Keto/Hydra clients
src/oauth-login.ts   resolveLoginChallenge(): authenticate a Hydra login challenge via the Kratos session → accept, or bounce to /login
src/oauth-consent.ts resolveConsentChallenge()/acceptConsent()/rejectConsent(): auto-accept first-party, else show the consent screen → grant scopes
src/flow-view.ts     buildFlowView(): Kratos self-service Flow → themed view model (fields, hidden csrf, buttons, tone-mapped messages) for views/auth.ejs
src/login.ts         completeLogin()/remintSession(): login completion + TTL re-mint — roles from Keto → metadata_public projection → tokenize → session JWT cookie
src/gen-jwks.ts      generateJwks()/rotateJwks() + CLI (mint · --prepend · --prune): the ES256 session-tokenizer signing JWKS; see JWT signing key & rotation
src/bootstrap.ts     One-command bootstrap: idempotent first-boot seed — JWKS-if-absent, demo admin in Kratos, admin role in Keto
src/cookie.ts        Cookie parse + secure Set-Cookie build (session/CSRF cookies)
src/csrf.ts          CSRF for our own POST forms: signed double-submit token — issue/verify, cookie, request gate
src/denylist.ts      Optional instant-revoke denylist: in-memory, auto-evicting; hot path rejects a revoked subject's pre-revoke tokens (REVOCATION_DENYLIST)
src/security-headers.ts Response security headers set on every reply: strict CSP (zero-JS), nosniff, X-Frame-Options/frame-ancestors, Referrer-Policy, HSTS over https
src/safe-url.ts      safeUrl() (sanitise an untrusted href/src to relative-or-http(s), exposed to plugins) + localPath() (host-relative redirect-allowlist guard for return_to)
src/logger.ts        createLogger()/requestLogger() + the ambient request log (runWithLog/currentLog) and tracedFetch: structured logger (service.name) + per-request trace span on @larvit/log; every outbound fetch joins the trace; OTLP export when OTLP_ENDPOINT set
src/body.ts          readFormBody(): read + size-cap an x-www-form-urlencoded request body (CSRF gate + forms)
src/context.ts       RequestContext handed to handlers + buildContext()
src/config.ts        Env loader — Ory endpoints, cookie/CSRF secrets, JWKS, port; validated at boot
src/dashboard.ts     buildDashboardModel(): the gated "/dashboard" app home — a short instructional starter (replace it with a plugin `dashboard` handler); "/" is the public landing (a plugin `home` handler). Both render the one unified menu (ctx.chrome)
src/admin-users.ts   Built-in Users admin screen: list Kratos identities (filter/sort/paginate) + create/edit/deactivate/delete/recovery; gated + CSRF-guarded
src/admin-groups.ts  Built-in Groups admin screen: list Keto subject sets + create/delete + membership (add/remove users & nested groups); writes only to Keto, gated + CSRF-guarded
src/admin-roles.ts   Built-in Roles admin screen: list/create/delete Keto roles + assign to users/groups + "effective access" (Keto expand → transitive members); reuses the Groups membership helpers, writes only to Keto, gated + CSRF-guarded
src/admin-clients.ts Built-in OAuth2 clients admin screen: list/register/delete Hydra OAuth2 clients (apps that log in through us); register shows the one-time client_secret; writes only to Hydra, gated + CSRF-guarded
src/admin-nav.ts     adminSection(): the permission-gated "Admin" menu section (Users · Groups · Roles · OAuth2 clients), wired into the global dashboard menu + the in-screen admin nav (adminNav) so they can't drift
src/shell-context.ts buildShellContext(): brand/theme/user view-model shared by the dashboard + admin screens (real signed-in user, no demo profile)
src/chrome.ts        buildPluginChrome(): the one global menu + brand/user/theme/csrf every page renders the shell from (unified across all pages) — exposed on ctx.chrome
src/icons.ts         Used-icon registry + sprite builder from lucide-static (regenerates partials/icons.ejs)
src/list-query.ts    parseListQuery(): read a list URL → { q, filters, sort, page, pageSize }
src/nav.ts           composeNav(): merge plugin nav fragments + central override, role-filter → nav-tree model
src/paginate.ts      paginate(total,page,pageSize): page model (counts, row window, ellipsis sequence) for pagination.ejs
src/plugin.ts        Plugin contract: manifest types, definePlugin(), version + conflict rules + fullPath()
src/plugin-api.ts    Stable plugin author barrel — the one module a plugin imports (definePlugin, ctx/result types, guards, body/CSRF/list-query helpers)
src/discovery.ts     discoverPlugins(): scan plugins/, import + validate each plugin.ts default export, fail loud at boot
src/router.ts        matchRoute()/allowedMethods()/isAuthorized(): map method+path → plugin route, params, permission gate
src/guards.ts        requireSession()/can()/check(): in-handler authorization — the imperative counterpart to the route permission gate; GuardError → 303 /login or 403; check() is the one live Keto "may I?" call
src/hooks.ts         runBootHooks()/runRequestHooks()/runResponseHooks(): invoke a plugin's optional lifecycle hooks in discovery order; no sandbox (a throwing hook fails loud), skipped when no plugin declares one
src/view-resolver.ts renderPluginView(): render plugins/<id>/views/<view>.ejs; plugin views can include() core partials
src/menu-config.ts   loadMenuConfig()/defineMenu(): read config/menu.ts (central override + branding), validated at boot
views/               Core EJS templates, all in the one app shell: home (public "/" landing), index (instructional /dashboard), admin/ (Users/Groups/Roles/Clients lists + create/edit/detail + delete-confirm), auth (themed Kratos flows), oauth-consent (OAuth2 consent), error (flow-error sink → /error), 403/404/500/503 (503 = Ory-unreachable on sign-in), partials/ (shell, nav tree, filter bar, data table, pagination, field, auth card, alert, landing/flow/consent/admin bodies, menu/popover, theme switch, icon sprite)
public/              Static assets under /public/ (css/styles.css + auth.css, favicon, robots.txt)
config/menu.ts       Central menu override + branding (optional; defaults apply if absent)
ory/                 Ory service config (kratos/: identity schema, kratos.yml, oidc/ SSO claims mapper, tokenizer/ session→JWT claims mapper + dev signing JWKS; keto/: keto.yml + namespaces.keto.ts OPL — role/group/resource; hydra/hydra.yml: OAuth2 issuer + login/consent URLs → /oauth2/*) + storage init (postgres/init/init.sql: one DB per service)
plugins/             Drop-in plugin folders (scanned at /app/plugins; bind-mount or bake in). Ships scheduling/ — the reference plugin (list/form over an upstream + permission-gated nav) you copy
examples/            Non-app helpers; shifts-upstream/ is the dev mock backend the reference plugin reads/writes (stand-in for your real service)
docs/                Reference docs (plugin-contract.md — the authoritative plugin API)
e2e/                 Playwright E2E: visual.spec (design system, Ory-free) + auth-refresh.spec (token timeout/re-mint) + oauth-login.spec (OAuth2 login + consent) + full-flow.spec (browser UI: password/SSO login, menu-by-role, admin CRUD, plugin page, logout) + devstack-login.spec (regression: login works from the banner's localhost URL and 127.0.0.1 is canonicalised, on the plain `docker compose up` topology); proxy.mjs (same-origin gateway) + mock-oidc.mjs (mock SSO provider) back full-flow. Dockerfile.e2e + compose.e2e[-auth|-oauth|-full|-devstack].yml run them
scripts/ci.sh        The full CI gate: typecheck → unit tests → every E2E suite, each on a fresh, always-torn-down stack (`bash scripts/ci.sh`)
```

## Extending the core

- **New page in a plugin:** add a route + handler to the plugin manifest and a
  template in its `views/`.
- **Static asset:** drop it in the plugin's `public/`; served at
  `/public/<plugin>/<path>`.
- **New dependency:** `docker compose run --rm web npm install <pkg>` (updates
  `package.json` + `package-lock.json`), then `docker compose build`. Keep deps
  minimal — prefer the Node standard library, and prefer an Ory REST call over an
  SDK.

All versions are pinned to **exact, human-readable semantic versions** (no ranges,
no digests): npm deps via `.npmrc` (`save-exact=true`) + the committed lockfile
(`npm ci`), and container images by tag in the `Dockerfile` / compose files
(e.g. `node:24.16.0-alpine3.24`, pinned Ory and Postgres tags).
