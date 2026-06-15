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
[Auth](#auth-sessions--permissions-planned)) reads as obvious rather than a surprise,
you're the audience.

## Project goals

Plainpages deliberately targets **low-end systems, odd hardware, and low-bandwidth
environments** — a tablet on a factory floor, an old thin client at a reception desk,
a remote site on a flaky link. That's *why* the baseline is boring, standards-compliant
**HTML + CSS** with zero JavaScript: it loads fast, degrades gracefully, and works on
whatever browser is already there. Where a modern **CSS** feature removes the need for
JavaScript (theme switching, popovers, disclosure) we use it — the trade we avoid is
shipping a client-side runtime, not using the platform.

> **Status.** This README describes the target architecture. What exists today is the
> **scaffold** — a Node 24 + EJS HTTP server with static serving — plus the **design
> foundation** in `html-css-foundation/` (a complete zero-JS app shell + auth screens).
> The plugin host and Ory integration (Kratos/Keto/Hydra + their Postgres) are the
> roadmap below. Sections marked _(planned)_ are not built yet.

## The MVP — "clone, one command, hack on a plugin" _(planned)_

The bar for a first usable release: **clone, run one command, get a working
register/login, and start building your own plugin** — no manual key generation, no
hand-edited Ory config, no separate database. That command brings up the whole stack
(web + Ory + Postgres), generates signing keys, seeds an admin on first boot, and drops
you at a login screen; from there you copy the example plugin folder and write your own
page. SSO and the OAuth2-provider role (Hydra) come after — not required to start.

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
dependency. See [Auth, sessions & permissions](#auth-sessions--permissions-planned).

So the `web` app is **stateless** and its npm footprint stays tiny — a small,
pinned set of runtime deps (today **`ejs`** for templating and **`lucide-static`**
for icons), grown only with justification and never a framework. Auth, sessions,
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

`docker compose up` merges `compose.override.yml`, which mounts the source and
restarts the server on change. _(The Ory + Postgres services join this compose
file as they land — planned.)_

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
| `PORT` | `3000` | web listen port |
| `CACHE_TEMPLATES` | `false` | cache compiled EJS templates (`true` in prod) |
| `REQUIRE_SECURE_SECRETS` | `false` | when `true`, the two secrets must be supplied and differ from the dev throwaways |
| `KRATOS_PUBLIC_URL` / `KRATOS_ADMIN_URL` | `http://kratos:4433` / `:4434` | identity (self-service / admin) |
| `KETO_READ_URL` / `KETO_WRITE_URL` | `http://keto:4466` / `:4467` | permission check / write |
| `JWKS_URL` | Kratos tokenizer JWKS | verifies the session JWT (§4) |
| `COOKIE_SECRET` / `CSRF_SECRET` | dev throwaways | enforced by `REQUIRE_SECURE_SECRETS` |

## Type check & tests

```bash
docker compose run --rm web npm run typecheck   # strict tsc --noEmit
docker compose run --rm web npm test            # node --test
```

## Building a plugin _(planned)_

A plugin is a folder under `plugins/`. The host discovers it at boot — no
registration step, no central wiring.

```
plugins/scheduling/
  plugin.ts            # default export: the typed manifest (see below)
  views/               # EJS templates for this plugin's pages
    shifts.ejs
  public/              # CSS / assets, served under /public/scheduling/
    scheduling.css
```

The manifest is **TypeScript** — typed, commented, no separate schema to keep in
sync:

```ts
import { definePlugin } from "../../src/plugin.ts";
import { listShifts } from "./shifts.ts";

export default definePlugin({
  id: "scheduling",
  basePath: "/scheduling",

  // Nav fragment, composed into the global menu. Permission-gated via Keto:
  // items the current user can't access are hidden. Arbitrary depth.
  nav: [
    {
      label: "Scheduling", icon: "i-cal",
      children: [
        { label: "Shifts", href: "/scheduling/shifts", permission: "scheduling:read" },
      ],
    },
  ],

  // Route handlers. The host's hand-rolled router mounts them under basePath
  // and enforces `permission` (a Keto check) before the handler runs.
  routes: [
    { method: "GET", path: "/shifts", permission: "scheduling:read", handler: listShifts },
  ],
});
```

The handler (`listShifts`) fetches its data from an upstream service and renders
it — the plugin holds no state of its own (see below). Each plugin is
**self-contained** (its own nav, routes, views, CSS), so installing one is "drop
the folder, restart." An operator stays in control via a central override.

## The menu system _(planned)_

The menu is **driven entirely by config** and assembled from two sources:

1. **Plugin fragments** — each plugin contributes its own `nav` (above).
2. **A central override** — `config/menu.ts` — where the operator reorders,
   renames, groups, or hides items, and sets branding (app name, logo, default
   theme). The override always wins.

Every nav item may carry a `permission`; the rendered tree is **filtered per
user** by reading the roles in the session JWT (no per-request authz call — see
[Auth, sessions & permissions](#auth-sessions--permissions-planned)), so the menu
only ever shows what that person can reach. The markup is the recursive, zero-JS
nav tree from the design foundation (header/leaf × clickable/static, counts,
arbitrary depth).

## Building blocks _(partly designed, planned to extract)_

Plainpages is a **component library, not a page generator** — you assemble pages
from partials and helpers rather than declaring a schema and getting magic. The
vocabulary already exists, fully styled and zero-JS, in `html-css-foundation/`;
the work is extracting it into reusable EJS partials + TS helpers:

- **Partials:** app shell, nav tree, filter bar, data table (sort / select / row
  actions), pagination, form fields, badges, menus, auth cards.
- **Helpers:** compose nav from config, parse a list-page query
  (`?q=…&status=…&sort=…&page=…`) into filter/sort/pagination, pagination math,
  guards — `requireSession` (validate the JWT), `can(role)` (read a claim,
  in-process), and `check(relation, object)` (a live Keto call, for the rare
  fine-grained case).

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

## Auth, sessions & permissions _(planned)_

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
     └─► app reads the user's roles from Keto       (Keto = source of truth)
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
(e.g. `role:admin#member@user:alice`); the admin screens write them *only* to Keto.
But the tokenizer's claims mapper can read only the **identity**, not call Keto — so at
login the app reads the roles from Keto and refreshes a **derived projection**: a
read-only copy written onto the identity's `metadata_admin` for the tokenizer to see,
which the template maps into the JWT `roles` claim. That projection is a per-login
cache, authoritative nowhere; nothing edits it by hand, and a stale one self-heals on
the next login.

Cost: **one Keto read + one identity refresh per login** — never per request. JWKS
is cached, so even signature verification hits the network only on key rotation. The
app stays stateless; "stay signed in" = re-mint the JWT on a short TTL, the one
moment authz is recomputed from Keto.

#### Two trade-offs — both deliberate

This design buys an I/O-free hot path that scales to **tens of thousands of concurrent
users** on modest hardware. In return:

- **Role changes lag by up to one TTL (~10m).** Gating reads the JWT, not Keto, so a
  granted or revoked role only takes effect when the token is next minted (re-login or
  TTL refresh). For an admin tool this is intentional — the alternative is a Keto call
  per request, which we traded away. For instant revoke, the optional revocation
  denylist (roadmap) closes the gap for security-critical cases without putting Keto
  back on the hot path.
- **Ory is on the critical path for sign-in.** If Kratos is down no one can log in; if
  it stays down past the TTL, existing sessions can't refresh and the UI goes dark.
  That's the direct consequence of being stateless and delegating identity — no local
  fallback, by design. Run Ory with the availability you'd give any auth provider.

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
in the menu or first-party pages needs Hydra; it can be added later without
touching them.

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

_(Production compose grows to include the Ory services and Postgres — planned.)_

The server drains in-flight requests on `SIGTERM`/`SIGINT` rather than cutting them
mid-response, so container restarts are clean.

## Layout

```
src/server.ts        Entry point — starts the HTTP server (reads PORT, default 3000)
src/app.ts           Request routing + EJS rendering
src/static.ts        Static file serving with path-traversal protection
src/jwt.ts           JWS signature verify via node:crypto, no jose; claims+JWKS are §4
src/cookie.ts        Cookie parse + secure Set-Cookie build (session/CSRF cookies, §4)
src/context.ts       RequestContext handed to handlers + buildContext()
src/config.ts        Env loader — Ory endpoints, cookie/CSRF secrets, JWKS, port; validated at boot
src/icons.ts         Used-icon registry + sprite builder from lucide-static (regenerates partials/icons.ejs)
src/plugin.ts        definePlugin() + the host's plugin discovery/router   (planned)
views/               Core EJS templates (index, 403/404/500, partials/ incl. the app shell + icon sprite)
public/              Static assets under /public/ (css/styles.css + auth.css, favicon, robots.txt)
config/menu.ts       Central menu override + branding                      (planned)
plugins/             Drop-in plugin folders, auto-discovered               (planned)
html-css-foundation/ HTML design mockups — the source for the building-block
                     partials; reference the stylesheets in public/css/.
```

Comments and docs cite roadmap phases as `§N` — the sections in `todo.md`.

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
