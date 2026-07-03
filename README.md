# Plainpages

A self-hostable **foundation for server-rendered web applications** — **public pages,
access-controlled pages, or any mix**, built from a **zero-JS design system** with a
**config-driven menu** and **optional authentication & authorization** baked in (any page
can be public or gated). You add everything domain-specific by **dropping in plugin
folders** — the admin UI for a webshop, a public service portal, a school scheduler, a
water-treatment dashboard — without rebuilding auth, the menu, and the design system every
time.

> **True home: <https://gitea.larvit.se/larvit/plainpages>** — development, issues, and PRs
> live there. [github.com/larvit/plainpages](https://github.com/larvit/plainpages) is a
> read-only mirror, force-synced on every merge to `main`.

## Quick start

> **Requirements:** **Docker** and **Docker Compose** — and nothing else.

**1. Clone and start the whole stack.**

```bash
git clone ssh://git@gitea.larvit.se:21022/larvit/plainpages.git
cd plainpages
docker compose up -d        # http://localhost:3000, live-reloads on source changes
```

**2. Sign in.** Open <http://localhost:3000> and sign in as the seeded admin —
**`admin@plainpages.local` / `admin`**.

**3. Enable user & group admin (optional).** The core ships **no admin GUI** — the Users / Groups
/ Roles / OAuth2-clients screens are a drop-in plugin. Copy it in to mount them at `/admin/*`:

```bash
cp -r examples/plugins/admin plugins/admin
docker compose restart web
```

The seeded admin already holds the `admin` role, so the **Admin** section now shows in the menu.
See [`examples/plugins/admin/`](examples/plugins/admin/).

**4. Add your first plugin.** The clone is bind-mounted into the container, so a new
folder under `plugins/` goes live after a restart. Create `plugins/hello/plugin.ts`:

```ts
import { definePlugin } from "#plugin-api";

export default definePlugin({
  apiVersion: "1.0.0",
  nav: [{ href: "/hello", id: "hello", label: "Hello", public: true }],
  routes: [
    { method: "GET", path: "/", public: true, handler: () => ({ html: "<h1>Hello from my plugin</h1>" }) },
  ],
});
```

```bash
docker compose restart web
```

Visit <http://localhost:3000/hello> — the page is mounted at `/hello` (the folder name
is the plugin id *and* the mount path) and "Hello" is in the menu. That's the whole loop:
**drop a folder in `plugins/`, restart, it's live.**

From here, render real pages against the app shell and fetch upstream data — see
[Building plugins](#building-plugins) and the runnable reference in
[`examples/plugins/scheduling/`](examples/plugins/scheduling/).

## Contents

- [Overview](#overview)
  - [how it compares](#how-it-compares)
- [Building plugins](#building-plugins)
  - [anatomy](#anatomy-of-a-plugin)
  - [the manifest](#the-manifest)
  - [routes & handlers](#routes--handlers)
  - [landing pages](#the-landing-pages-home--dashboard)
  - [RequestContext](#requestcontext)
  - [system capabilities (ctx.system)](#system-capabilities-the-ctxsystem-surface)
  - [nav & permissions](#nav--permissions)
  - [versioning](#contract-versioning)
  - [conflict rules](#conflict-rules)
  - [hooks](#hooks)
  - [where they live & mounting](#where-plugins-live-and-how-to-mount-them)
  - [local dev & test](#local-dev--test-story)
- [The menu system](#the-menu-system)
- [Building blocks](#building-blocks)
- [Interactivity: zero-JS spine](#interactivity-zero-js-spine)
- [Configuration](#configuration)
  - [canonical host](#canonical-host-one-public-url)
  - [what you must supply](#what-you-must-supply-the-only-manual-prep)
  - [SSO](#social-sign-in-sso)
- [Auth, sessions & permissions](#auth-sessions--permissions)
  - [login & the session JWT](#login-and-the-session-jwt)
  - [instant revoke](#instant-revoke-the-optional-denylist)
  - [three tiers](#three-tiers-of-may-i)
  - [OAuth2 (Hydra)](#oauth2-provider-hydra)
- [Email](#email)
- [Architecture](#architecture)
  - [Stateless](#stateless)
- [Testing](#testing)
  - [end-to-end](#end-to-end-playwright)
  - [the full gate](#the-full-gate-one-command)
- [CI/CD](#cicd)
- [Production & deployment](#production--deployment)
- [Observability](#observability)
- [JWT signing key & rotation](#jwt-signing-key--rotation)
- [Project layout](#project-layout)
- [Extending the core](#extending-the-core)

## Overview

Plainpages gives you the boring-but-hard parts of a web app — a design system, a menu,
sessions, and access control — and stays out of your domain logic. **Any page can be public
or gated**, so the same foundation serves a purely public site, a fully locked-down internal
tool, or the common middle: a public front with an authenticated area behind it. Its **sweet
spot** is the **back-office and operational tooling** you'd otherwise hand-roll for the tenth
time, but nothing ties it to internal-only use. The core itself ships **no domain screens at
all** — even the screens for running the system (**users, groups, permissions**) are a **drop-in
plugin** you opt into ([`examples/plugins/admin/`](examples/plugins/admin/)). Everything is a plugin.

**Who it's for.** Experienced developers building server-rendered web products — back-office
and operational tools, dashboards, portals, or public sites with a gated area — for their own
use or for a client. You know HTTP, Docker, and identity
providers, and you'd rather assemble pages from building blocks than fight a framework or
hand-roll auth for the tenth time. It's not a no-code tool and doesn't hide its moving
parts: if "Ory is down ⇒ no logins" (see [Auth](#auth-sessions--permissions)) reads as
obvious rather than surprising, you're the audience.

**Included vs. what you add.**

- **Included in the core:** themed sign-in / register / reset (Kratos-backed), the design
  system + app shell, the config-driven menu, sessions, and access control. No domain screens.
- **Opt-in admin plugin:** the **users, groups, roles, and OAuth2-clients** screens (users via
  Kratos, the relationship graph via Keto, OAuth2 clients via Hydra) ship as
  [`examples/plugins/admin/`](examples/plugins/admin/) — copy it into `plugins/` to get a GUI for
  user & group admin. It's an ordinary plugin, using the privileged
  [`ctx.system`](#system-capabilities-the-ctxsystem-surface) surface to reach Ory.
- **You add:** everything else domain-specific, as **plugins** — a list page, a form, a
  scheduler, a register, a dashboard — built from the same building blocks the admin plugin uses.

**Priorities (unchanged from day one):** **simplicity, few dependencies, strict
TypeScript, no build step, Docker-only, environment-agnostic** (no `NODE_ENV` — every
behaviour is an explicit config toggle). Heavy lifting that *isn't* simple to do well —
identity, sessions, SSO, OAuth2, permission checks — is delegated to **Ory** sidecar
services rather than reinvented. "Simple" is about the *whole architecture* staying simple
— not just at the start, but after you've dropped in 240 plugins and run it hard in
production. The shape doesn't change as it grows: every plugin is the same self-contained
folder, the hot path is the same I/O-free JWT check, and there's no app database to scale
or migrate.

**Plugins are the extension model — powerful, predictable, fail-loud.** Everything
domain-specific is a plugin, and the plugin API is the product's main surface, written for
experienced developers. It optimises for being **powerful, predictable, and overloadable** —
a plugin can take over as much of a page as it wants. The host **fails loud at boot/discovery**
rather than sandboxing at runtime: a malformed manifest, a version mismatch, or a conflict
stops startup with a clear message. Runtime crash-isolation (one bad plugin can't take the
host down) is a deliberate **non-goal** — diagnose at deploy time, not in production. See
[Building plugins](#building-plugins).

**Low-end by design.** Plainpages deliberately targets **low-end systems, odd hardware,
and low-bandwidth environments** — a tablet on a factory floor, an old thin client at a
reception desk, a remote site on a flaky link. That's *why* the baseline is boring,
standards-compliant **HTML + CSS with zero JavaScript**: it loads fast, degrades
gracefully, and works on whatever browser is already there. Where a modern **CSS** feature
removes the need for JavaScript (theme switching, popovers, disclosure) we use it — the
trade we avoid is shipping a client-side runtime, not using the platform. That
standards-first stance also makes **semantic, accessible markup** a priority: real
landmarks, one `<h1>` per page, lists and tables with proper headers, a skip link, and
ARIA (`aria-current`/`aria-sort`) only where the platform leaves a gap (see
[AGENTS.md](AGENTS.md)).

### How it compares

The space around Plainpages is crowded, but it splits into families that each share **one**
of its traits and miss the rest. Here's the map — established names per family, and where
Plainpages sits relative to them:

| Family · examples | What it is | Where Plainpages differs |
| --- | --- | --- |
| **Modular app frameworks** — Odoo · Frappe · OrchardCore · ABP | extend by dropping a **module folder** in; server-rendered | Closest in *shape* to the plugin model, but each is **metadata/model-driven with its own ORM/DB** and a large framework. Plainpages keeps the folder model while staying **stateless, framework-light, and component-not-generator**. |
| **Developer portals / IDPs** — Backstage · Port · Cortex · Roadie · OpsLevel · Compass | plugin-based internal platforms with a service catalog | Closest on the **plugin** axis, but heavy **React SPAs** with a build step, built to catalog services. Plainpages is **zero-JS, few-deps, no-build** and renders general pages, not a catalog. |
| **Model-driven auto-admin** — Django Admin · AdminJS · Filament · ActiveAdmin · EasyAdmin · Sonata · sqladmin · Starlette-admin | generate a CRUD UI **from your ORM/DB models** | Plainpages is a **component library, not a generator** — there is **no app DB** to model against; handlers fetch from upstream and you assemble the page. |
| **Schema-driven content platforms** — KeystoneJS · Payload · Directus · Strapi · Wagtail | define a content schema, get an admin **+ API**; they own the data | Plainpages owns **no data** and isn't schema-first; it renders pages over services you already run, rather than being the system of record. |
| **Naked-objects / runtime UI** — Apache Causeway · OpenXava · JHipster | the UI is **auto-projected from domain objects** (the generator extreme) | The opposite stance: Plainpages hands you **building blocks to assemble**, with no domain model driving the screen. |
| **Low-code builders** — Retool · Appsmith · ToolJet · Budibase · NocoBase · ILLA | drag-and-drop GUI builders, **client-JS-heavy**, runtime state | Plainpages is **code-first and zero-JS** — server-rendered HTML versioned in your repo, no visual editor or runtime app state. |
| **Code-first internal-tool platforms** — Windmill · Lowdefy · Superblocks | turn **scripts/config into auto-generated UIs** | Closest in *spirit* (for developers, self-hosted), but script/workflow-runner-centric. Plainpages gives you **full pages you control**, not a UI inferred from a function signature. |
| **Hypermedia / zero-JS movement** — htmx · Hotwire/Turbo · Unpoly · Datastar | the **server-rendered-HTML philosophy** Plainpages is built on | These are *techniques*, not a foundation — no auth, menu, or plugins. Plainpages is what you **assemble with** the approach (and plugins may opt into htmx). *(Phoenix LiveView shares it but trades in a stateful socket.)* |
| **CSS-only admin shells** — AdminLTE · Tabler · Bootstrap themes | a **visual shell** — markup + styles only | No backend, auth, routing, or extension model. Plainpages **includes the shell** and adds the hard-every-time parts. |
| **Themed auth UI on Ory** — Kratos self-service UIs (`ory/kratos-selfservice-ui-node`, `kratos-admin-ui`) | the **login / registration screens** over Ory | The one *slice* with a direct off-the-shelf alternative: Plainpages reimplements it inside its own shell, so you could swap it out to avoid maintaining that part. |

No family combines the whole set: **[drop-in plugin folders](#building-plugins)**, a **zero-JS
server-rendered** design system, **[optional auth](#auth-sessions--permissions)** (any page
public or gated), **no app database**, and a **framework-light TypeScript** core with no build
step. Each neighbour shares one trait and trades away the rest — Plainpages is the intersection.

## Building plugins

A plugin is a self-contained folder under `plugins/` that the host discovers at boot — no
registration step, no central wiring. Each plugin carries its own nav, routes, views, and CSS.

This is the **authoritative reference** for the plugin API — the product's main surface. The
contract is **TypeScript** (`src/plugin-host/plugin.ts`), so the types there are the single
source of truth; the sections below explain them, the guarantees around them, and the rules
the host enforces. A complete, runnable example lives in
**[`examples/plugins/scheduling/`](examples/plugins/scheduling/)** — a public overview page, a
permission-gated list page fetching upstream data (it points `SCHEDULING_UPSTREAM` at its backend;
the dev compose ships a tiny mock, `examples/shifts-upstream/`), a CSRF-guarded form forwarding
writes upstream, and a mix of public + role-gated nav. It is **not** pre-installed — `plugins/`
ships empty so you mount your own. To run it in dev, copy it in
(`cp -r examples/plugins/scheduling plugins/scheduling`, then restart) — the dev compose already
points `SCHEDULING_UPSTREAM` at its mock backend. Copy it to `plugins/<id>/` and adapt.

### Anatomy of a plugin

```
plugins/things/          # the plugin folder — its name is the id AND the mount path (→ /things)
  plugin.ts              # REQUIRED — the one fixed filename; default-exports the manifest (definePlugin(...))
  views/                 # fixed name, optional — EJS the host renders for a { view } result
    things.ejs           #   your view files; a handler picks one with { view: "things" }
  public/                # fixed name, optional — static assets, served at /public/things/
    things.css           #   your asset files
  handlers.ts            # your code, any names/layout — host never looks here; plugin.ts imports it
  service.ts             #   e.g. route handlers, upstream calls, domain helpers — design as you wish
```

**Only `plugin.ts` is required.** The host looks for exactly that filename and its
default-exported manifest. `views/` and `public/` are the two fixed folder *names* it resolves
against — used only if the plugin renders views or serves assets — but the files inside are
yours to name. Everything else (handlers, upstream clients, their filenames and folder layout)
the host never sees; `plugin.ts` simply imports it. The `handlers.ts`/`service.ts` split above is
just an example — name and arrange your modules however you like, or keep a routes-only plugin to a
single `plugin.ts`.

**Identity comes from the folder.** The folder name *is* the plugin `id`, and the mount path is
`/<id>` — neither is written in the manifest, so they can't drift or be claimed twice. The id
must be **URL/path-safe** (`isValidPluginId`: lowercase `a–z`, digits, and dashes — dashes
anywhere; no uppercase, underscores, dots, or slashes); the host rejects a malformed folder name
at discovery. The id also namespaces the plugin's `views/`, its `/public/<id>/` assets, and (by
convention) its nav/permission tokens.

A handful of ids are **reserved** for the host's own first-party mounts — the gated `dashboard`, the
Kratos auth flows (`auth`, `login`, `logout`, `recovery`, `registration`, `settings`, `verification`),
the `oauth2` provider routes, and `public` (static). Since plugin routes resolve first, a folder
claiming one would silently shadow a built-in route, so discovery refuses it loud
(`RESERVED_PLUGIN_IDS`). (`/` is owned by the `home` field, not a route, so it needs no reservation;
`admin` is **not** reserved — the admin screens are themselves a drop-in plugin mounted at `/admin`.)

Installing a plugin is "drop the folder, restart." Removing one is "delete the folder, restart."
Nothing else references it; the operator stays in control through the central menu override
(`config/menu.ts`).

### The manifest

A plugin imports its host surface from one module — **`#plugin-api`** (a Node [subpath
import](https://nodejs.org/api/packages.html#subpath-imports) mapped to `src/plugin-host/plugin-api.ts`
in the root `package.json`), the **stable author barrel** (`definePlugin`, the manifest/handler types,
`RequestContext`, the guards, and the body/CSRF/list-query helpers). Using `#plugin-api` (not a relative
`../../src/...` path) means the same import works at any folder depth and survives host refactors — it
resolves against the app's `package.json` wherever your plugin folder sits under it. That barrel *is* the
contract boundary; don't reach into deeper `src/*` modules — the host may refactor those freely as long as
the barrel holds. (Keep your plugin a plain folder — no `package.json` of its own — so `#plugin-api`
resolves against the host's.)

```ts
import { definePlugin } from "#plugin-api";
import { listThings, createThings } from "./handlers.ts";

export default definePlugin({
  apiVersion: "1.0.0",                // semver string of the host contract this plugin was built against (see Versioning)

  // Nav fragment, merged into the global menu and permission-filtered per user.
  // `icon` is a Lucide icon by its sprite id (src/ui/icons.ts).
  nav: [{ href: "/things", icon: "i-cal", id: "things:list", label: "Things", permission: "things:read" }],

  // Permission tokens this plugin introduces. Optional — see Nav & permissions.
  permissions: [
    { token: "things:read", description: "View things" },
    { token: "things:write", description: "Create and edit things" },
  ],

  // Route handlers, mounted under the plugin's path (/things). `permission` gates first.
  routes: [
    { method: "GET",  path: "/", permission: "things:read",  handler: listThings },
    { method: "POST", path: "/", permission: "things:write", handler: createThings },
  ],
});
```

`definePlugin()` only types the object and returns it unchanged — a manifest may equally be a
plain typed object. It types the authored shape (`PluginManifest`); the host attaches the
folder-derived `id` to produce the loaded `Plugin`. All validation happens at discovery. Note
there is **no `id` or `basePath`** in the manifest — both come from the folder
([Anatomy](#anatomy-of-a-plugin)).

| Field | Required | Notes |
| --- | --- | --- |
| `apiVersion` | yes | Semver string of the host contract the plugin was built against. See [Versioning](#contract-versioning). |
| `home` | no | A `RouteHandler` that owns the **public** landing `/`. At most one plugin may declare it. See [The landing pages](#the-landing-pages-home--dashboard). |
| `dashboard` | no | A `RouteHandler` that owns the **gated** app home `/dashboard`. At most one plugin may declare it. See [The landing pages](#the-landing-pages-home--dashboard). |
| `nav` | no | `NavNode[]` fragment (same shape `composeNav` consumes). `icon` is a Lucide sprite id (`src/ui/icons.ts`); node `id`s must be globally unique. |
| `permissions` | no | Tokens this plugin introduces. See [Nav & permissions](#nav--permissions). |
| `routes` | no | See [Routes & handlers](#routes--handlers). |
| `hooks` | no | See [Hooks](#hooks). |

A plugin may be routes-only, nav-only, or hooks-only — every collection field is optional.

### Routes & handlers

A route is `{ method, path, permission?, public?, handler }`. `path` is **relative to the plugin's
mount path `/<id>`** (so `path: "/:id"` in the `things` plugin serves `/things/:id`); the host
matches `method` + the resolved full path, extracts `:name` segments into `ctx.params.name`,
runs the `permission` gate (a coarse JWT-claim check — see [Nav & permissions](#nav--permissions)),
and only then calls the handler with the [request context](#requestcontext). When the gate fails, an
**anonymous** visitor is redirected to `/login` to sign in; the
requested page is preserved as `return_to`, so after signing in they land **back on the page they
asked for**, not the dashboard. A **signed-in** user who simply lacks the role gets the **403** page.
A route marked **`public: true`** has no gate at all — anyone reaches it (see [Public pages & menu
items](#public-pages--menu-items)).

`method` is one of `GET HEAD POST PUT PATCH DELETE`. A `GET` route also answers `HEAD`.

A handler returns a **`RouteResult`** (or a `Promise` of one); the host turns it into the HTTP
response. Returning `void` is the escape hatch — the handler wrote to `ctx.res` itself.

```ts
// Optional on every variant below: status (HTTP status code) and headers (extra response headers).
type ResponseMeta = { status?: number; headers?: Record<string, string> };

type RouteResult =
  // Render the plugin's own view (plugins/<id>/views/<name>.ejs) with `data`.
  | ResponseMeta & { view: string; data?: Record<string, unknown> }
  // Pre-rendered HTML, sent as-is.
  | ResponseMeta & { html: string }
  // JSON body
  | ResponseMeta & { json: unknown }
  // Redirect to a URL (takes only status, no headers).
  | { redirect: string; status?: number };
```

```ts
// handlers.ts
import { parseListQuery, type RequestContext } from "#plugin-api";

export async function listThings(ctx: RequestContext) {
  const q = parseListQuery(ctx.url);
  const rows = await fetch(`${upstream}/things?${ctx.url.searchParams}`).then((r) => r.json());
  return { view: "things", data: { rows, q } }; // renders plugins/things/views/things.ejs
}
```

- **`view`** resolves against the plugin's own `views/` (`src/plugin-host/view-resolver.ts`) — nested names
  like `"things/edit"` work, and an out-of-bounds name is refused. The template may `include()`
  the core building-block partials (app shell, nav tree, data table, …) and its own
  partials/subfolders to render a full page — exactly as the admin plugin's screens do. To load the
  plugin's own CSS, pass its `/public/<id>/x.css` href in the shell's `styles` slot (an array of
  extra stylesheet hrefs) — see the reference's `views/shifts.ejs`.
- **Finer authorization than the route `permission`** uses the guards from `#plugin-api`:
  `requireSession(ctx)` (assert a session — throws a `GuardError` the host turns into a redirect
  to sign in), `can(ctx, role)` (a coarse JWT-claim check, zero I/O), and `check(keto, ctx,
  {namespace, object, relation})` (a live Keto check for relationship rules — the subject is the
  signed-in user, anonymous ⇒ denied). Throw `new GuardError(403, …)` after a failed `can`/`check`
  to render the 403 page.
- The handler **fetches its own data** from upstream and renders it; plugins hold no state
  (see [Stateless](#stateless)). The partials only need rows.
- `default` status: `200` for `view`/`html`/`json`, `303` for `redirect`.

#### Escaping & the trust boundary

The host does not sandbox plugin output (crash-isolation is a non-goal), so a handler **owns the
safety of the data it renders**:

- **Raw HTML is raw.** An `{ html }` result and the `*.html` partial fields (`cell.html`,
  `error.html`, a menu `trigger.html`) are emitted **unescaped** — that's their purpose (slot
  composition). Escape any untrusted content yourself before putting it there.
- **Text is auto-escaped; URLs are not scheme-checked.** Partials escape text fields (labels,
  names), so those are injection-safe. But a URL field — nav `href`, a table cell link, a menu
  item, a breadcrumb, `brand.logo` — is emitted as-is inside the attribute: a `javascript:` or
  `data:` URL from upstream/user data becomes live XSS. When a URL comes from data you don't
  control, pass it through **`safeUrl()`** from `#plugin-api` first — it returns the URL when
  it's relative or `http(s):` and collapses anything else to `"#"`:
  ```ts
  import { safeUrl } from "#plugin-api";
  return { view: "list", data: { rows: rows.map((r) => ({ ...r, href: safeUrl(r.href) })) } };
  ```

### The landing pages (`home` & `dashboard`)

The host has two replaceable landing slots, and a plugin may own either or both:

| Slot | Path | Gate | Default |
| --- | --- | --- | --- |
| `home` | `/` | **public** — anyone | An intro page with prominent sign-in / register links. |
| `dashboard` | `/dashboard` | **signed-in session** (anonymous → `/login`, with `/dashboard` as `return_to`) | The built-in mock-data People list. |

```ts
import { definePlugin } from "#plugin-api";
import { landing, board } from "./pages.ts";

export default definePlugin({
  apiVersion: "1.0.0",
  home: landing,     // owns "/" — the public front page
  dashboard: board,  // owns "/dashboard" — the post-login app home
});
```

Each is a `RouteHandler` like any route's — it receives the [`RequestContext`](#requestcontext) and
returns a `RouteResult`, typically a `view` from the plugin's own `views/`. A `dashboard` handler
renders against the native app shell via `ctx.chrome` exactly as a route handler does; a `home`
handler is a **public** page, so `ctx.user` may be `null` (use it to show a "go to dashboard" link to
a signed-in visitor, or sign-in / register to an anonymous one). After login the user lands on
`/dashboard` (or the `return_to` they were headed to), and the global menu's **Dashboard** link
points there.

For the gated `dashboard`, the host enforces the session gate first, so `ctx.user` is non-null;
branch on `ctx.roles` *inside* to tailor the page per role. Don't gate `dashboard` itself behind a
single permission — there's no second dashboard to fall back to, so a user lacking it would land on a
403. (Both slots answer `GET` and `HEAD`.)

Only **one** plugin may own each slot: two declaring `home` (or two declaring `dashboard`) is a
boot-stopping conflict ([below](#conflict-rules)), never last-write-wins. Neither needs a `routes`
entry — the host mounts them above the `/<id>` route namespace, and `/` can't be shadowed by a plugin
route at all (route paths always carry the `/<id>` prefix).

### RequestContext

Every handler receives one argument, the `RequestContext` (`src/http/context.ts`), built once per
request:

```ts
interface RequestContext {
  chrome: PageChrome;                // brand/global-nav/user/theme/csrf for the native app shell
  log: Log;                          // request-scoped logger, in this request's trace
  params: Record<string, string>;   // path params from the route match, e.g. /things/:id → { id }
  query: URLSearchParams;            // alias of url.searchParams
  req: IncomingMessage;
  res: ServerResponse;
  roles: string[];                   // user?.roles ?? [] — coarse gate without a null-check
  system?: SystemCapabilities;       // privileged Ory clients + instant-revoke, for a system plugin (see below); undefined unless the host wired them
  url: URL;
  user: User | null;                 // { id, email, roles } from the verified session JWT, or null
  verifyCsrf(submitted): boolean;    // gate a form POST against the request's signed CSRF cookie
}
```

**`ctx.chrome`** is the page chrome the host builds per request — `{ brand, csrfToken, nav, signInHref,
theme, user }`. Hand it to `partials/shell` so a `view` result renders the **native app shell** (the same
sidebar, branding, theme switch and signed-in profile every page uses); `chrome.nav` is the
global menu — your plugin's nav fragment plus every other installed plugin's (the admin section among
them, when that plugin is present) — already composed, role-filtered, and current-marked for this
request (the gated **Dashboard** link is omitted for an
anonymous visitor). `chrome.signInHref` is where the shell's anonymous **Sign in** link points — the
current page baked in as `return_to`. Map each `chrome.*` to the matching `partials/shell` local —
`brand`, `csrfToken`, `nav` (the rendered nav-tree), `signInHref`, `theme`, `user` — exactly as the
reference `examples/plugins/scheduling/views/overview.ejs` does; a value you forget simply falls back to its
shell default (e.g. a bare `/login`), it does not error. **`ctx.verifyCsrf(submitted)`** guards a
state-changing form: render `chrome.csrfToken` in a hidden `_csrf` field, then on POST read your own
body and `if (!ctx.verifyCsrf(form.get("_csrf"))) throw new GuardError(403, …)`. The host owns the
secret and sets the cookie; the plugin never touches it. (See the reference: `examples/plugins/scheduling/`.)

The same shell renders **every** page (the dashboard, your plugin pages — the admin plugin's included, and the
login/registration/front pages), so the menu looks identical signed in or out — it just role-filters.
A page that wants a focused, chrome-free layout passes **`menu: false`** to `partials/shell` (drops the
sidebar, single column); everything else still renders.

**`ctx.log`** is a structured, request-scoped logger ([`@larvit/log`](https://www.npmjs.com/package/@larvit/log))
already in this request's trace: `ctx.log.info("…", { key: "value" })` (also `warn`/`error`/`debug`,
metadata values are string/number/boolean), and **`ctx.log.fetch(url, init?)`** — a drop-in `fetch`
for upstream calls that adds a client span and propagates the trace (W3C `traceparent`) downstream.
The barrel also exports a standalone **`tracedFetch`** (same behaviour, reads the ambient request log)
to default an upstream client's `fetch` to — the reference plugin's `createUpstream` does exactly this,
so its calls are traced with no per-handler wiring. Lines are correlated by a `requestId` and carry
`service.name`; output/level/OTLP export are the host's config (it logs to console always, and to an
OpenTelemetry Collector when `OTLP_ENDPOINT` is set).

**Stability guarantee.** The fields above are the stable contract — present and non-breaking
across a major `apiVersion`. New fields may be **added** within a major version (additive, never
breaking). `req`/`res` are the raw Node objects and the full escape hatch; reading them is fine,
but prefer the typed fields so a handler keeps working as the host evolves. `user`/`roles` come
from the JWT middleware and are `null`/`[]` until a session exists.

### System capabilities (the `ctx.system` surface)

Most plugins fetch their own data from an upstream service they configure ([the scheduling
reference](examples/plugins/scheduling/) points `SCHEDULING_UPSTREAM` at its backend). A **system
plugin** — one that administers *Plainpages' own* identity stack rather than a domain service —
needs the host's Ory admin clients and the instant-revoke hook instead. The host exposes those on
**`ctx.system`**, and re-exports the client types + their error classes from `#plugin-api`:

```ts
interface SystemCapabilities {          // every field optional — present only when the host wired it
  hydra?: HydraAdmin;                   // OAuth2 client admin (register/list/delete Hydra clients)
  keto?: KetoClient;                    // relationship read/write (groups, roles)
  kratosAdmin?: KratosAdmin;            // identity admin (create/edit/deactivate/delete users)
  revoke?: (sub: string) => void;       // instant-revoke a subject's live tokens (needs the denylist)
}
```

`ctx.system` is **`undefined` unless the host wired at least one** of these (Kratos/Keto configured,
Hydra configured, the [revocation denylist](#instant-revoke-the-optional-denylist) enabled). A system
plugin treats every field as optional and **degrades when absent** — the host never fails a request
over it. The built-in **admin plugin** ([`examples/plugins/admin/`](examples/plugins/admin/)) is the
reference consumer: its Users screen uses `ctx.system.kratosAdmin`, Groups/Roles use `ctx.system.keto`,
OAuth2 clients use `ctx.system.hydra`, and a deactivate/delete or user role-change calls
`ctx.system.revoke` so the change lands now instead of after the JWT TTL; where a capability is missing
the screen renders a themed 503.

This is a **privileged** surface — it hands a plugin the keys to identity and permissions. It's meant
for first-party system plugins you author or vendor, the same trust level as any plugin (the host
doesn't sandbox — [crash-isolation is a non-goal](#overview)). An ordinary domain plugin ignores it.

### Nav & permissions

A plugin's `nav` fragment is merged into the global menu by `composeNav` (`src/ui/nav.ts`), which
applies the central override and then **filters per user** by the roles in the session JWT — a
node shows iff it is `public`, declares no `permission`, or the user's roles include that token. Use
arbitrary depth, counts, and icons; see `composeNav` for the node shape. A node's `icon` is a
**Lucide icon**, referenced by its sprite id (e.g. `i-cal` → lucide `calendar`); the available ids
are `ICON_NAMES` in `src/ui/icons.ts`, and adding one means registering its lucide name there.

#### Public pages & menu items

A route or nav node may be marked **`public: true`** — reachable by **anyone, signed in or not**,
and the menu item shows for everyone. This is the same as omitting `permission` (a no-permission
route/node is already open) but stated outright, so "public" is a **deliberate choice, not the
accident of a forgotten gate**. `public` and `permission` are **mutually exclusive** — declaring
both is contradictory and discovery refuses the plugin at boot.

A public page still renders in the native shell via `ctx.chrome`; for an anonymous visitor
`ctx.user` is `null`, the shell shows a **Sign in** link (`chrome.signInHref`, returning to this page)
in place of the profile/sign-out block, the gated **Dashboard** link is hidden, and `ctx.roles` is
empty (read a role with `can(ctx, …)` to branch). The reference plugin's `/scheduling`
**Overview** is a worked example: it's `public`, so the "Scheduling" menu header shows for everyone,
while the actual shifts list stays behind `scheduling:read`.

**A `permission` token is a coarse role.** The route/nav gate passes iff the user's JWT `roles`
include the token; those roles come from Keto at login, so an operator grants a token by writing the
Keto tuple `Role:<token>#members@user:<id>` (or to a group) — the admin **Roles** screen does this.
(The fine-grained, per-row tier is the separate Keto `Resource` namespace — see
[Three tiers of "may I?"](#three-tiers-of-may-i); it is not what a route `permission` checks.)

Permission tokens are a **shared global namespace** — that's deliberate, so an operator grants
`scheduling:read` once in Keto and every plugin referencing it is gated consistently. Namespace
your tokens as `<id>:<action>` to avoid accidental clashes. Declaring them in `permissions` is
optional but recommended: it documents them, feeds conflict detection, and lets the one-command
bootstrap seed them — the demo admin is granted every discovered plugin's declared tokens, so
a dropped-in plugin works out of the box without editing host config.

### Contract versioning

Each manifest declares `apiVersion` — a **semver** string naming the host contract it was built
against — and the host exposes the current `HOST_API_VERSION` (e.g. `"1.0.0"`). The host bumps
**major** on a breaking manifest/handler change and **minor** on an additive one. At discovery
the host parses both with `parseSemver` (the official semver core regex — strict: no ranges,
`v` prefixes, or leading zeros) and applies provider/consumer semantics in `checkApiVersion`:

| Plugin `apiVersion` vs host | Result | Host action |
| --- | --- | --- |
| same major, same minor (patch ignored) | `ok` | load |
| same major, plugin minor **<** host minor | `warn` | load, log — additive-compatible, newer features exist |
| same major, plugin minor **>** host minor | `refuse` | **abort boot** — plugin needs a newer host |
| different major | `refuse` | **abort boot** — incompatible contract |
| missing / not a valid semver | `refuse` | **abort boot** — must be declared |

The plugin pins one exact version (no ranges — in keeping with the project's pinning rules); the
*host* supplies the caret-style compatibility. `parseSemver`/`checkApiVersion` are tight,
dependency-free functions (the `semver` package's ranges/coercion/prerelease-precedence are more
than the contract needs).

### Conflict rules

Plugins are independent folders, so the host detects collisions across all discovered plugins
with `findConflicts` and resolves them **loudly — never last-write-wins**. `error` aborts boot;
`warn` logs and continues.

| Kind | Level | Rule |
| --- | --- | --- |
| `id` | error | Two plugins share an `id` (folder name). Ids must be globally unique — they namespace the mount path, views/static, and the override target. |
| `route` | error | Two routes resolve to the same `method` + full path. Cross-plugin routes can't collide (the `/<id>` prefix is unique), so this catches a plugin duplicating one of its own. |
| `nav-id` | error | A nav node `id` is used more than once — the central override targets ids, so they must be unique. |
| `home` / `dashboard` | error | More than one plugin declares `home` (or `dashboard`). Each landing page is a single slot, so only one may own it ([The landing pages](#the-landing-pages-home--dashboard)). |
| `permission` | warn | A permission token is declared by more than one plugin. Sharing is legitimate (shared role); namespace as `<id>:<action>` if unintended. |

There is **no separate `basePath` rule**: the mount path is the derived `/<id>`, so its
uniqueness follows from the id check. `permission` is the one intentional overlap, so it warns
rather than aborts; everything else is an error an author fixes before the host will start.

Beyond cross-plugin conflicts, discovery also rejects **per-manifest shape errors** at boot: a
non-array `nav`/`routes`/`permissions`, a non-function `home`/`dashboard`, or a route/nav node that
sets both `public` and `permission` (mutually exclusive — [Public pages](#public-pages--menu-items)).

### Hooks

Optional, for reacting to system actions. A plugin's `hooks` may implement:

| Hook | When | May |
| --- | --- | --- |
| `onBoot()` | after discovery, before the server listens | warm caches, validate upstream config |
| `onRequest(ctx)` | before route matching | inspect, or **short-circuit** by returning a `RouteResult` |
| `onResponse(ctx, result)` | after the handler | observe/log; cannot change the response |

Hooks run in **discovery order** (plugins sorted by id). `onRequest` fires on every request that
reaches routing (static assets bypass it); the **first** hook to return a `RouteResult` wins and
short-circuits — later `onRequest` hooks and the route handler are skipped, and that result renders
against its own plugin's views. `onResponse` runs for a matched route after its handler, with the
handler's result; its return value is ignored. Hooks run with no sandbox — a throwing hook fails
loud (boot for `onBoot`, the request for the others). Keep them cheap; `onRequest` is on the hot
path (the host skips the pipeline entirely when no plugin declares a hook). This surface is
intentionally small and may grow additively within the major version.

### Where plugins live (and how to mount them)

The host scans **`/app/plugins/`** inside the `web` container — so "installing a plugin"
means getting its folder there. There are two ways, depending on where the plugin's source
lives:

**1. In your clone (the default dev loop).** Create `plugins/<id>/` in the working tree.
`docker compose up` already bind-mounts the whole tree (`compose.override.yml`:
`.:/app`), so the folder is live in the container — restart to pick it up. This is the
[Quick-start](#quick-start) path.

**2. A plugin kept in its own repo, or added to a prebuilt image.** Bind-mount the plugin
folder onto `/app/plugins/<id>` with a small compose override. Plugins are stateless, so
mount it read-only:

```yaml
# compose.plugins.yml — mount external plugin folders into the host
services:
  web:
    volumes:
      - ../my-plugin:/app/plugins/my-plugin:ro   # host path : /app/plugins/<id>
```

```bash
# Dev: list the files explicitly (a third file disables the implicit override merge)
docker compose -f compose.yml -f compose.override.yml -f compose.plugins.yml up
# Prod (image already built, no source mount):
docker compose -f compose.yml -f compose.plugins.yml up -d
```

A named volume or volume container works the same way (target `/app/plugins/<id>`), but a
bind mount matches the edit-and-reload loop. For a **baked** production image, just keep
the plugin in the build context and it's `COPY`'d in at build time — pinned and
reproducible; mount a volume only to add plugins to an already-built image.

`#plugin-api` resolves against the *nearest* `package.json`, which at runtime must be the host's
at `/app` — so the mounted `plugins/<id>/` folder must **not** contain a `package.json` of its own
(one there becomes the plugin's scope, lacks the `#plugin-api` mapping, and boot fails loud). A
plugin kept in its own repo therefore mounts as just its subfolder, with the repo's `package.json`
kept outside the mount. To typecheck it against the barrel there, typecheck it mounted under the
host tree, or vendor a type stub of the barrel and map `#plugin-api` to that (an `imports` target
can't escape its own package scope, so it can't point at the host's file directly).

> Discovery — scanning `plugins/`, importing each `plugin.ts` default export, and
> validating it (id, `apiVersion`, conflicts) — runs at boot (`src/plugin-host/discovery.ts`); a bad
> plugin stops startup with a precise message. The router (`src/plugin-host/router.ts`) then mounts
> each route at `/<id>`, resolves `:name` params, runs the permission gate, and turns the
> handler's `RouteResult` into the response; a `view` result renders
> `plugins/<id>/views/<view>.ejs` (`src/plugin-host/view-resolver.ts`), which may `include()` the core
> building-block partials. A plugin's `public/` assets are served at `/public/<id>/`
> (`src/http/static.ts`). The mount mechanics above are how the files get into the container
> either way.

### Local dev & test story

A plugin is a normal folder of TypeScript, so an author tests it the same way the core is tested
— everything in Docker, no host tooling. The reference example (`examples/plugins/scheduling/`) is the
worked example: thin handlers bound to an injectable upstream client, unit-tested in
`shifts.test.ts` with a mocked `fetch` and a hand-built `ctx` (no host).

1. **Unit-test handlers as pure functions.** Keep a handler thin: parse `ctx`, fetch upstream,
   return a `RouteResult`. Test the data-shaping in isolation (mock `fetch`/upstream) with
   `node --test`, exactly like `src/ui/dashboard.test.ts` tests the dashboard model. No host needed.

   ```bash
   docker compose run --rm web npm test
   ```

2. **Run one plugin against the host.** Get the folder into the container's `/app/plugins/<id>`
   — either in your clone (the dev compose bind-mounts the tree) or by bind-mounting an external
   folder ([Where plugins live](#where-plugins-live-and-how-to-mount-them)) — and `docker compose up`;
   the host discovers it. For an isolated harness, the host exposes plugin injection
   (`createApp({ plugins: [myPlugin] })`) so a test can mount a single manifest and assert its
   routes, nav, and gating without the rest of the stack.

3. **E2E the user-facing flow.** Per AGENTS.md §6, ship a side-effect-free Playwright test in
   `e2e-tests/` for each plugin page/form so the suite stays `fullyParallel`, run against the live `web`
   service with the plugin mounted. The reference's permission-gating is covered in `visual.spec.ts`;
   its authenticated list/form happy-path is the full-E2E item (needs cross-host login infra).

The validation an author hits is the same the host runs: bad `apiVersion` or a conflict
([Conflict rules](#conflict-rules)) stops boot with a precise message naming the plugin(s) involved.

## The menu system

The menu is **driven entirely by config** and assembled from two sources:

1. **Plugin fragments** — each plugin contributes its own `nav` (above).
2. **A central override** — `config/menu.ts` (loaded by `src/ui/menu-config.ts`, validated at
   boot) — where the operator reorders, renames, groups, or hides items (by node `id`), and
   sets branding (app name, logo, default theme). The override always wins, applied before
   the per-user filter. A clean clone needs no `config/menu.ts`; defaults apply.

   `config/` is an **empty drop-in mount point** (like `plugins/`): it ships empty, and you
   supply `config/menu.ts` by copying the template ([`examples/config/menu.ts`](examples/config/menu.ts))
   in or bind-mounting your own dir onto `/app/config` (a commented example sits in
   `compose.override.yml`). The file imports its typed builder from **`#menu-config`** (the
   subpath import mapped to `src/ui/menu-config.ts`), so it resolves wherever it's mounted
   (keep the mounted `config/` a plain dir — no `package.json` of its own — or `#menu-config`
   resolves against that instead and boot fails loud):
   ```ts
   import { defineMenu } from "#menu-config";
   export default defineMenu({ branding: { name: "Acme Ops" }, override: { hide: ["teams"] } });
   ```

Every nav item may carry a `permission`; the rendered tree is **filtered per user** by
reading the roles in the session JWT (no per-request authz call — see
[Auth, sessions & permissions](#auth-sessions--permissions)), so the menu only ever shows
what that person can reach. An item (or a whole page) may instead be marked **`public:
true`** to show it to **everyone, signed in or not** — the blessed, explicit way to expose
a public page and its menu entry (a no-permission item is already public; `public` just
says so on purpose, and is mutually exclusive with `permission`). The markup is the
recursive, zero-JS nav tree from the design foundation (header/leaf × clickable/static,
counts, arbitrary depth). Branding (name, logo, default theme) renders in the app shell —
the sidebar brand shows the configured logo (else a default mark), and the theme sets the
theme-switch default.

**One menu, one shell, everywhere.** There is a single menu (`src/ui/chrome.ts`
`buildPluginChrome`), rendered by the same app shell on **every** page — the dashboard, plugin
pages (the admin plugin's screens included), and the login / registration / recovery / front (`/`) pages.
So it looks identical signed in or out; it just shows fewer items to an anonymous visitor
(only `public` ones, plus a Sign-in link), filtered by the same per-user rule. The sidebar
collapses to a burger on a narrow screen. A page that wants a focused, chrome-free layout
(e.g. a print view) opts out with the shell's `menu: false`.

## Building blocks

Plainpages is a **component library, not a page generator** — you assemble pages from
partials and helpers rather than declaring a schema and getting magic. The vocabulary is a
set of reusable EJS partials + TS helpers, fully styled and zero-JS:

- **Partials:** app shell, nav tree, filter bar, data table (sort / select / row actions),
  pagination, form fields, badges, menus, auth cards.
- **Helpers:** `composeNav` (menu from config), `parseListQuery`
  (`?q=…&status=…&sort=…&page=…` → filter/sort/pagination), `paginate` (page math), and the
  auth guards a handler calls to authorize (`src/auth/guards.ts`): `requireSession` (assert a
  session — a `GuardError` the host turns into a redirect to sign in), `can(role)` (a coarse
  JWT-claim check, zero I/O), `check(relation, object)` (the one live Keto call, for
  relationship rules).

## Interactivity: zero-JS spine

The core and all building blocks **work with zero JavaScript** — menus, theme switching,
and filtering are pure CSS + GET forms. On the [low-end, low-bandwidth targets](#overview)
we care about this is usually *faster*: a round-trip returning a small, pre-rendered HTML
page beats a client-side runtime that must boot, fetch JSON, and re-render before anything
shows. List state (`?q=…&status=…&sort=…&page=…`) lives **in the URL**, so a view is
bookmarkable, shareable, and reproducible — the URL is the only state the UI keeps.

Plugins that genuinely need it — live dashboards, bulk actions, client-side validation —
may **opt into progressive enhancement** (htmx, Alpine, or vanilla JS) on top of working
server-rendered HTML. The baseline never depends on it.

## Configuration

Read from the environment once at boot (`src/config.ts`) and validated there — a bad URL,
an out-of-range `PORT`, a non-boolean toggle, or a missing/throwaway enforced secret fails
loud before the server starts. A clean clone needs **none** of these; every value defaults
to the dev stack.

The app is **environment-agnostic**: there is no `NODE_ENV`. Behaviour that used to flip on
"production" is now its own explicit toggle, so a deployment turns on exactly what it wants.
`compose.yml` (base) sets the hardened toggles; `compose.override.yml` (dev, auto-merged by
`docker compose up`) turns them back off for live editing.

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
host-scoped**: the themed login form POSTs to Kratos, and Kratos' CSRF cookie is set on the
host the browser is on. Reach the app on one host but let the form post from another and
that cookie is lost — Kratos rejects the flow and bounces to its error page. (The original
symptom: open the banner's `http://localhost:3000`, sign in, land on
`http://127.0.0.1:3000/error` "Page not found".)

`APP_URL` is the **single source of truth** for the public host. Set it and the web app
**redirects any off-host GET/HEAD visitor to it** (308, path + query preserved) *before* a
flow starts, so the browser, the themed forms, and the cross-origin Kratos POST all share
one cookie host. Static assets under `/public/` are served on any host (so health checks
don't bounce). Everything else derives from the same `APP_URL`: the first-run banner, and —
via compose — Kratos' browser-facing URLs (`compose.override.yml` maps `${APP_URL}` onto
every `ui_url`, return URL, and `allowed_return_urls`). Set `APP_URL` and the whole stack
follows; there is no second place to edit. A genuine Kratos flow error now renders a themed
**`/error`** page (a path back to sign-in), not the catch-all 404.

The redirect is an **explicit opt-in** (per the no-`NODE_ENV` rule): **unset ⇒ no
redirect**, so a deploy that forgets `APP_URL` never bounces real users to a stale default.
The clean clone still works with zero config because the bundled Kratos and the dev stack
both default to `localhost` (the dev override sets `APP_URL=http://localhost:3000`); browse
`localhost:3000` and login just works, and `127.0.0.1` is canonicalised onto it.

> **Behind a reverse proxy:** the proxy must pass the public `Host` through (or rewrite
> Kratos' `base_url`/`ui_url`s to match what the browser sees). If it rewrites `Host` to an
> internal upstream name while `APP_URL` is the public domain, the canonical redirect will
> loop — preserve `Host`.
>
> **Dev caveat (custom host).** Only if you point `APP_URL` at a non-default host (e.g. a
> LAN IP to test from a tablet) must you also point the dev-published Kratos port at that
> host: set `KRATOS_PUBLIC_BROWSER_URL=http://<that-host>:4433/` (it shares `APP_URL`'s host
> but keeps the Ory port, so it can't be `APP_URL` verbatim). In production Ory is fronted
> same-origin, so this doesn't arise.

### What you must supply (the only manual prep)

A clean clone needs **none** of the above — `docker compose up` brings up the whole stack
with dev-throwaway secrets, an auto-generated signing key, and a seeded admin (see
[Quick start](#quick-start)). Exactly **two** things can't be auto-generated, and **both
are production-only** — neither blocks a clean clone:

1. **Production secrets** — replace the committed dev throwaway `CSRF_SECRET` (env), plus
   the **JWT signing key** (mount a real `jwks.json` or set `…_JWKS_URL` — see
   [JWT signing key & rotation](#jwt-signing-key--rotation)). Set
   `REQUIRE_SECURE_SECRETS=true` and the app refuses to boot until `CSRF_SECRET` is supplied
   and differs from the throwaway.
2. **SSO provider client id/secret** — **optional**; password login works without them.
   Supplying a provider's creds via env activates it; no creds ⇒ no SSO button (see
   [Social sign-in (SSO)](#social-sign-in-sso)).

Everything else is generated or seeded on first boot — Ory migrations, the dev signing key,
the demo admin identity and its Keto roles, the Keto OPL model — so there is nothing else to
hand-configure.

### Social sign-in (SSO)

Off by default — a clean clone is password-only. Kratos activates a provider purely from
the environment (no code, no rebuild): set `SELFSERVICE_METHODS_OIDC_ENABLED=true` and
`SELFSERVICE_METHODS_OIDC_CONFIG_PROVIDERS` to a JSON array of providers (`google`,
`microsoft`, …), each carrying its `client_id`/`client_secret` and referencing the committed
claims mapper `ory/kratos/oidc/claims.jsonnet`. The themed sign-in/register pages derive one
button per provider from the live flow's `oidc` nodes, so no creds ⇒ no provider ⇒ no
button, and the whole SSO section disappears when none are configured — no code change to
add or remove one. Open-source Kratos has **no native SAML** — front it with an OIDC bridge
(Ory Polis) and register that bridge as a generic OIDC provider the same way.

## Auth, sessions & permissions

Identity comes from **Kratos**; the hot path stays I/O-free by carrying coarse authorization
in a **locally-validated JWT**, and **Keto** is reserved for the rare fine-grained,
must-be-fresh check.

### Login and the session JWT

The themed sign-in / register / reset / SSO screens drive Kratos self-service flows. **SSO
is optional and self-configuring:** each provider's button renders only when its credentials
are present, and the whole SSO section disappears when none are configured — leaving plain
password login. A developer never has to touch SSO to get started. On success, rather than
keeping the opaque Kratos cookie and calling `whoami` on every request, the app **exchanges
the session for a signed JWT once** via the Kratos **session tokenizer** (`whoami` with a
`tokenize_as` template) and stores it as the session cookie.

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

**Keto is the single source of truth for roles.** Coarse roles are Keto relations (e.g.
`role:admin#members@user:alice`); the admin screens write them *only* to Keto. But the
tokenizer's claims mapper can read only the **identity**, not call Keto — so at login the
app reads the roles from Keto and refreshes a **derived projection**: a read-only copy
written onto the identity's `metadata_public` for the tokenizer to see, which the template
maps into the JWT `roles` claim. (It must be `metadata_public`, not `metadata_admin`: the
session Kratos hands the tokenizer carries only *public* metadata — and the user can already
read these coarse roles in their own JWT, so nothing is leaked.) That projection is a
per-login cache, authoritative nowhere; nothing edits it by hand, and a stale one self-heals
on the next login.

A role can be granted to a user directly or to a **group** the user belongs to; login
resolves both (enumerate the defined roles, ask Keto to resolve each membership), so the JWT
`roles` match what the admin **Effective access** view shows.

Cost: **a handful of Keto reads + one identity refresh per login** — never per request. JWKS
is cached, so even signature verification hits the network only on key rotation. The app
stays stateless; "stay signed in" = re-mint the JWT on a short TTL, the one moment authz is
recomputed from Keto.

#### Two trade-offs — both deliberate

This design buys an I/O-free hot path that scales to **tens of thousands of concurrent
users** on modest hardware. In return:

- **Role changes lag by up to one TTL (~10m).** Gating reads the JWT, not Keto, so a granted
  or revoked role only takes effect when the token is next minted (re-login or TTL refresh).
  For an admin tool this is intentional — the alternative is a Keto call per request, which
  we traded away. For instant revoke, turn on the optional
  [revocation denylist](#instant-revoke-the-optional-denylist) — it closes the gap for
  security-critical cases without putting Keto back on the hot path.
- **Ory is on the critical path for sign-in.** If Kratos is down no one can log in; if it
  stays down past the TTL, existing sessions can't refresh and the UI goes dark. That's the
  direct consequence of being stateless and delegating identity — no local fallback, by
  design. Run Ory with the availability you'd give any auth provider.

### Instant revoke: the optional denylist

Off by default; turn it on with `REVOCATION_DENYLIST=true` (`src/auth/denylist.ts`). For
security-critical revoke (offboarding, a compromised account) the ~10m role/session lag
above is too long. When enabled, an admin **deactivating** or **deleting** a user, or
**granting/revoking** a role to a *user*, records that subject as revoked-now; the hot path
then rejects every token for it minted **before** the revoke and forces a re-mint — which
re-reads roles from Keto, or clears a now-dead session. A fresh re-login (its JWT issued
*after* the revoke) passes, so a role downgrade lands immediately without locking the
account.

It's an in-memory, auto-evicting map — no database, like the JWKS cache, so it stays inside
the stateless model. Entries self-evict after `REVOCATION_TTL_SEC` (default 900s ≥ the 10m
token TTL + skew), by which point any pre-revoke token has expired anyway. The check is pure
CPU — **Keto stays off the hot path**. Two deliberate bounds: it's instant on the **single
instance** that handled the revoke (across replicas/restarts the guarantee falls back to the
token TTL — back the denylist with a shared store for hard multi-instance instant-revoke),
and a **group** membership change is transitive across many users, so it's left to lag —
deactivate the user, or use a direct user-role change, for an instant effect.

### Three tiers of "may I?"

```
  coarse  (menu / route / feature)        → JWT claim     · in-process, zero I/O
  fine + attribute (owner / tenant / …)   → upstream service that owns the row
  fine + relationship (shared / inherited)→ Keto, live check at the action
```

- **Coarse** gates the menu and routes — read straight from the JWT.
- **Attribute-based row rules** (ownership, tenant, status) live in the **upstream service**
  that holds the data: it's the source of truth and the check is free.
- **Relationship-based rules** (sharing, delegation, inherited/transitive access, or authz
  that must mean the same thing across several services) go to **Keto** — that's what ReBAC
  is for. Reserve it for those; don't pay its tuple-sync cost for rules a service can already
  answer from its own data.

The built-in users / groups / permissions screens write authorization **only to Keto** —
coarse roles and fine-grained relationships alike. Roles reach the JWT by being read from
Keto at login and projected through the tokenizer (above); nothing authors them anywhere
else.

### OAuth2 provider (Hydra)

Only relevant when **other apps** authenticate *through* plainpages. The app implements
Hydra's login & consent steps — authenticating the user via their Kratos session — and Hydra
issues the access / refresh / id tokens those apps use. Nothing in the menu or first-party
pages needs Hydra.

The **login challenge** is wired (`src/auth/oauth-login.ts` at `/oauth2/login`): Hydra hands the
browser here, the app resolves it against the Kratos session and accepts (or bounces an
unauthenticated user to the themed login, returning here once signed in). The **consent
challenge** is wired too (`src/auth/oauth-consent.ts` at `/oauth2/consent`): a first-party client
(its Hydra `metadata.first_party: true`) — or one Hydra already skipped — is auto-granted the
requested scopes; any other client gets a themed consent screen (naming the signed-in
account, with a sign-out escape) whose CSRF-guarded Allow/Deny accepts or rejects. id_token
claims (email, name) come from the Kratos identity. RP-initiated **logout** is wired too
(`/oauth2/logout`): Hydra hands the browser here, the app accepts the `logout_challenge` and
resumes to Hydra's post-logout redirect — the first-party `POST /logout` still owns ending
the Kratos session + our JWT cookie.

Those clients are registered from the admin plugin's **OAuth2 clients** screen (`/admin/clients`,
`examples/plugins/admin/admin-clients.ts`, when that plugin is installed): register (Hydra shows the
generated `client_secret` **once**, on the confirmation page — confidential clients), list, and
delete. Confidential vs public (PKCE) and the first-party auto-consent flag are set at registration;
writes go only to Hydra.

## Email

The only emails are the **recovery** and **verification** codes from Kratos' self-service
flows, and **Kratos renders and sends them** (delegated, like the rest of identity — `web`
never touches SMTP). Dev catches them in **mailpit** (<http://localhost:8025>); prod points
Kratos at a real server via `COURIER_SMTP_CONNECTION_URI` (`courier.smtp` in
`ory/kratos/kratos.yml`).

**Customizing the email content** is a built-in Kratos feature — no code here. Set
`courier.template_override_path` to a mounted directory and drop Go templates in it, keyed by
type:

```
<override-path>/recovery_code/valid/email.subject.gotmpl
<override-path>/recovery_code/valid/email.body.gotmpl        (+ email.body.plaintext.gotmpl)
<override-path>/verification_code/valid/email.subject.gotmpl
<override-path>/verification_code/valid/email.body.gotmpl
```

The `ory/kratos/` tree is already mounted into the Kratos container, so an override dir there
is the simplest place. See Ory's
[courier message templates](https://www.ory.sh/docs/kratos/emails-sms/custom-message-templates)
docs for the full template-type list and the data each template receives.

## Architecture

Plainpages runs as a small set of containers, orchestrated by Docker Compose:

| Container      | Role |
| -------------- | ---- |
| `web`          | The Node 24 + TypeScript app: server-rendered EJS, the plugin host, the building-block partials. Stays tiny. |
| `kratos`       | **Ory Kratos** — identity: login, registration, password reset, SSO, sessions. |
| `keto`         | **Ory Keto** — permissions: the authorization decisions (`can user X do Y on Z?`). |
| `hydra`        | **Ory Hydra** — OAuth2/OIDC provider, so other apps can log in *through* plainpages. |
| `postgres`     | **Ory's** storage (Kratos/Keto/Hydra). |

The `web` app is an Ory **relying party**: it never stores passwords. At login it turns
the Kratos session into a short-lived, **locally-validated JWT** (the Kratos session
tokenizer) carrying the user's coarse roles — so every later request gates the menu and
pages by **verifying the JWT in-process, with no per-request call to Ory**. Keto answers
the rarer fine-grained checks; Hydra is used only when the app acts as an OAuth2 **login &
consent provider** for other apps. It reaches the Ory services over their **REST APIs
using Node's built-in `fetch`** — no SDK dependency. See
[Auth, sessions & permissions](#auth-sessions--permissions).

In **dev** the host-facing Ory ports are published — Kratos public `4433` (where the browser
POSTs self-service flows) and Hydra public `4444`; **prod** (`docker compose -f compose.yml
up`) keeps them internal.

So the `web` app is **stateless** and its npm footprint stays tiny — a small, pinned set
of runtime deps (today **`ejs`** for templating, **`lucide-static`** for icons, and
**`@larvit/log`** — itself zero-dependency — for structured/OTLP logging), grown only with
justification and never a framework. Auth, sessions, SSO, and OAuth2 add *services*, not
npm packages; data lives upstream.

### Stateless

Plainpages hold **no state of its own**. The only database in the stack
is **Postgres** and is used by Ory (Kratos/Keto/Hydra); the `web` app never connects
to it.

Plugins are encouraged to save state by **calling an upstream service** from its route handler
— a REST API, an ERP, a plant historian, the customer's own backend — and renders the response with
the building blocks; writes are forwarded the same way. The partials only need rows to
render and don't care where they came from.

This keeps `web` trivially scalable and crash-safe: any instance can serve any request,
because the session lives in Kratos and the data lives upstream.

## Testing

Type check and unit tests run off the Ory stack — units need no Postgres/Kratos/Keto, and
`--no-deps` keeps `web` from dragging up its `depends_on` services:

```bash
docker compose run --rm --no-deps web npm run typecheck   # strict tsc --noEmit
docker compose run --rm --no-deps web npm test            # node --test (units)
```

### End-to-end (Playwright)

E2E runs in the official Playwright image (browsers preinstalled) against the live `web`
service — no Node/browsers on the host. There are five suites:

**Visual + design system** (`visual.spec.ts`) — Ory-free, so it stays fast. It screenshots
the live pages and asserts the rendered design system — the app shell, theme switch, mobile
off-canvas layout, icon sprite, CSRF-guarded sign-out, the public landing, the 404 page, and
plugin permission-gating — the last exercised by bind-mounting the reference example
(`examples/plugins/scheduling/`) onto `/app/plugins/scheduling`.

```bash
docker compose -f compose.yml -f e2e-tests/compose.visual.yml run --build --rm e2e   # run the suite
docker compose -f compose.yml -f e2e-tests/compose.visual.yml down -v                 # tear down after
```

**Auth — token timeout + refresh** (`auth-refresh.spec.ts`) — the full-stack counterpart: it
boots the real Ory stack (Postgres + Kratos + Keto + bootstrap), shortens the session→JWT TTL
to 8s (`ory/kratos/e2e.yml`) and sets `JWT_CLOCK_SKEW_SEC=0`, then logs in the seeded admin
and proves the "stay signed in" hot path: the lapsed JWT is silently **re-minted** from the
live Kratos session (roles re-read from Keto), and once that session is revoked the stale
cookie is **cleared**.

```bash
docker compose -f compose.yml -f e2e-tests/compose.auth.yml run --build --rm e2e   # run the suite
docker compose -f compose.yml -f e2e-tests/compose.auth.yml down -v                 # tear down after
```

**OAuth2 login + consent** (`oauth-login.spec.ts`) — another app logs in *through* us: it
boots the real stack (incl. Hydra), registers an OAuth2 client, starts an authorization flow,
and drives the handlers end-to-end — `/oauth2/login` bounces an unauthenticated user to the
themed login and **accepts** the challenge once a Kratos session exists; `/oauth2/consent`
then shows the consent screen for the third-party client and **Allow** drives Hydra to issue
the authorization code.

```bash
docker compose -f compose.yml -f e2e-tests/compose.oauth.yml run --build --rm e2e   # run the suite
docker compose -f compose.yml -f e2e-tests/compose.oauth.yml down -v                 # tear down after
```

**Full browser flow** (`full-flow.spec.ts`) — the real Playwright UI against the live stack:
the themed **password login** and a **mocked-SSO** login (an in-network mock OIDC provider,
`e2e-tests/mock-oidc.ts`), **menu filtering by role**, the **users/groups/roles** admin CRUD, a
permission-gated **plugin page**, and **logout**. Because the themed form posts straight to
Kratos and cookies are host-scoped, a tiny same-origin gateway (`e2e-tests/proxy.ts`) fronts web +
Kratos on one host (`ory/kratos/e2e-proxy.yml` points Kratos at it) — exactly as a production
reverse proxy would.

```bash
docker compose -f compose.yml -f e2e-tests/compose.full.yml run --build --rm e2e   # run the suite
docker compose -f compose.yml -f e2e-tests/compose.full.yml down -v                 # tear down after
```

`--build` rebuilds the runner so spec edits are always picked up (the image bakes in `e2e-tests/`).

**Dev-stack login regression** (`devstack-login.spec.ts`) — drives the *plain* `docker
compose up` topology (not the same-origin gateway above) with the runner on the **host
network**, so the browser sees `http://localhost:3000` (web) and `http://127.0.0.1:4433`
(Kratos public) exactly as a host browser does. It signs in the seeded admin from the URL the
first-run banner advertises (`http://localhost:3000`) **and** from the wrong host
(`http://127.0.0.1:3000`), asserting both reach the dashboard signed in — the latter via the
[canonical-host redirect](#canonical-host-one-public-url). It guards against the regression
where the advertised login URL dumps the user on the `/error` "Page not found" page; the
proxied full-flow suite can't catch this (it fronts web + Kratos on one origin). Part of
`ci.sh` — it needs host networking and the host ports `3000`/`4433` free (Linux).

```bash
docker compose -f compose.yml -f compose.override.yml -f e2e-tests/compose.devstack.yml run --build --rm e2e   # run it
docker compose -f compose.yml -f compose.override.yml -f e2e-tests/compose.devstack.yml down -v                # tear down
```

Screenshots + an HTML report land in `e2e-tests/artifacts/` (git-ignored). Every user-facing flow
is covered end-to-end; tests are independent and run **fully in parallel** for speed
([AGENTS.md](AGENTS.md)) — keep new tests side-effect-free so the suite stays fast.

### The full gate (one command)

`ci.sh` is the whole gate in one reproducible command — typecheck → unit tests →
each E2E suite against its own fresh stack, with a guaranteed `down -v` after each (even on
failure) and a non-zero exit on the first failure. Run it locally before a release, or wire
it into your CI service:

```bash
bash ci.sh
```

Each E2E suite **owns a clean stack** — never point two suites at one backend (auth-refresh
revokes the admin's sessions; full-flow writes users/groups/roles to Keto), which is why the
gate runs them serially, one stack up/down per suite.

## CI/CD

Gitea Actions (`.gitea/workflows/`) runs the pipeline; the test job runs
[`ci.sh`](#the-full-gate-one-command) — the exact gate you run locally:

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | push, any branch except `main` | the full gate (`bash ci.sh`) |
| `mirror.yml` | push to `main`, or manual | force-push `main` + tags to the [GitHub mirror](https://github.com/larvit/plainpages) |

`main` is not re-tested on push — its commits are meant to arrive already green from a
gated branch, so the status check to gate a merge on is `CI / full-gate (push)`.

**Merge gate on `main`** (Gitea branch protection + repo merge settings, set via the API —
no repo files involved): direct pushes are blocked, changes land via PR only, the
`CI / full-gate (push)` status must be green (admins included), and the only merge style is
**fast-forward-only** — history stays linear and `main`'s head is the exact commit hash of
the merged branch, which is why the branch's push-triggered status carries over.

**GitHub mirror** — [github.com/larvit/plainpages](https://github.com/larvit/plainpages) is a
read-only mirror; after every merge, `mirror.yml` force-pushes `main` and all tags there,
overwriting any drift (refs deleted on Gitea are not pruned). One-time setup: a dedicated
GitHub machine account with write access to the GitHub repo (whose `main` must not block
force-pushes), and a fine-grained PAT scoped to that repo (Contents: read & write), stored
as the Gitea Actions secret `MIRROR_GITHUB_TOKEN` (repo Settings → Actions → Secrets; Gitea
rejects secret names starting with `GITHUB_`/`GITEA_`). Trigger the workflow manually for
the first sync — until the secret exists, the mirror job fails loud on each merge.

**One-time server setup** — register an
[act_runner](https://docs.gitea.com/usage/actions/act-runner) in host mode with the label
`docker-host` (config: `labels: ["docker-host:host"]`) on a machine with Docker Engine +
Compose, git, and Node + github.com access (for `actions/checkout`). Runs must **never
overlap** — the e2e stacks use fixed compose project names and the devstack suite uses host
networking — so register exactly **one** `docker-host` runner, keep its capacity at 1, and
keep host ports 3000/4433 free.

## Production & deployment

```bash
docker compose -f compose.yml up --build -d   # base config only, no source mount
```

`compose.yml` is the full prod stack — web + Postgres + the three Ory services
(Kratos/Keto/Hydra, with migrations + the one-shot bootstrap) — and mounts no source. Secrets
come from the environment (`CSRF_SECRET`, `POSTGRES_USER`/`POSTGRES_PASSWORD`); the base
already sets `REQUIRE_SECURE_SECRETS=true`, so a missing or dev-throwaway `CSRF_SECRET` fails
the boot rather than running insecure.

Before going live, supply the production secrets and any SSO credentials — the **only**
manual prep ([What you must supply](#what-you-must-supply-the-only-manual-prep)); the rest is
auto-generated.

Every response carries security headers (`src/http/security-headers.ts`, set once per request): a
strict `Content-Security-Policy` (the core is **zero-JS** — `script-src 'self'`, no inline
scripts, so an injected `<script>` can't run), `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` + `frame-ancestors 'none'`, `Referrer-Policy`, and — when
`SECURE_COOKIES=true` (https) — HSTS. The CSP allows **same-origin** assets only, so a
branding logo must live under `/public/` (or be a `data:` URI); a plugin route can override
any header per-response via `RouteResult.headers` (e.g. to ship its own JS).

A deep link reached while signed out — or after the ~10m session JWT lapses mid-task —
bounces to the themed sign-in and, once authenticated, returns to the **page that was
requested** (`return_to`, validated **host-relative** by `localPath` in `src/http/safe-url.ts`, so
a crafted `?return_to=` can't turn login completion into an open redirect). If Ory is
unreachable on the sign-in path itself, the user gets an honest **503** ("sign-in is
temporarily unavailable"), distinct from the catch-all 500.

The server drains in-flight requests on `SIGTERM`/`SIGINT` rather than cutting them
mid-response, so container restarts are clean.

The first-boot **bootstrap** is idempotent and runs on every `up` — it generates the JWT
signing key if absent, creates the demo admin in Kratos, and grants it the `admin` role plus
every discovered plugin's declared permission tokens in Keto, so permission checks (and any
dropped-in plugin) resolve out of the box. The web app waits for Kratos + Keto to be healthy
*and* the bootstrap to finish before starting. **Change the demo admin before production.**

## Observability

Logging is **structured** and **OTLP-native**, on
[`@larvit/log`](https://www.npmjs.com/package/@larvit/log) (zero-dependency). One app logger
tags every line with `service.name` (`SERVICE_NAME`, default `plainpages` — brand your own
deployment); each request is cloned into a short-lived **trace span**, made ambient for the
whole handler (an `AsyncLocalStorage`), so logs and traces correlate. Three explicit toggles
(no `NODE_ENV`):

- `LOG_LEVEL` (default `info`) — `error` · `warn` · `info` · `verbose` · `debug` · `silly` ·
  `none`.
- `LOG_FORMAT` — `text` in dev (human-readable), `json` in prod (the base compose sets it)
  for a log pipeline.
- `SERVICE_NAME` — the `service.name` on every log and span.

Every request emits one access line (`method`, `path` — the query is dropped, it can carry
tokens — `status`, `ms`, `requestId`); login/logout, admin writes (who-did-what), and
missing-role/CSRF rejections log at `info`/`warn`, and the catch-all 500 + the
Ory-unreachable re-mint at `error`/`warn`. An inbound W3C `traceparent` is **adopted**, so a
request continues a trace started by an upstream proxy/gateway.

**Distributed tracing — every outbound call.** Because the request logger is ambient, **all**
outbound HTTP — the Kratos/Keto/Hydra clients and the JWKS fetch — runs through it
(`tracedFetch`), so each becomes a **client span** under the request and carries the
`traceparent` downstream (Ory continues the same trace). A **plugin** does the same:
`ctx.log` is its request logger and `ctx.log.fetch(url)` (or defaulting an upstream client to
the exported `tracedFetch`, as the reference plugin does) traces its upstream calls too. The
result is one trace per request spanning web → Ory/upstream.

**OTLP export (off by default).** Point `OTLP_ENDPOINT` at an OpenTelemetry Collector's HTTP
base URI (e.g. `http://otel-collector:4318`) and logs **and** spans also export there — feed
Grafana Loki (logs) + Tempo (traces), or any OTLP backend. `OTLP_PROTOCOL` selects the wire
format (`http/json` default, or `http/protobuf` for collectors that only accept protobuf).
Export is fire-and-forget — it never blocks or fails a served request, and nothing exports
when the endpoint is unset (zero cost). A collector outage is survivable but noisy: each
request's failed export writes a line to stderr (it's retried per request, not queued), so
run a local collector/agent you trust.

## JWT signing key & rotation

The session tokenizer signs each session→JWT with an **ES256** key at
`ory/kratos/tokenizer/jwks.json`. The committed one is a **dev throwaway** (like the
cookie/cipher secrets in `kratos.yml`) — a clean clone works; **never run it in
production**. Mint a fresh key with the bundled generator:

```bash
docker compose run --rm -T --no-deps web node src/auth/gen-jwks.ts > ory/kratos/tokenizer/jwks.json
```

**Install in production.** Two endpoints must read the *same* key material:

- **Kratos (signer)** — mount the file over `…/tokenizer/jwks.json`, or set
  `SESSION_WHOAMI_TOKENIZER_TEMPLATES_PLAINPAGES_JWKS_URL=base64://<the JWKS JSON, base64>`.
- **web (verifier)** — `JWKS_URL` (default `file://…/tokenizer/jwks.json`). A `file://` set
  is re-read live (5-min TTL, plus an immediate reload on an unknown `kid`); a `base64://` set
  is immutable and rotates only on a web redeploy. **For rotation, use `file://` on the web
  side** so it picks up new keys without a restart.

**Why rotation is zero-downtime.** Kratos signs with the **first** key in the set and stamps
its `kid` in each JWT header; web selects the verify key by that `kid`. So a set can hold the
new key *and* the old one at once — tokens minted before and after the swap both verify.

### Scheduled rotation

The token TTL is **10 min** (`kratos.yml` → `whoami.tokenizer.…ttl`); the wait window below
is one TTL + clock skew, round up to **~12 min**. Run from the repo root (paths are
container-relative; with the dev bind-mount they edit the real file).

1. **Prepend a fresh key** (new key first, old key kept) — write via a temp file so the
   shell's `>` can't truncate the input before it's read:
   ```bash
   docker compose run --rm -T --no-deps web sh -c \
     'node src/auth/gen-jwks.ts --prepend ory/kratos/tokenizer/jwks.json' > /tmp/jwks.json \
     && mv /tmp/jwks.json ory/kratos/tokenizer/jwks.json
   ```
2. **Restart Kratos** so it signs with the new first key: `docker compose restart kratos`.
   (web needs no restart — it hot-reloads the file. The hot path verifies JWTs locally, so a
   brief Kratos blip only touches login/re-mint.)
3. **Verify** new logins mint the new `kid` — decode the `plainpages_session` cookie's JWT
   header, or watch web's logs for a `jwks reload on kid miss` debug line as old clients
   present the new key.
4. **Wait ~12 min**, then **prune** the superseded key:
   ```bash
   docker compose run --rm -T --no-deps web sh -c \
     'node src/auth/gen-jwks.ts --prune ory/kratos/tokenizer/jwks.json' > /tmp/jwks.json \
     && mv /tmp/jwks.json ory/kratos/tokenizer/jwks.json
   ```
   No Kratos restart needed — it already signs with that key; this only drops a now-unused
   verify key.

**Rollback** (before the prune): the old key is still in the set, so revert step 1's file and
`restart kratos` — in-flight tokens never broke.

### Emergency rotation (key compromise)

Skip the overlap — you want every token signed with the leaked key to die now. **Replace**
the set with a single fresh key (no `--prepend`):

```bash
docker compose run --rm -T --no-deps web node src/auth/gen-jwks.ts > ory/kratos/tokenizer/jwks.json
docker compose restart kratos
```

Every existing JWT now fails signature verification → its bearer falls back to anonymous and
must re-authenticate (the re-mint only covers *expired* tokens, not bad signatures, so a
forged/leaked-key token can't be silently refreshed). The instant-revoke denylist is
unnecessary here — the signature itself is already invalid.

## Project layout

```
src/                  Node 24 + TypeScript app — strict tsc, no build step. *.test.ts sit beside their module.
  server.ts           Entry point — starts the HTTP server (reads PORT, default 3000)
  config.ts           Env loader — Ory endpoints, cookie/CSRF secrets, JWKS, port; validated at boot
  logger.ts           createLogger()/requestLogger() + the ambient request log (runWithLog/currentLog) and tracedFetch: structured logger (service.name) + per-request trace span on @larvit/log; every outbound fetch joins the trace; OTLP export when OTLP_ENDPOINT set
  *.test.ts (compose/kratos/keto/hydra/postgres)  Topology guards with no source counterpart — assert the compose dev/prod split + ordering and each Ory service's config (they validate ory/ + the compose files)

  http/               Request pipeline + HTTP primitives
    app.ts            createApp(): the request pipeline — security headers, static, canonical host, session verify/re-mint, CSRF, hooks, plugin routes, then the internal route table → RouteResult rendering
    builtin-routes.ts The internal route table's contract: BuiltinRoute + the request's CSRF mint + matchBuiltinRoute() (exact path, GET answers HEAD)
    context.ts        RequestContext handed to handlers + buildContext()
    body.ts           readFormBody(): read + size-cap an x-www-form-urlencoded request body (CSRF gate + forms)
    cookie.ts         Cookie parse + secure Set-Cookie build (session/CSRF cookies)
    static.ts         Static file serving (path-traversal protection) + routePublic(): /public/<id>/ → a plugin's public/
    safe-url.ts       safeUrl() (sanitise an untrusted href/src to relative-or-http(s), exposed to plugins) + localPath() (host-relative redirect-allowlist guard for return_to)
    security-headers.ts  Response security headers set on every reply: strict CSP (zero-JS), nosniff, X-Frame-Options/frame-ancestors, Referrer-Policy, HSTS over https

  auth/               Identity, the session-JWT hot path, guards, and the Ory REST clients
    jwt.ts            JWS signature verify via node:crypto, no jose (decode + verify a compact JWS against one JWK)
    jwt-middleware.ts resolveSession()/authenticate(): per-request session-JWT verify — key by kid → signature → exp/nbf/iss/aud (clock skew) → ctx.user/roles; flags a lapsed token for re-mint
    jwks.ts           JwksProvider — resolve the verify key by kid; createJwksProvider() picks by scheme: staticJwks (base64) or cachingJwks (file/http: TTL cache + rotation-on-miss reload)
    gen-jwks.ts       generateJwks()/rotateJwks() + CLI (mint · --prepend · --prune): the ES256 session-tokenizer signing JWKS; see JWT signing key & rotation
    login.ts          completeLogin()/remintSession(): login completion + TTL re-mint — roles from Keto → metadata_public projection → tokenize → session JWT cookie
    guards.ts         requireSession()/can()/check(): in-handler authorization — the imperative counterpart to the route permission gate; GuardError → 303 /login or 403; check() is the one live Keto "may I?" call
    csrf.ts           CSRF for our own POST forms: signed double-submit token — issue/verify, cookie, request gate
    denylist.ts       Optional instant-revoke denylist: in-memory, auto-evicting; hot path rejects a revoked subject's pre-revoke tokens (REVOCATION_DENYLIST)
    flow-view.ts      buildFlowView(): Kratos self-service Flow → themed view model (fields, hidden csrf, buttons, tone-mapped messages) for views/auth.ejs
    oauth-login.ts    resolveLoginChallenge(): authenticate a Hydra login challenge via the Kratos session → accept, or bounce to /login
    oauth-consent.ts  resolveConsentChallenge()/acceptConsent()/rejectConsent(): auto-accept first-party, else show the consent screen → grant scopes
    routes.ts         buildAuthRoutes(): the built-in auth/OAuth2 endpoints as named handlers on the internal route table — themed flow pages, /oauth2/* challenges, /auth/complete, POST /logout, /error; only what the wired clients support is registered
    bootstrap.ts      One-command bootstrap: idempotent first-boot seed — JWKS-if-absent, demo admin in Kratos, admin role in Keto
    kratos-public.ts  createKratosPublic(): Kratos public-API fetch client — self-service flow init/get/submit, browser logout, whoami, session→JWT tokenize
    kratos-admin.ts   createKratosAdmin(): Kratos admin-API fetch client — identity CRUD + surgical metadata_public update (login role projection)
    keto-client.ts    createKetoClient(): Keto fetch client — check / list / expand relations (read API) + write / delete tuples (write API)
    hydra-admin.ts    createHydraAdmin(): Hydra admin-API fetch client — OAuth2 login + consent challenge get/accept/reject + OAuth2 client CRUD
    fetch-timeout.ts  withTimeout(): bound every outbound Ory call — wrap the injected fetch so each request aborts after a deadline unless the caller passed its own signal; server.ts wires it into the Kratos/Keto/Hydra clients

  plugin-host/        Plugin discovery, routing, hooks, view resolution + the stable author barrel
    plugin.ts         Plugin contract: manifest types, definePlugin(), version + conflict rules + fullPath()
    plugin-api.ts     Stable plugin author barrel — the one module a plugin imports, as `#plugin-api` (definePlugin, ctx/result types, guards, body/CSRF/list-query/paginate helpers, and the ctx.system Ory client types)
    system.ts         SystemCapabilities: the privileged ctx.system surface (Ory admin clients + instant-revoke) a system plugin uses; the host populates it from the wired clients, the admin plugin consumes it
    discovery.ts      discoverPlugins(): scan plugins/, import + validate each plugin.ts default export, fail loud at boot
    router.ts         matchRoute()/allowedMethods()/isAuthorized(): map method+path → plugin route, params, permission gate
    hooks.ts          runBootHooks()/runRequestHooks()/runResponseHooks(): invoke a plugin's optional lifecycle hooks in discovery order; no sandbox (a throwing hook fails loud), skipped when no plugin declares one
    view-resolver.ts  renderPluginView(): render plugins/<id>/views/<view>.ejs; plugin views can include() core partials

  ui/                 Design-system view-models + menu/chrome — the building blocks pages render from
    chrome.ts         buildPluginChrome(): the one global menu + brand/user/theme/csrf every page renders the shell from (unified across all pages) — exposed on ctx.chrome
    shell-context.ts  buildShellContext(): brand/theme/user view-model for the dashboard shell (real signed-in user, no demo profile)
    dashboard.ts      buildDashboardModel(): the gated "/dashboard" app home — a short instructional starter (replace it with a plugin `dashboard` handler); "/" is the public landing (a plugin `home` handler). Both render the one unified menu (ctx.chrome)
    nav.ts            composeNav(): merge plugin nav fragments + central override, role-filter → nav-tree model
    menu-config.ts    loadMenuConfig()/defineMenu(): read config/menu.ts (central override + branding, imported as `#menu-config`), validated at boot
    icons.ts          Used-icon registry + sprite builder from lucide-static (regenerates partials/icons.ejs)
    list-query.ts     parseListQuery(): read a list URL → { q, filters, sort, page, pageSize }
    paginate.ts       paginate(total,page,pageSize): page model (counts, row window, ellipsis sequence) for pagination.ejs

views/               Core EJS templates, all in the one app shell: home (public "/" landing), index (instructional /dashboard), auth (themed Kratos flows), oauth-consent (OAuth2 consent), error (flow-error sink → /error), 403/404/500/503 (503 = Ory-unreachable on sign-in), partials/ (shell, nav tree, filter bar, data table, pagination, field, auth card, alert, landing/flow/consent bodies, menu/popover, theme switch, icon sprite). Domain screens live in plugins, not here — the admin plugin ships its own views/ (incl. its Users/Groups/Roles/Clients + confirm bodies)
public/              Static assets under /public/ (css/styles.css + auth.css, favicon, robots.txt)
config/              Drop-in mount point for the central menu override + branding (config/menu.ts). Ships empty (.gitkeep, git-ignored otherwise) — mount your own or copy the template from examples/config/; defaults apply when absent
ory/                 Ory service config (kratos/: identity schema, kratos.yml, oidc/ SSO claims mapper, tokenizer/ session→JWT claims mapper + dev signing JWKS; keto/: keto.yml + namespaces.keto.ts OPL — role/group/resource; hydra/hydra.yml: OAuth2 issuer + login/consent URLs → /oauth2/*) + storage init (postgres/init/init.sql: one DB per service)
plugins/             Drop-in plugin folders (scanned at /app/plugins; bind-mount or bake in). Ships empty (.gitkeep, git-ignored otherwise) — mount your own; the E2E suites bind-mount the example plugins onto /app/plugins/scheduling and /app/plugins/admin
examples/            Copy-in reference material, mirroring the mount dirs: plugins/scheduling/ (the reference plugin — list/form over an upstream + permission-gated nav), plugins/admin/ (the system-admin plugin — Users/Groups/Roles/OAuth2-clients over Ory via ctx.system), both copied into plugins/; and config/menu.ts (the menu/branding template copied into config/); shifts-upstream/ is the dev mock backend the scheduling plugin reads/writes (stand-in for your real service)
e2e-tests/           Playwright E2E: visual.spec (design system, Ory-free) + auth-refresh.spec (token timeout/re-mint) + oauth-login.spec (OAuth2 login + consent) + full-flow.spec (browser UI: password/SSO login, menu-by-role, admin CRUD, plugin page, logout) + devstack-login.spec (regression: login works from the banner's localhost URL and 127.0.0.1 is canonicalised, on the plain `docker compose up` topology); proxy.ts (same-origin gateway) + mock-oidc.ts (mock SSO provider) back full-flow. e2e-tests/Dockerfile + e2e-tests/compose.{visual,auth,oauth,full,devstack}.yml run them
ci.sh                The full CI gate: typecheck → unit tests → every E2E suite, each on a fresh, always-torn-down stack (`bash ci.sh`)
.gitea/workflows/    Gitea Actions: ci.yml — the full gate (ci.sh) on every branch push except main;
                     mirror.yml — force-sync main + tags to the GitHub mirror; see CI/CD
```

## Extending the core

- **New page in a plugin:** add a route + handler to the plugin manifest and a template in
  its `views/`.
- **Static asset:** drop it in the plugin's `public/`; served at `/public/<plugin>/<path>`.
- **New dependency:** `docker compose run --rm web npm install <pkg>` (updates `package.json`
  + `package-lock.json`), then `docker compose build`. Keep deps minimal — prefer the Node
  standard library, and prefer an Ory REST call over an SDK.

All versions are pinned to **exact, human-readable semantic versions** (no ranges, no
digests): npm deps via `.npmrc` (`save-exact=true`) + the committed lockfile (`npm ci`), and
container images by tag in the `Dockerfile` / compose files (e.g. `node:24.16.0-alpine3.24`,
pinned Ory and Postgres tags).

A plugin's `apiVersion` follows the same pin-it-by-hand spirit: write a **literal** semver — the
host version the plugin was built against — and bump it by hand on rebuild. Never set it from the
host's `HOST_API_VERSION` constant: that would make the plugin always equal the host, so the
compatibility check ([Contract versioning](#contract-versioning)) could never fire and a breaking
change would slip through silently.
