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
/ OAuth2-clients screens are a drop-in plugin. Copy it in to mount them at `/admin/*`:

```bash
cp -r examples/plugins/admin plugins/admin
docker compose up -d
```

The bootstrap grants the seeded admin every permission the installed plugins declare, so the
**Admin** section now shows in the menu. Use `up -d`, not `restart web` — the seed runs in the
one-shot `bootstrap` service, and only `up` re-runs it. See
[`examples/plugins/admin/`](examples/plugins/admin/).

**4. Add your first plugin.** The clone is bind-mounted into the container, so a new
folder under `plugins/` goes live after a restart. Create `plugins/hello/plugin.ts`:

```ts
import { definePlugin } from "@plainpages/plugin-api";

export default definePlugin({
  apiVersion: "0.2.0",
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
**drop a folder in `plugins/`, restart, it's live.** A plugin that declares `permissions` needs
`docker compose up -d` instead, so the seed re-runs and grants them (as in step 3).

From here, render real pages against the app shell and fetch upstream data — see
[Building plugins](#building-plugins) and the runnable reference in
[`examples/plugins/scheduling/`](examples/plugins/scheduling/).

## Contents

- [Overview](#overview)
- [Users, groups & permissions](#users-groups--permissions)
  - [naming a permission](#naming-a-permission)
  - [a worked example](#a-worked-example)
  - [granting a permission](#granting-a-permission)
  - [fine-grained, per-row access](#fine-grained-per-row-access)
- [Building plugins](#building-plugins)
  - [anatomy](#anatomy-of-a-plugin)
  - [the manifest](#the-manifest)
  - [routes & handlers](#routes--handlers)
  - [landing pages](#the-landing-pages-home--dashboard)
  - [RequestContext](#requestcontext)
  - [system capabilities (ctx.system)](#system-capabilities-the-ctxsystem-surface)
  - [nav & permission gates](#nav--permission-gates)
  - [versioning](#contract-versioning)
  - [conflict rules](#conflict-rules)
  - [hooks](#hooks)
  - [where they live & mounting](#where-plugins-live-and-how-to-mount-them)
  - [dependencies](#plugin-dependencies)
  - [settings](#plugin-settings)
  - [storage](#plugin-storage)
  - [local dev & test](#local-dev--test-story)
- [The menu system](#the-menu-system)
- [Building blocks](#building-blocks)
- [Interactivity: zero-JS spine](#interactivity-zero-js-spine)
- [Languages (i18n)](#languages-i18n)
- [Configuration](#configuration)
  - [canonical host](#canonical-host-one-public-url)
  - [what you must supply](#what-you-must-supply-the-only-manual-prep)
  - [SSO](#social-sign-in-sso)
- [Auth, sessions & access](#auth-sessions--access)
  - [login & the session JWT](#login-and-the-session-jwt)
  - [instant revoke](#instant-revoke-the-optional-denylist)
  - [three tiers](#three-tiers-of-may-i)
  - [OAuth2 (Hydra)](#oauth2-provider-hydra)
  - [security model](#security-model)
- [Email](#email)
- [Architecture](#architecture)
  - [Stateless core](#stateless-core)
- [Testing](#testing)
  - [end-to-end](#end-to-end-playwright)
  - [the full gate](#the-full-gate-one-command)
- [CI/CD](#cicd)
  - [one-time setup](#one-time-ci-setup)
- [Production & deployment](#production--deployment)
- [Upgrading](#upgrading)
- [Observability](#observability)
- [JWT signing key & rotation](#jwt-signing-key--rotation)
- [Project layout](#project-layout)
- [Extending the core](#extending-the-core)

## Overview

Plainpages gives you the boring-but-hard parts of a web app — a design system, a menu,
sessions, and access control — and stays out of your domain logic. **Any page can be public
or gated**, so the same foundation serves a public site, a locked-down internal tool, or a
public front with an authenticated area behind it.

- **Included in the core:** themed sign-in / register / reset (Kratos-backed), the design
  system + app shell, the config-driven menu, sessions, and access control. No domain screens.
- **Opt-in admin plugin:** the **users, groups, and OAuth2-clients** screens ship as
  [`examples/plugins/admin/`](examples/plugins/admin/) — an ordinary plugin, reaching Ory through
  the privileged [`ctx.system`](#system-capabilities-the-ctxsystem-surface) surface.
- **You add:** everything else domain-specific, as **plugins** — built from the same building
  blocks the admin plugin uses.

**Priorities:** simplicity, few dependencies, strict TypeScript, no build step, Docker-only,
environment-agnostic (no `NODE_ENV` — every behaviour is an explicit config toggle). Identity,
sessions, SSO, OAuth2 and permission checks are delegated to **Ory** sidecar services. The shape
doesn't change as it grows: every plugin is the same self-contained folder, the hot path is the
same I/O-free JWT check, and there is no app database.

**Plugins are the extension model.** The plugin API is the product's main surface: powerful,
predictable, and overloadable — a plugin can take over as much of a page as it wants. The host
**fails loud at boot/discovery** (bad manifest, version mismatch, conflict) rather than sandboxing
at runtime; crash-isolation is a deliberate non-goal. See [Building plugins](#building-plugins).

**Zero JavaScript**, so pages stay fast on low-end hardware and flaky links. Where a modern CSS
feature removes the need for JS (theme switching, popovers, disclosure) we use it — the trade we
avoid is shipping a client-side runtime, not using the platform. Markup is semantic and accessible
(see [AGENTS.md](AGENTS.md)).

## Users, groups & permissions

Authorization here is two hops: a **user** — directly, or through a **group** — is granted a
**permission**, and that permission's *name* is exactly the string a plugin gates on. Grants are
Keto relation tuples: `Permission:<name>#granted@user:<id>`, or `@Group:<name>#members`.

| Entity | Lives in | Answers | Example |
| --- | --- | --- | --- |
| **User** | Kratos | who you are | `user:0198f2c1-…` |
| **Group** | Keto | who — a reusable set | `Group:support` |
| **Permission** | Keto | what you may do | `Permission:scheduling:read` |
| **Resource** | Keto | which specific row | `Resource:shift-4471` |

Keto's whole model is one primitive — `namespace:object#relation@subject` — so those four
namespaces are *ours*, declared in `ory/keto/namespaces.keto.ts`; Keto resolves them, transitively
through nested groups. The app stores none of it — it is [stateless](#stateless).

> **There is no `Role`.** A route gates on a single operation, so it gates on a **permission**. For
> a bundle ("IT Support staff"), make a group and grant it several — groups nest.
>
> **Ory calls a user an "identity"** (its own docs use the terms interchangeably). Plainpages says
> **user** everywhere; you meet Ory's spelling only in the Kratos API and the `Identity` type in
> `src/auth/kratos-admin.ts` that mirrors it.

### Naming a permission

**Every permission name is `<resource>:<action>`** — `scheduling:read`, `users:write`,
`oauth2-clients:read`. Both halves are lowercase letters, digits, dashes and underscores; discovery
refuses a plugin that breaks the rule, so it holds for every installed plugin.

- **`<resource>`** names the thing acted on, not the plugin that owns it — names are one **global
  namespace**, so an operator grants `scheduling:read` once and every plugin referencing it is gated
  consistently. Pick one no other plugin would claim: `oauth2-clients`, not `clients`.
- **`<action>`** names the operation. `read`/`write` cover most screens; use a specific verb when the
  operation really is distinct (`invoices:approve`).

A bare word like `admin` says *who someone is*, not *what they may do* — that is a role, and roles
are **groups** here. Split by resource and action, then bundle with a group:

```
Group:it-support ──> Permission:users:read, Permission:users:write, Permission:groups:read, …
```

Declaring a permission stays optional, so two plugins may deliberately share a name.

> **A `:write` is not a small grant.** The split contains the **read** half — `users:read` alone is a
> safe helpdesk grant — but `groups:write` lets someone add themselves to a group holding every
> permission, and `users:write` lets them mint a recovery code for any account. Treat both as full
> administrative access.

### A worked example

Alice works support and leads scheduling; Bob works support; Carol administers the system.

```
  people                groups                            permissions
  ──────                ──────                            ───────────

  alice ──┬─────────>  Group:support ────┐
          │                              ├──>  Group:staff ──>  Permission:scheduling:read
  bob ────┘                              │
                                         │
  alice ────────────>  Group:sched-leads ┴──>  Permission:scheduling:write

  carol ────────────>  Group:it-support ─┬──>  Permission:users:read
                                         └──>  Permission:users:write
```

At login the host asks Keto which permissions the user holds, walking those arrows transitively,
and bakes the answer into the session JWT (see [Login and the session
JWT](#login-and-the-session-jwt)) — alice gets `scheduling:read` + `scheduling:write`, bob
`scheduling:read`, carol `users:read` + `users:write`. **Permissions do not nest and there is no
superuser**: carol's Users grant buys nothing on Groups or `/scheduling`.

Against the reference plugins' actual routes:

| Request | Gate | alice | bob | carol | anonymous |
| --- | --- | --- | --- | --- | --- |
| `GET /scheduling` | `public: true` | ✅ | ✅ | ✅ | ✅ |
| `GET /scheduling/shifts` | `scheduling:read` | ✅ | ✅ | 403 | → `/login` |
| `GET /scheduling/shifts/new` | `scheduling:write` | ✅ | 403 | 403 | → `/login` |
| `POST /scheduling/shifts` | `scheduling:write` | ✅ | 403 | 403 | → `/login` |
| `GET /admin/users` | `users:read` | 403 | 403 | ✅ | → `/login` |
| `POST /admin/users` | `users:write` | 403 | 403 | ✅ | → `/login` |
| `GET /admin/groups` | `groups:read` | 403 | 403 | 403 | → `/login` |

Bob reaches the shifts list with no direct grant — `support` → `staff` → `scheduling:read`, two hops
resolved by Keto at his login. An anonymous visitor gets a **redirect** carrying `return_to`, not a
403; a signed-in user who merely lacks the permission gets the 403 page, since there is nothing to
sign in *as* that would help. The menu is filtered by the same permissions, so nobody is shown a
door they cannot open.

### Granting a permission

Write the tuple. The admin plugin's **Users** and **Groups** screens do exactly this — each offers
the declared permissions as a checkbox list — or use Keto's write API directly:

```bash
# everyone in sched-leads may write shifts
curl -X PUT http://keto:4467/admin/relation-tuples -H 'content-type: application/json' -d '{
  "namespace": "Permission", "object": "scheduling:write", "relation": "granted",
  "subject_set": { "namespace": "Group", "object": "sched-leads", "relation": "members" }
}'
```

**A permission's name is authored in plugin code; only its *grants* live in Keto.** A plugin
declares the permissions it gates on (`permissions:` in the manifest) and the host collects them
into one catalog — `ctx.declaredPermissions` — which is the fixed list the admin screens offer.
Nothing in a GUI invents a name, and a tuple naming something no installed plugin declares gates
nothing.

A change takes effect on the user's **next login or JWT re-mint** (~10 min) — see [Instant
revoke](#instant-revoke-the-optional-denylist) when you need it sooner.

### Fine-grained, per-row access

The `Resource` namespace covers what a coarse permission cannot express: *this* row, shared with
*this* person. A `Resource` carries Keto `permits` (`view`, `edit`, `delete`, nesting as `owner` ⊇
`editor` ⊇ `viewer`) and never appears in the JWT.

**A per-row grant never widens a coarse gate** — the route's `permission` is checked before the
handler runs. Gate the route on something they hold, then narrow inside the handler:

```ts
{ method: "POST", path: "/shifts/:id", permission: READ, handler: editShift }

async function editShift(ctx) {
  if (!(await check(keto, ctx, { namespace: "Resource", object: ctx.params.id, relation: "editors" })))
    throw new GuardError(403, "not an editor of this shift");
  …
}
```

Reserve this tier for relationship rules (sharing, delegation, inheritance). Ownership and tenant
rules belong in the upstream service that holds the row — see [Three tiers of "may
I?"](#three-tiers-of-may-i).

## Building plugins

A plugin is a self-contained folder under `plugins/` that the host discovers at boot — no
registration step, no central wiring. Each plugin carries its own nav, routes, views, and CSS.

The contract is **TypeScript** (`src/plugin-host/plugin.ts`); the types there are the source of
truth and the sections below explain them and the rules the host enforces. A runnable example lives
in **[`examples/plugins/scheduling/`](examples/plugins/scheduling/)** — a public overview page, a
permission-gated list page over an upstream service, a CSRF-guarded form, and a mix of public +
gated nav. `plugins/` ships empty, so copy it in to run it
(`cp -r examples/plugins/scheduling plugins/scheduling`, then restart); the dev compose already
points `SCHEDULING_UPSTREAM` at its mock backend (`examples/shifts-upstream/`).

### Anatomy of a plugin

```
plugins/things/          # the plugin folder — its name is the id AND the mount path (→ /things)
  plugin.ts              # REQUIRED — the one fixed filename; default-exports the manifest (definePlugin(...))
  views/                 # fixed name, optional — EJS the host renders for a { view } result
    things.ejs           #   your view files; a handler picks one with { view: "things" }
  public/                # fixed name, optional — static assets, served at /public/things/
    things.css           #   your asset files
  i18n/                  # fixed name, optional — this plugin's own catalogs (see Languages)
    en-US.ts             #   the baseline; sv-SE.ts et al are written against its type
  handlers.ts            # your code, any names/layout — host never looks here; plugin.ts imports it
  service.ts             #   e.g. route handlers, upstream calls, domain helpers — design as you wish
  package.json           # optional — only if you depend on npm packages (see Plugin dependencies)
  node_modules/          #   yours, installed from your own lockfile
```

**Only `plugin.ts` is required.** `views/`, `public/` and `i18n/` are fixed folder *names* the host
resolves against, but the files inside are yours to name. Everything else — handlers, upstream
clients, their layout — the host never sees; `plugin.ts` simply imports it.

**Identity comes from the folder.** The folder name *is* the plugin `id` and the mount path is
`/<id>`; neither is in the manifest, so they can't drift or be claimed twice. The id must be
URL/path-safe (`isValidPluginId`: lowercase `a–z`, digits, dashes) and also namespaces the plugin's
`views/`, its `/public/<id>/` assets, and by convention its nav/permission names.

`RESERVED_PLUGIN_IDS` are refused at discovery — the gated `dashboard`, the Kratos auth flows
(`auth`, `login`, `logout`, `recovery`, `registration`, `settings`, `verification`), the `oauth2`
provider routes, and `public` — since plugin routes resolve first and a folder claiming one would
silently shadow a built-in. `admin` is **not** reserved: the admin screens are themselves a plugin.

Installing a plugin is "drop the folder, restart"; removing one is "delete the folder, restart".

### The manifest

A plugin imports its host surface from one module — **`@plainpages/plugin-api`** (`definePlugin`, the
manifest/handler types, `RequestContext`, the guards, and the body/CSRF/list-query helpers). The host
publishes it as a package, so it resolves from any depth and from a plugin folder that has a
`package.json` of its own ([Plugin dependencies](#plugin-dependencies)). That barrel **is** the
contract boundary — never a relative `../../src/...` path; the host refactors everything behind it
freely.

```ts
import { definePlugin } from "@plainpages/plugin-api";
import { listThings, createThings } from "./handlers.ts";

export default definePlugin({
  apiVersion: "0.2.0",                // semver string of the host contract this plugin was built against (see Versioning)

  // Nav fragment, merged into the global menu and permission-filtered per user.
  // `icon` is a Lucide icon by its sprite id (src/ui/icons.ts).
  nav: [{ href: "/things", icon: "i-cal", id: "things:list", label: "Things", permission: "things:read" }],

  // Permissions this plugin gates on. Optional — see Nav & permission gates.
  permissions: [
    { description: "View things", name: "things:read" },
    { description: "Create and edit things", name: "things:write" },
  ],

  // Route handlers, mounted under the plugin's path (/things). `permission` gates first.
  routes: [
    { method: "GET",  path: "/", permission: "things:read",  handler: listThings },
    { method: "POST", path: "/", permission: "things:write", handler: createThings },
  ],
});
```

`definePlugin()` only types the object (`PluginManifest`) and returns it unchanged — a manifest may
equally be a plain typed object. All validation happens at discovery, and the host attaches the
folder-derived `id` to produce the loaded `Plugin`.

| Field | Required | Notes |
| --- | --- | --- |
| `apiVersion` | yes | Semver string of the host contract the plugin was built against. See [Versioning](#contract-versioning). |
| `home` | no | A `RouteHandler` that owns the **public** landing `/`. At most one plugin may declare it. See [The landing pages](#the-landing-pages-home--dashboard). |
| `dashboard` | no | A `RouteHandler` that owns the **gated** app home `/dashboard`. At most one plugin may declare it. See [The landing pages](#the-landing-pages-home--dashboard). |
| `nav` | no | `NavNode[]` fragment (same shape `composeNav` consumes). `icon` is a Lucide sprite id (`src/ui/icons.ts`); node `id`s must be globally unique. A `label` that names a catalog key is [translated](#languages-i18n); anything else renders as written. |
| `permissions` | no | Permissions this plugin gates on. See [Nav & permission gates](#nav--permission-gates). |
| `routes` | no | See [Routes & handlers](#routes--handlers). |
| `hooks` | no | See [Hooks](#hooks). |
| `settings` | no | Configuration this plugin accepts, one `PLUGIN_SETTING_<ID>_<KEY>` variable per key, resolved and validated at boot and handed to `onBoot`. See [Plugin settings](#plugin-settings). |
| `storage` | no | `true` ⇒ the host provisions a Postgres database and login role for this plugin and hands the credentials to `onBoot`. See [Plugin storage](#plugin-storage). |

A plugin may be routes-only, nav-only, or hooks-only — every collection field is optional.

### Routes & handlers

A route is `{ method, path, permission?, public?, handler }`. `path` is **relative to the plugin's
mount path `/<id>`** (so `path: "/:id"` in the `things` plugin serves `/things/:id`); the host matches
`method` + the resolved full path, extracts `:name` segments into `ctx.params.name`, runs the
`permission` gate ([a coarse JWT-claim check](#nav--permission-gates)), then calls the handler with
the [request context](#requestcontext). A failed gate redirects an **anonymous** visitor to `/login`
with the page as `return_to`; a **signed-in** user lacking the permission gets the **403** page.
`public: true` means no gate at all (see [Public pages](#public-pages--menu-items)).

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
import { parseListQuery, type RequestContext } from "@plainpages/plugin-api";

export async function listThings(ctx: RequestContext) {
  const q = parseListQuery(ctx.url);
  const rows = await fetch(`${upstream}/things?${ctx.url.searchParams}`).then((r) => r.json());
  return { view: "things", data: { rows, q } }; // renders plugins/things/views/things.ejs
}
```

- **`view`** resolves against the plugin's own `views/` (`src/plugin-host/view-resolver.ts`) —
  nested names like `"things/edit"` work, out-of-bounds names are refused. The template may
  `include()` the core building-block partials and its own. To load the plugin's own CSS, pass its
  `/public/<id>/x.css` href in the shell's `styles` slot — see the reference's `views/shifts.ejs`.
- **Finer authorization than the route `permission`** uses the guards from `@plainpages/plugin-api`:
  `requireSession(ctx)`, `can(ctx, permission)` (coarse JWT-claim check, zero I/O), and
  `check(keto, ctx, {namespace, object, relation})` (a live Keto check; anonymous ⇒ denied). Throw
  `new GuardError(403, …)` after a failed `can`/`check` to render the 403 page.
- The handler **fetches its own data** — from upstream, or from the plugin's own
  [storage](#plugin-storage); the host holds none of it (see [Stateless core](#stateless-core)).
- Default status: `200` for `view`/`html`/`json`, `303` for `redirect`.

#### Escaping & the trust boundary

The host does not sandbox plugin output, so a handler **owns the safety of the data it renders**:

- **Raw HTML is raw.** An `{ html }` result and the `*.html` partial fields (`cell.html`,
  `error.html`, a menu `trigger.html`) are emitted **unescaped** — that's their purpose. Escape
  untrusted content before putting it there.
- **Text is auto-escaped; URLs are not scheme-checked.** A URL field — nav `href`, a table cell
  link, a menu item, a breadcrumb, `brand.logo` — is emitted as-is inside the attribute, so a
  `javascript:` or `data:` URL from upstream data becomes live XSS. Pass any URL you don't control
  through **`safeUrl()`** from `@plainpages/plugin-api`; it collapses anything but relative/`http(s):` to `"#"`:
  ```ts
  import { safeUrl } from "@plainpages/plugin-api";
  return { view: "list", data: { rows: rows.map((r) => ({ ...r, href: safeUrl(r.href) })) } };
  ```

### The landing pages (`home` & `dashboard`)

The host has two replaceable landing slots, and a plugin may own either or both:

| Slot | Path | Gate | Default |
| --- | --- | --- | --- |
| `home` | `/` | **public** — anyone | An intro page with prominent sign-in / register links. |
| `dashboard` | `/dashboard` | **signed-in session** (anonymous → `/login`, with `/dashboard` as `return_to`) | The built-in mock-data People list. |

```ts
import { definePlugin } from "@plainpages/plugin-api";
import { landing, board } from "./pages.ts";

export default definePlugin({
  apiVersion: "0.2.0",
  home: landing,     // owns "/" — the public front page
  dashboard: board,  // owns "/dashboard" — the post-login app home
});
```

Each is a `RouteHandler` like any route's — it receives the [`RequestContext`](#requestcontext) and
returns a `RouteResult`, typically a `view` from the plugin's own `views/`, rendered against the
native app shell via `ctx.chrome`. On `home` (public) `ctx.user` may be `null`; on `dashboard` the
host enforces the session gate first, so it is non-null — branch on `ctx.permissions` *inside*
rather than gating `dashboard` on a permission, since there is no second dashboard to fall back to.
Both slots answer `GET` and `HEAD`.

Only **one** plugin may own each slot — two claiming either is a boot-stopping
[conflict](#conflict-rules). Neither needs a `routes` entry; the host mounts them above the `/<id>`
route namespace.

### RequestContext

Every handler receives one argument, the `RequestContext` (`src/http/context.ts`), built once per
request:

```ts
interface RequestContext {
  chrome: PageChrome;                // brand/global-nav/user/theme/csrf for the native app shell
  user: User | null;                 // { id, email, permissions } from the verified session JWT, or null
  log: Log;                          // request-scoped logger, in this request's trace
  params: Record<string, string>;   // path params from the route match, e.g. /things/:id → { id }
  t: Translate;                      // t(key, vars) in this request's language (see Languages); an unknown key renders as itself
  locale: string;                    // the locale being served, e.g. "sv-SE"
  locales: string[];                 // every installed locale, sorted
  localeHref(href): string;          // carry an explicitly chosen locale onto a link this page renders
  query: URLSearchParams;            // alias of url.searchParams
  req: IncomingMessage;
  res: ServerResponse;
  permissions: string[];                   // user?.permissions ?? [] — coarse gate without a null-check
  declaredPermissions: readonly PermissionDecl[]; // every permission the installed plugins declare, deduped + sorted — what *exists*, vs `permissions` = what this user *holds*
  system?: SystemCapabilities;       // privileged Ory clients + instant-revoke, for a system plugin (see below); undefined unless the host wired them
  url: URL;
  verifyCsrf(submitted): boolean;    // gate a form POST against the request's signed CSRF cookie
}
```

**`ctx.chrome`** — `{ brand, csrfToken, nav, signInHref, theme, user }`. Hand each field to the
matching `partials/shell` local and a `view` result renders the **native app shell**, exactly as
`examples/plugins/scheduling/views/overview.ejs` does; a field you omit falls back to its shell
default rather than erroring. `chrome.nav` is the whole global menu — every installed plugin's
fragment, already composed, permission-filtered and current-marked for this request.
`chrome.signInHref` carries the current page as `return_to`. The same shell renders **every** page,
so the menu looks identical signed in or out; `menu: false` drops the sidebar for a focused layout.

**`ctx.verifyCsrf(submitted)`** guards a state-changing form: render `chrome.csrfToken` in a hidden
`_csrf` field, then on POST `if (!ctx.verifyCsrf(form.get("_csrf"))) throw new GuardError(403, …)`.
The host owns the secret and sets the cookie. It is **opt-in per handler** — a route that never
calls it has no CSRF guard at all.

**`ctx.t`** translates in the request's language; the same block (`t`, `locale`, `locales`,
`localeHref`, `dir`) is merged into every view's data — see [Languages](#languages-i18n).

**`ctx.log`** is a request-scoped [`@larvit/log`](https://www.npmjs.com/package/@larvit/log) logger
already in this request's trace: `ctx.log.info("…", { key: "value" })`, and
**`ctx.log.fetch(url, init?)`** — a drop-in `fetch` that adds a client span and propagates
`traceparent` downstream. The barrel also exports a standalone **`tracedFetch`** (reads the ambient
request log) to default an upstream client's `fetch` to, as the reference plugin's `createUpstream`
does. Output, level and OTLP export are the host's config.

**Stability guarantee.** These fields are present and non-breaking across a major `apiVersion`; new
ones may be added within it. `req`/`res` are the raw Node escape hatch — prefer the typed fields.

### System capabilities (the `ctx.system` surface)

Most plugins fetch their own data from an upstream service they configure. A **system plugin** — one
that administers *Plainpages' own* identity stack — needs the host's Ory admin clients and the
instant-revoke hook instead. The host exposes those on **`ctx.system`**, and re-exports the client
types + their error classes from `@plainpages/plugin-api`:

```ts
interface SystemCapabilities {          // every field optional — present only when the host wired it
  hydra?: HydraAdmin;                   // OAuth2 client admin (register/list/delete Hydra clients)
  keto?: KetoClient;                    // relationship read/write (groups, permissions)
  kratosAdmin?: KratosAdmin;            // identity admin (create/edit/deactivate/delete users)
  revoke?: (sub: string) => void;       // instant-revoke a subject's live tokens (needs the denylist)
}
```

`ctx.system` is **`undefined` unless the host wired at least one** of these. A system plugin treats
every field as optional and **degrades when absent** — the host never fails a request over it. The
**admin plugin** ([`examples/plugins/admin/`](examples/plugins/admin/)) is the reference consumer:
Users uses `kratosAdmin`, Groups and the permission pickers `keto`, OAuth2 clients `hydra`, and a
deactivate/delete or user permission-change calls `revoke` so the change lands before the JWT TTL;
a missing capability renders a themed 503.

This is a **privileged** surface — the keys to identity and authorization — meant for first-party
system plugins you author or vendor. An ordinary domain plugin ignores it.

### Nav & permission gates

A plugin's `nav` fragment is merged into the global menu by `composeNav` (`src/ui/nav.ts`), which
applies the central override and then **filters per user** by the permissions in the session JWT: a
node shows iff it is `public`, declares no `permission`, or the user holds that name. A node's `icon`
is a **Lucide icon** by sprite id (e.g. `i-cal` → lucide `calendar`); the available ids are
`ICON_NAMES` in `src/ui/icons.ts`, and adding one means registering its lucide name there.

**Gating a section header.** A `permission` on the header takes the whole subtree with it. When the
children need *different* permissions, leave the header ungated and gate each child — `composeNav`
drops a header whose children all filtered out. That only works while the header carries **no
`href`**: give it one and it survives as an ungated leaf, visible to everyone.

#### Public pages & menu items

A route or nav node marked **`public: true`** is reachable by anyone and shows in everyone's menu.
That is the same as omitting `permission`, but stated outright so public is a deliberate choice
rather than a forgotten gate. The two are **mutually exclusive** — declaring both is refused at boot.

A public page still renders in the native shell; for an anonymous visitor `ctx.user` is `null`, the
shell shows a **Sign in** link in place of the profile block, the gated **Dashboard** link is hidden,
and `ctx.permissions` is empty (branch with `can(ctx, …)`). The reference plugin's `/scheduling`
Overview is public while its shifts list stays behind `scheduling:read`.

Declaring the permissions you gate on is **optional but recommended**: it documents them, feeds
conflict detection, and lets the bootstrap seed them onto the demo admin, so a dropped-in plugin
works without editing host config.

### Contract versioning

Each manifest declares `apiVersion` — a **semver** string naming the **Plainpages release** it was
built against. The host's `HOST_API_VERSION` *is* its release version, so a plugin author reads one
version off the image they run and writes it down — there is no separate contract number. Both
release paths refuse a tag whose `major.minor` disagrees with the constant, so the two cannot drift.

Patch releases are invisible here — `checkApiVersion` ignores the patch digit, which is what lets
dependency updates ship continuously without touching any plugin. At discovery the host parses both
versions with `parseSemver` (strict: no ranges, `v` prefixes, or leading zeros) and applies
provider/consumer semantics in `checkApiVersion`:

| Plugin `apiVersion` vs host | Result | Host action |
| --- | --- | --- |
| same major, same minor (patch ignored) | `ok` | load |
| **major `0`**, plugin minor **<** host minor | `refuse` | **abort boot** — pre-1.0 the minor is the breaking slot |
| same major, plugin minor **<** host minor | `warn` | load, log — built against an older release; check that release's notes |
| same major, plugin minor **>** host minor | `refuse` | **abort boot** — plugin needs a newer host |
| different major | `refuse` | **abort boot** — incompatible contract |
| missing / not a valid semver | `refuse` | **abort boot** — must be declared |

The plugin pins one exact version (no ranges, per the project's pinning rules); the *host* supplies
the compatibility. One digit carries the whole release, so a **minor** means either the plugin
contract changed or a dependency moved far enough to warrant one.


### Conflict rules

The host detects collisions across all discovered plugins with `findConflicts` and resolves them
**loudly — never last-write-wins**. `error` aborts boot; `warn` logs and continues.

| Kind | Level | Rule |
| --- | --- | --- |
| `id` | error | Two plugins share an `id` (folder name). Ids must be globally unique — they namespace the mount path, views/static, and the override target. |
| `route` | error | Two routes resolve to the same `method` + full path. Cross-plugin routes can't collide (the `/<id>` prefix is unique), so this catches a plugin duplicating one of its own. |
| `nav-id` | error | A nav node `id` is used more than once — the central override targets ids, so they must be unique. |
| `home` / `dashboard` | error | More than one plugin declares `home` (or `dashboard`). Each landing page is a single slot, so only one may own it ([The landing pages](#the-landing-pages-home--dashboard)). |
| `permission` | warn | A permission name is declared by more than one plugin. Sharing is legitimate; pick a more specific [`<resource>`](#naming-a-permission) if unintended. |

Mount-path uniqueness needs no rule of its own — it follows from the id check. Discovery also
rejects **per-manifest shape errors**: a non-array `nav`/`routes`/`permissions`, a non-function
`home`/`dashboard`, a permission name that isn't [`<resource>:<action>`](#naming-a-permission), or a
route/nav node setting both `public` and `permission`.

### Hooks

Optional, for reacting to system actions. A plugin's `hooks` may implement:

| Hook | When | May |
| --- | --- | --- |
| `onBoot(host)` | after discovery, before the server listens | warm caches, validate upstream config, open a [storage](#plugin-storage) connection |
| `onRequest(ctx)` | before route matching | inspect, or **short-circuit** by returning a `RouteResult` |
| `onResponse(ctx, result)` | after the handler | observe/log; cannot change the response |

`onBoot`'s `host` is a `BootContext`, carrying `storage` for a plugin that declared it. A hook
written without a parameter stays valid.

Hooks run in **discovery order** (plugins sorted by id). `onRequest` fires on every request that
reaches routing (static assets bypass it); the **first** hook to return a `RouteResult` short-circuits
— later hooks and the route handler are skipped, and that result renders against its own plugin's
views. `onResponse` runs after a matched route's handler; its return value is ignored. Hooks are not
sandboxed — a throwing hook fails loud (boot for `onBoot`, the request for the others). Keep them
cheap: `onRequest` is on the hot path, though the host skips the pipeline entirely when no plugin
declares a hook.

### Where plugins live (and how to mount them)

The host scans **`/app/plugins/`** inside the `web` container, so "installing a plugin" means
getting its folder there.

**1. In your clone (the default dev loop).** Create `plugins/<id>/`; `docker compose up`
bind-mounts the whole tree (`compose.override.yml`: `.:/app`), so a restart picks it up.

**2. A plugin kept in its own repo, or added to a prebuilt image.** Bind-mount the plugin
folder onto `/app/plugins/<id>` with a small compose override. A plugin folder is code, not data —
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

A named volume works the same way (target `/app/plugins/<id>`). For a **baked** production image,
keep the plugin in the build context and it is `COPY`'d in at build time.

A plugin kept in its own repo mounts whole, `package.json` and all — see below.

### Plugin dependencies

A plugin may depend on npm packages. It owns them completely: its `package.json`, its lockfile and
its `node_modules` live in the plugin folder, and nothing about them reaches the host's — installing
a plugin is still just getting its folder to `/app/plugins/<id>`.

Write the manifest yourself — `"type": "module"` is required, and the host refuses a plugin without
it, because that file (not the host's) is what tells Node how to parse everything beside it:

```json
{ "name": "things", "version": "0.0.0", "type": "module" }
```

Add a `plugins/things/.npmrc` too. The root one does not reach a `--prefix`, so without it npm writes
ranges rather than the exact pins this project keeps everywhere:

```ini
save-exact=true
```

Then install into the folder:

```bash
# The uid keeps the files it writes yours rather than root's.
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" web npm install --prefix plugins/things ms
```

A plugin in its own repo runs its own `npm ci` instead and mounts the result — `node_modules`
included, since the plugin folder *is* the repo. A baked image needs no extra step: the plugin's
`node_modules` is part of the build context and is `COPY`'d in with the rest of the folder.

- **Never ship a copy of `@plainpages/plugin-api`.** The host publishes it into `/node_modules`,
  above every plugin, and a plugin resolves it from there — nothing to declare, just import it. A
  copy inside your plugin's own `node_modules` would shadow it with a *second* instance of the host's
  contract, turning a sign-in redirect into a 500, so discovery refuses one there at boot.
- **The host never upgrades or dedupes your dependencies.** Two plugins depending on the same package
  each get their own copy at their own version, so neither can break the other by upgrading — and
  keeping yours current, and audited, is yours to own. Renovate here watches every manifest in this
  repo, the example plugins included — a plugin in its own repo needs its own.
- **Depend on packages that ship JavaScript.** Node refuses to strip types under `node_modules`, so a
  dependency whose entry is `.ts` fails at import with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.

`npm run typecheck` covers `plugins/`, so a dependency shipping no types of its own needs its
`@types/…` in your plugin's `devDependencies`. Typechecking a plugin repo standalone still needs the
barrel's types on disk: typecheck it mounted under the host tree, or vendor a type stub **outside
`node_modules`** and point tsconfig `paths` at it — a stub inside is the shadowing copy discovery
refuses, and it would travel with the folder you mount.

### Plugin settings

A plugin declares the configuration it accepts, and the host resolves it from the environment at
boot. Each key becomes one variable — `PLUGIN_SETTING_<ID>_<KEY>`, the id's dashes and the key's
camel humps both becoming underscores — so `upstream` on the `scheduling` plugin is set by
`PLUGIN_SETTING_SCHEDULING_UPSTREAM`.

```ts
export default definePlugin({
  apiVersion: "0.2.0",
  settings: [
    { key: "upstream", type: "url", required: true, description: "Base URL of the backend" },
    { key: "pageSize", type: "number", default: 25 },
    { key: "mode", type: "enum", values: ["strict", "lenient"], default: "strict" },
    { key: "apiKey", type: "string", secret: true, default: "dev-insecure-key" },
  ],
  hooks: {
    onBoot: ({ settings }) => {
      settings.upstream; // string  — required, so the boot already refused without it
      settings.pageSize; // number  — defaulted, so always present
      start(settings);
    },
  },
});
```

`type` is one of `string`, `number`, `boolean`, `enum` (with `values`) or `url`. A declared type is
coerced and checked at boot, so a mistyped value names the plugin, the key and the variable instead
of surfacing later as a broken page.

**`required` and `default` are mutually exclusive** — a default means the setting can never fail, so
declaring both is refused at discovery. That leaves three cases, and the type `onBoot` receives
follows them exactly: `required: true` is always present, a `default` is always present, and a
setting with neither is `T | undefined`, so the plugin has to handle its absence.

**Secrets.** `secret: true` marks a value the host reads but never renders — not in a boot log, not
in an error, not on the admin screen, which shows only whether it resolved and from where. With
`REQUIRE_SECURE_SECRETS=true` a secret that is unset, or still equal to its declared default, refuses
the boot — the same rule the host applies to its own secrets.

**Where it fails, and where it warns.** A malformed declaration is refused at discovery; a missing
`required` value or a value that will not coerce refuses the boot. A `PLUGIN_SETTING_` variable no
installed plugin declares is only *reported* — it is usually a typo in the one the operator meant to
set, and naming it turns two unrelated-looking errors into one. Declaring settings without an
`onBoot` warns too: they resolve, but nothing receives them.

**Reading what a deployment is configured with.** The admin plugin's **Plugin settings** screen
(`plugin-settings:read`) lists every installed plugin, its declared keys, the variable that sets
each, and whether the value came from the environment or the declared default.

### Plugin storage

A plugin that needs to keep data sets `storage: true`. The host then provisions a Postgres
**database and login role of its own** — both named `plugin_<id>` — and hands the credentials to
`onBoot`:

```ts
import postgres from "postgres";              // your dependency, not the host's
import { definePlugin } from "@plainpages/plugin-api";

let sql: ReturnType<typeof postgres>;

export default definePlugin({
  apiVersion: "0.2.0",
  storage: true,
  hooks: {
    onBoot: async (boot) => {
      if (!boot.storage) throw new Error("things: storage was not provisioned");
      sql = postgres(boot.storage.url);
      // Every web instance runs onBoot, and concurrent CREATE TABLE IF NOT EXISTS is an error in
      // Postgres — the lock is released when the transaction ends.
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext('things:schema'))`;
        await tx`CREATE TABLE IF NOT EXISTS things (id uuid PRIMARY KEY, name text NOT NULL)`;
      });
    },
  },
});
```

`boot.storage` is a `StorageCredentials` — `database`, `host`, `password`, `port`, `user`, and `url`,
the same values pre-assembled as a DSN, which most clients take directly. It is typed optional, so
the guard above is expected of every storage plugin rather than a sign something is wrong.

**Credentials, not a client.** The host has no opinion on how you reach Postgres: depend on
`postgres`, `pg`, a query builder or an ORM ([Plugin dependencies](#plugin-dependencies)). No driver
is part of the contract, so upgrading yours is yours alone to time. The flip side is that pool sizing
is yours too — keep yours under `PLUGIN_DB_CONNECTION_LIMIT` (default 10), the per-role ceiling the
host sets so one plugin cannot exhaust the Postgres this stack shares with Ory.

**The schema is yours, migrations included.** The host creates the database empty, never reads or
writes inside it, and ships no migration machinery — evolving your tables compatibly (expand, then
contract, so a rolled-back version still runs) is yours to own. Create your tables in `onBoot`: it
runs before the server listens, so a failure aborts boot instead of surfacing later as a broken page.

What the host does guarantee:

- **One database and one role per plugin**, with `CONNECT` revoked from `PUBLIC`. This bounds
  *accidents* — a wrong database name, a mistyped DSN, a stray query — and it is not a security
  boundary: plugins share the `web` process, so a plugin that goes looking can reach another's
  credentials. Install plugins you trust ([Security model](#security-model)).
- **Provisioning is idempotent and runs every boot**, so a plugin dropped in later is picked up by
  the next `docker compose up -d` — the same rule as permission seeding. Each boot re-applies the
  role's password, connection limit, and `NOCREATEDB`/`NOCREATEROLE`.
- **Your data is never dropped.** Removing a plugin folder leaves its database untouched; deleting it
  is a deliberate act by an operator. Each boot logs any `plugin_*` database no installed plugin
  claims, so what you left behind stays findable — read that list before dropping anything, since a
  second Plainpages stack sharing this server will have its databases named there too.

**Passwords are derived, never stored** — each is `HMAC-SHA256(PLUGIN_DB_SECRET, <plugin id>)`, so
`bootstrap` and `web` compute the same value independently and nothing has to be written down.
Rotate every plugin's password by changing `PLUGIN_DB_SECRET` and running `docker compose up -d`,
which re-applies each role's password and leaves the data alone — restart every `web` instance as
part of it, since one still holding the old secret can open no new connections. Treat the secret as
you would a database password: whoever holds it holds every plugin database. Under
`REQUIRE_SECURE_SECRETS` a missing, empty or throwaway secret is refused — in `bootstrap` before it
creates any role, so no database is ever given a password derivable from a constant in this repo.

**Only `bootstrap` holds provisioning credentials.** It alone gets `PLUGIN_DB_ADMIN_URL`, an account
with `CREATEDB` and `CREATEROLE` (superuser works but is more than it needs; the dev stack simply
reuses Ory's). Keep using the same account: Postgres gives a `CREATEROLE` account admin rights only
over the roles it created itself, so if you swap it for a fresh one, grant that one `ADMIN OPTION` on
the existing `plugin_*` roles first, or the next boot cannot re-apply their passwords. `web` gets `PLUGIN_DB_URL`, which names the server and must carry no credentials —
supply one with a username or password and boot fails, rather than leaving a privileged password in
the process that runs plugin code. Set both, plus `PLUGIN_DB_SECRET`
([Configuration](#configuration)); the dev stack sets them for you.

Storage stays off until `PLUGIN_DB_URL` is set, and a plugin declaring it while that is unset
**aborts boot** naming itself — rather than serving pages without its data. One naming limit: a
storage plugin's folder may be at most **56 characters**, so `plugin_<id>` fits Postgres' 63-byte
identifier.

### Local dev & test story

A plugin is a normal folder of TypeScript, tested the same way the core is — everything in Docker.
`examples/plugins/scheduling/` is the worked example: thin handlers bound to an injectable upstream
client, unit-tested in `shifts.test.ts` with a mocked `fetch` and a hand-built `ctx`.

1. **Unit-test handlers as pure functions** with `node --test` — no host needed.

   ```bash
   docker compose run --rm web npm test
   ```

2. **Run one plugin against the host.** Get the folder into `/app/plugins/<id>` and
   `docker compose up`. For an isolated harness, `createApp({ plugins: [myPlugin] })` mounts a
   single manifest so a test can assert its routes, nav and gating without the rest of the stack.

3. **E2E the user-facing flow.** Per AGENTS.md §6, ship a side-effect-free Playwright test in
   `e2e-tests/` for each plugin page/form, run against the live `web` service with the plugin
   mounted.

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
   (keep the mounted `config/` a plain dir — no `package.json` of its own):
   ```ts
   import { defineMenu } from "#menu-config";
   export default defineMenu({ branding: { name: "Acme Ops" }, override: { hide: ["teams"] } });
   ```

Every nav item may carry a `permission`; the rendered tree is **filtered per user** from the session
JWT (no per-request authz call), so the menu only shows what that person can reach. An item may
instead be **`public: true`** to show it to everyone — mutually exclusive with `permission`.
Branding (name, logo, default theme) renders in the app shell.

**One menu, one shell, everywhere.** A single menu (`src/ui/chrome.ts` `buildPluginChrome`) renders
in the same app shell on **every** page — dashboard, plugin pages, and the login / registration /
recovery / front pages — so it looks identical signed in or out and just shows fewer items to an
anonymous visitor. The sidebar collapses to a burger on a narrow screen; a page wanting a
chrome-free layout opts out with the shell's `menu: false`.

## Building blocks

Plainpages is a **component library, not a page generator** — reusable EJS partials + TS helpers,
fully styled and zero-JS:

- **Partials:** app shell, nav tree, filter bar, data table (sort / select / row actions),
  pagination, form fields, badges, menus, auth cards.
- **Helpers:** `composeNav` (menu from config), `parseListQuery`
  (`?q=…&status=…&sort=…&page=…` → filter/sort/pagination), `paginate` (page math), and the
  auth guards (`src/auth/guards.ts`): `requireSession`, `can(permission)` (coarse JWT-claim check,
  zero I/O), `check(relation, object)` (the one live Keto call).

## Interactivity: zero-JS spine

The core and all building blocks **work with zero JavaScript** — theme switching and filtering are
pure CSS + GET forms, and menus are the platform's own [popover
API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API): a `<button popovertarget>` opens
the panel, the browser dismisses it on an outside click or `Esc`, CSS anchor positioning places it.
On a browser too old for popovers the trigger is inert and each panel falls back to flowing inline
underneath it — cramped, but nothing is unreachable. List state
(`?q=…&status=…&sort=…&page=…`) lives **in the URL**, so a view is bookmarkable and shareable; the
URL is the only state the UI keeps.

Plugins that genuinely need it — live dashboards, bulk actions, client-side validation — may **opt
into progressive enhancement** (htmx, Alpine, vanilla JS) on top of working server-rendered HTML.
The baseline never depends on it.

## Languages (i18n)

Every string the host renders comes from a **catalog**: one TypeScript module per locale, named
for the locale it holds. The core ships `en-US` and `sv-SE`; a deployment adds a language by
dropping another file next to them.

```
src/i18n/locales/en-US.ts     the baseline — every other locale is checked against it
src/i18n/locales/sv-SE.ts
locales/                      drop-in mount root: your own catalogs, ships empty (like plugins/ and config/)
locales/plugins/<id>/sv-SE.ts the same, for a plugin's words — so adding a language never forks a plugin
plugins/<id>/i18n/en-US.ts    a plugin's own words, looked up before the host's
plugins/<id>/i18n/sv-SE.ts
```

`locales/` is the operator's, mounted like `plugins/` and `config/` — a file there for a new tag
**adds** a language, one for a tag the image already ships **replaces** that catalog wholesale (held
to the same parity check, so a partial replacement fails the boot). `locales/plugins/<id>/<tag>.ts`
does the same for an installed plugin's words, checked against *that plugin's* `en-US`, so
translating a vendored plugin never means forking its folder:

```yaml
# compose.override.yml
services:
  web:
    volumes:
      - ./locales:/app/locales:ro
```

**Which language a request gets:** `?locale=sv-SE` wins, else `Accept-Language`, else `en-US`.
Matching is exact on a full tag — `?locale=sv-FI` with only `sv-SE` installed matches nothing and
falls through to `Accept-Language` (and from there to `en-US`), rather than being served a
neighbouring region — but a lone language (`sv`, as browsers send) resolves to the first regional
catalog for it. There is **no locale cookie**: the URL is the only place a choice is stored, so a
link is shareable and a page is what its address says it is. When the URL asked for a language, the
host carries `?locale=` onto every link *it* renders and `ctx.localeHref(href)` does the same for a
plugin's. The picker lists every installed locale and renders **on every page**. After a POST the
current URL may answer no GET (`POST /admin/users/:id/recovery` has no GET sibling), so the host
points the picker at this path when it answers GET, else the page the form was submitted from, else
`/` — switching language there leaves that POST's own result behind.

**Writing a catalog.** `en-US.ts` exports the object and its type; every other locale is written
against that type, so a missing or misspelled key is a type error before the app ever boots. For a
language of your own: copy `src/i18n/locales/en-US.ts` into `locales/<tag>.ts`, type it
`CoreMessages` (from `@plainpages/plugin-api`), and translate. The `as PluralMessage` cast below is required —
without it the inferred type pins the plural forms to English's two, and a locale that selects more
(Polish, Arabic) becomes unwritable:

```ts
// plugins/shop/i18n/en-US.ts
import type { PluralMessage } from "@plainpages/plugin-api";

const messages = {
  "shop.title": "Shop",
  "shop.greeting": "Hello, {{name}}!",
  "shop.orders": { one: "{{count}} order", other: "{{count}} orders" } as PluralMessage,
};
export type ShopMessages = typeof messages;
export default messages;

// plugins/shop/i18n/sv-SE.ts
import type { ShopMessages } from "./en-US.ts";
const messages: ShopMessages = { "shop.title": "Butik", /* … */ };
export default messages;
```

At boot every catalog is checked against its set's `en-US`; a missing key, an unknown key, or a
plural message that doesn't cover the categories its locale selects (`Intl.PluralRules`) **stops
startup** with the full list. A plugin may translate *fewer* locales than the host (its strings then
render in `en-US`), never one the host doesn't have.

**Using it.** `ctx.t(key, vars)` in a handler; in a view `t(...)` is already there, along with
`locale`, `locales`, `localeHref()` and `dir` — merged into every render, at any include depth:

```ts
// handler
return { data: { title: ctx.t("shop.title"), lead: ctx.t("shop.greeting", { name }) }, view: "shop" };

// a pure view model built outside a request (its unit test) defaults to the plugin's own English:
import { englishTranslator, type Translate } from "@plainpages/plugin-api";
import enUS from "./i18n/en-US.ts";
const EN: Translate = englishTranslator(enUS); // your catalog, then the host's
```
```html
<!-- view -->
<h1><%= t("shop.title") %></h1>
<p><%= t("shop.orders", { count: orders.length }) %></p>
<a href="<%= localeHref("/shop/new") %>"><%= t("shop.new") %></a>
```

Rules worth knowing:

- **An unknown key renders as itself.** That is what lets a nav label be either a catalog key or
  plain text — `label: "shop.title"` is translated, `label: "Shop"` is not, and neither breaks. Same
  for `config/menu.ts` branding and its `rename` overrides.
- **`t()` returns raw text; the view escapes it.** Use `<%= %>` as for any other value. A message
  that deliberately carries markup uses `<%- %>` — and its `{{vars}}` must then be escaped at the
  call site (`pagination.ejs` is the worked example).
- **Dates and numbers are `Intl`'s job**, not the catalog's: `new Intl.DateTimeFormat(ctx.locale)`.
- **The core building blocks carry the locale for you** — every href they render goes through
  `localeHref`, and their GET forms carry it as a hidden field, since a GET submit replaces the whole
  query string. `ctx.localeHref` is for hrefs and form actions your own markup emits (a POST replaces
  the URL just as a GET submit does), and `localeParam` (a view local) for your own GET forms.
  Responses carry `Vary: Accept-Language`.
- **Reuse the core words.** Generic UI verbs live in the core catalog — `common.add/cancel/delete/
  edit/new/remove/save`, `filter.*`, `pagination.*`, `table.*` — and a plugin's lookup falls through
  to them. Keep your catalog for your domain words.
- **Reserved view locals:** `t`, `locale`, `locales`, `localeHref`, `localeParam`, `localeSwitch`,
  `dir`. They are merged after your `data`, so a colliding key of yours is ignored rather than
  breaking the shell. `locale` is likewise reserved in `parseListQuery`, never returned as a filter.

**Kratos writes the auth flow's own text** (field labels, validation errors), tagging each string
with a stable numeric id; a `kratos.<id>` key replaces it and anything unmapped renders Kratos'
English. Field labels are keyed on the input name instead (`auth.field.password`), because Kratos'
trait-label id is generic — the same id says "Email" on login and "First name" on registration.
Operator- and developer-facing text (boot errors, logs) stays English.

## Configuration

Read from the environment once at boot (`src/config.ts`) and validated there — a bad URL, an
out-of-range `PORT`, a non-boolean toggle, or a missing/throwaway enforced secret fails loud before
the server starts. A clean clone needs **none** of these; every value defaults to the dev stack.

The app is **environment-agnostic**: no `NODE_ENV`, every behaviour its own explicit toggle.
`compose.yml` (base) sets the hardened ones; `compose.override.yml` (dev, auto-merged by
`docker compose up`) turns them back off for live editing.

| Var | Default | Notes |
| --- | --- | --- |
| `APP_URL` | _unset_ (dev: `http://localhost:3000`) | the canonical public URL — the **single source** for the host this deployment lives on; set ⇒ off-host visitors are redirected here, unset ⇒ no redirect (see [Canonical host](#canonical-host-one-public-url)) |
| `PORT` | `3000` | web listen port |
| `CACHE_TEMPLATES` | `false` | cache compiled EJS templates (`true` in prod) |
| `SECURE_COOKIES` | `false` | mark our session/CSRF cookies `Secure` (`true` in prod https; off in dev http) |
| `REQUIRE_SECURE_SECRETS` | `false` | when `true`, `CSRF_SECRET` — and `PLUGIN_DB_SECRET` once storage is configured, and every plugin setting declared `secret` — must be supplied and differ from the dev throwaway |
| `LOG_LEVEL` | `info` | min severity logged: `error`/`warn`/`info`/`verbose`/`debug`/`silly`/`none` |
| `LOG_FORMAT` | `text` | log line format: `text` (human-readable, dev) or `json` (structured, prod) |
| `SERVICE_NAME` | `plainpages` | OTLP `service.name` on every log + span — brand it as your own deployment |
| `OTLP_ENDPOINT` | _unset_ | OpenTelemetry Collector HTTP base URI; set ⇒ export logs + traces (unset ⇒ console only) |
| `OTLP_PROTOCOL` | `http/json` | OTLP wire format: `http/json` or `http/protobuf` |
| `KRATOS_PUBLIC_URL` / `KRATOS_ADMIN_URL` | `http://kratos:4433` / `:4434` | identity (self-service / admin) |
| `KETO_READ_URL` / `KETO_WRITE_URL` | `http://keto:4466` / `:4467` | authorization check / write |
| `HYDRA_ADMIN_URL` | `http://hydra:4445` | OAuth2 provider admin API (login/consent handshake) |
| `JWKS_URL` | `file://…/tokenizer/jwks.json` | the Kratos tokenizer signing key; verifies the session JWT |
| `JWT_ISSUER` / `JWT_AUDIENCE` | _unset_ | optional: when set, the session JWT's `iss` / `aud` must match (the dev tokenizer sets neither) |
| `JWT_CLOCK_SKEW_SEC` | `60` | exp/nbf leeway (s) for Kratos↔web clock drift (the auth E2E sets `0`) |
| `ORY_TIMEOUT_SEC` | `5` | per-call timeout for outbound Kratos/Keto/Hydra (and http JWKS) fetches, so a hung Ory can't park a request |
| `REVOCATION_DENYLIST` | `false` | when `true`, enable the optional [instant permission/session revoke denylist](#instant-revoke-the-optional-denylist) |
| `REVOCATION_TTL_SEC` | `900` | how long a revoke entry lives; keep ≥ tokenizer TTL (10m) + clock skew |
| `CSRF_SECRET` | dev throwaway | signs our double-submit CSRF token; enforced by `REQUIRE_SECURE_SECRETS` |
| `PLUGIN_DB_URL` | _unset_ (dev: `postgres://postgres:5432`) | credential-free Postgres base URL for [plugin storage](#plugin-storage); unset ⇒ storage off, and a plugin declaring it aborts boot |
| `PLUGIN_SETTING_<ID>_<KEY>` | per declaration | one variable per key a plugin declares in `settings`; see [Plugin settings](#plugin-settings) |
| `PLUGIN_DB_ADMIN_URL` | _unset_ (dev: the bundled superuser) | the DSN that provisions each plugin's database and role — read by the one-shot `bootstrap` service **only**, never by `web` |
| `PLUGIN_DB_SECRET` | dev throwaway | derives each plugin's database password; `REQUIRE_SECURE_SECRETS` enforces it in `web` once `PLUGIN_DB_URL` is set, and in `bootstrap` whenever a plugin declares storage |
| `PLUGIN_DB_CONNECTION_LIMIT` | `10` | per-role Postgres connection ceiling, so one plugin's pools cannot exhaust the server Ory shares; read by `bootstrap` when provisioning |

### Canonical host (one public URL)

A site is often reachable at several URLs that resolve to the same place — `localhost` vs
`127.0.0.1`, an apex vs `www.`. That matters because **cookies are host-scoped**: the themed login
form POSTs to Kratos, and Kratos' CSRF cookie is set on the host the browser is on. Reach the app on
one host but let the form post from another and that cookie is lost — Kratos rejects the flow and
bounces to its error page.

`APP_URL` is the **single source of truth** for the public host. Set it and the web app **redirects
any off-host GET/HEAD visitor to it** (308, path + query preserved) *before* a flow starts, so the
browser, the themed forms, and the cross-origin Kratos POST share one cookie host. Static assets
under `/public/` are served on any host, so health checks don't bounce. Everything else derives from
the same value: the first-run banner, and — via compose — Kratos' browser-facing URLs
(`compose.override.yml` maps `${APP_URL}` onto every `ui_url`, return URL and
`allowed_return_urls`). A genuine Kratos flow error renders the themed **`/error`** page.

The redirect is an **explicit opt-in**: **unset ⇒ no redirect**, so a deploy that forgets `APP_URL`
never bounces real users to a stale default. A clean clone still works with zero config — the dev
override sets `APP_URL=http://localhost:3000`, and `127.0.0.1` is canonicalised onto it.

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

A clean clone needs **none** of the above. What can't be auto-generated is **production-only**:

1. **Production secrets** — every value below ships as a committed dev throwaway and **must** be
   replaced before a deploy faces the internet. Only the first is enforced:
   `REQUIRE_SECURE_SECRETS=true` refuses to boot on a missing or throwaway `CSRF_SECRET` and
   **nothing else** — the rest fail silently, so treat this as a checklist.

   | Secret | Where | Protects |
   | --- | --- | --- |
   | `CSRF_SECRET` | web env | signs our double-submit CSRF token |
   | JWT signing key | mount a real `jwks.json` or set `…_JWKS_URL` | mints/verifies the session JWT — see [rotation](#jwt-signing-key--rotation) |
   | `SECRETS_COOKIE` | kratos env | signs Kratos' session + anti-CSRF cookies |
   | `SECRETS_CIPHER` | kratos env (32 chars) | encrypts credentials at rest |
   | `SECRETS_SYSTEM` | hydra env | encrypts OAuth2 tokens + consent at rest |
   | `POSTGRES_USER` / `POSTGRES_PASSWORD` | compose env | the Ory databases (default `ory`/`ory`) |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | bootstrap env | the seeded first admin login (default `admin@plainpages.local` / `admin`) |

   `CSRF_SECRET`, the Postgres pair and the admin pair are interpolated from the host
   environment. The three Ory secrets are **not**: `compose.yml` passes only `DSN` to
   `kratos`/`hydra`, so add them to those services' `environment:` (or an `env_file:`) or they
   silently stay on the throwaways.

2. **SSO provider client id/secret** — **optional**; password login works without them (see
   [Social sign-in (SSO)](#social-sign-in-sso)).

Everything else is generated or seeded on first boot — Ory migrations, the dev signing key, the demo
admin identity and its Keto permissions, the Keto OPL model.

### Social sign-in (SSO)

Off by default — a clean clone is password-only. Kratos activates a provider purely from the
environment (no code, no rebuild): set `SELFSERVICE_METHODS_OIDC_ENABLED=true` and
`SELFSERVICE_METHODS_OIDC_CONFIG_PROVIDERS` to a JSON array of providers, each carrying its
`client_id`/`client_secret` and referencing the committed claims mapper
`ory/kratos/oidc/claims.jsonnet`. The themed sign-in/register pages derive one button per provider
from the live flow's `oidc` nodes, so no creds ⇒ no button, and the SSO section disappears entirely
when none are configured. Open-source Kratos has **no native SAML** — front it with an OIDC bridge
(Ory Polis) and register that bridge as a generic OIDC provider.

## Auth, sessions & access

Identity comes from **Kratos**; the hot path stays I/O-free by carrying coarse authorization in a
**locally-validated JWT**, and **Keto** is reserved for the rare fine-grained, must-be-fresh check.

### Login and the session JWT

The themed sign-in / register / reset / SSO screens drive Kratos self-service flows. On success,
rather than keeping the opaque Kratos cookie and calling `whoami` on every request, the app
**exchanges the session for a signed JWT once** via the Kratos **session tokenizer** (`whoami` with a
`tokenize_as` template) and stores it as the session cookie.

```
  ── AT LOGIN / REFRESH  (the only time Ory is on the path) ──────────
   Kratos verifies credentials
     └─► app reads the user's permissions from Keto       (direct + transitive via groups)
     └─► app writes them as a derived projection on the identity (admin API)
     └─► whoami(tokenize_as: "plainpages")  ─►  signed JWT
           claims: { sub, email, permissions:[…from Keto], exp ≈ 10m }
     └─► stored as the session cookie

  ── EVERY REQUEST  (hot path — pure CPU, no I/O) ───────────────────
   Browser ─cookie(JWT)─► web : verify signature (cached JWKS)
                                read claims.permissions
                                filter menu · gate routes
```

**Keto is the single source of truth for permissions**, and the admin screens write them *only*
there. But the tokenizer's claims mapper can read only the **identity**, not call Keto — so at login
the app reads the permissions from Keto and refreshes a **derived projection**: a read-only copy on
the identity's `metadata_public`, which the template maps into the JWT `permissions` claim. It must
be `metadata_public`, not `metadata_admin` — the session Kratos hands the tokenizer carries only
public metadata, and the user can already read these permissions in their own JWT. The projection is
a per-login cache, authoritative nowhere; a stale one self-heals on the next login.

Login resolves both direct grants and group membership, so the JWT `permissions` match what the
admin **Effective access** view shows. Cost: **a handful of Keto reads + one identity refresh per
login**, never per request. JWKS is cached, so signature verification hits the network only on key
rotation.

#### Two trade-offs — both deliberate

- **Permission changes lag by up to one TTL (~10m).** Gating reads the JWT, not Keto, so a change
  takes effect when the token is next minted. For instant revoke, turn on the optional
  [revocation denylist](#instant-revoke-the-optional-denylist).
- **Ory is on the critical path for sign-in.** If Kratos is down no one can log in; if it stays down
  past the TTL, existing sessions can't refresh and the UI goes dark. Run Ory with the availability
  you would give any auth provider.

### Instant revoke: the optional denylist

Off by default; turn it on with `REVOCATION_DENYLIST=true` (`src/auth/denylist.ts`). When enabled,
an admin **deactivating** or **deleting** a user, or **granting/revoking** a permission to a *user*,
records that subject as revoked-now; the hot path then rejects every token for it minted **before**
the revoke and forces a re-mint — which re-reads permissions from Keto, or clears a dead session. A
fresh re-login passes, so a downgrade lands immediately without locking the account.

It is an in-memory, auto-evicting map — host-owned state would break the [stateless
core](#stateless-core) — and the check is pure CPU, keeping Keto off the hot path. Entries self-evict after `REVOCATION_TTL_SEC`
(default 900s ≥ the 10m token TTL + skew). Two bounds: it is instant only on the **single instance**
that handled the revoke (elsewhere the guarantee falls back to the token TTL — back it with a shared
store for hard multi-instance revoke), and a **group** membership change is transitive across many
users, so it is left to lag.

### Three tiers of "may I?"

Where each **kind** of rule belongs:

```
  coarse  (menu / route / feature)        → JWT claim     · in-process, zero I/O
  fine + attribute (owner / tenant / …)   → upstream service that owns the row
  fine + relationship (shared / inherited)→ Keto, live check at the action
```

- **Coarse** gates the menu and routes — read straight from the JWT.
- **Attribute-based row rules** (ownership, tenant, status) live in the **upstream service** that
  holds the data: it is the source of truth and the check is free.
- **Relationship-based rules** (sharing, delegation, inherited access, or authz that must mean the
  same thing across several services) go to **Keto**. Don't pay its tuple-sync cost for rules a
  service can already answer from its own data.

### OAuth2 provider (Hydra)

Only relevant when **other apps** authenticate *through* plainpages: the app implements Hydra's
login & consent steps against the user's Kratos session, and Hydra issues the tokens those apps use.
Nothing in the menu or first-party pages needs Hydra.

- **`/oauth2/login`** (`src/auth/oauth-login.ts`) — resolve the challenge against the Kratos session
  and accept, or bounce an unauthenticated user to the themed login and return here once signed in.
- **`/oauth2/consent`** (`src/auth/oauth-consent.ts`) — a first-party client (Hydra
  `metadata.first_party: true`), or one Hydra already skipped, is auto-granted its scopes; any other
  gets a themed consent screen whose CSRF-guarded Allow/Deny accepts or rejects. id_token claims
  come from the Kratos identity.
- **`/oauth2/logout`** — accept the RP-initiated `logout_challenge` and resume to Hydra's
  post-logout redirect. The first-party `POST /logout` still owns ending the Kratos session and our
  JWT cookie.

Clients are registered from the admin plugin's **OAuth2 clients** screen (`/admin/clients`): Hydra
shows the generated `client_secret` **once**, on the confirmation page. Confidential vs public
(PKCE) and the first-party auto-consent flag are set at registration; writes go only to Hydra.

### Security model

**The private container network is the *only* thing guarding the Ory APIs.** Kratos admin (`4434`),
Hydra admin (`4445`) and Keto write (`4467`) authenticate no one — reaching them *is* full identity
and authorization control. Keto **read** (`4466`) cannot write but discloses the entire
authorization graph, so treat it the same. `compose.yml` publishes none of the six Ory ports
(guarded by `src/compose.test.ts`); dev publishes only the two a browser must reach.

**The JWT is signed, not encrypted.** Claims are base64: a signed-in user can read their own `sub`,
`email` and `permissions`. `HttpOnly` keeps page JavaScript out of the cookie, not the user.

**The JWT's ~10m TTL is not the session lifetime.** The browser also holds Kratos'
`plainpages_session` cookie (30 days, sliding), and *that* is what silently re-mints a lapsed JWT —
so a stolen cookie jar is worth 30 days of re-mintable access, not ten minutes. Only our two cookies
obey `SECURE_COOKIES`; the Kratos one takes its flags from Kratos' own config.

**Offboarding is not instant by default** — a revoked permission or deactivated identity lands
within one token TTL, unless the [denylist](#instant-revoke-the-optional-denylist) is on.

**A plugin, and every package it depends on, runs with the host's full privileges** — in the process
holding the JWT signing key and `ctx.system`'s Ory admin clients, on the network that reaches the
unauthenticated Ory ports. Install only what you trust, and let the plugin's own lockfile
([Plugin dependencies](#plugin-dependencies)) pin the tree you audited.

Hardening a real deploy is `REQUIRE_SECURE_SECRETS=true`, `SECURE_COOKIES=true`, and replacing
**every** committed dev secret ([what you must supply](#what-you-must-supply-the-only-manual-prep)).
`REQUIRE_SECURE_SECRETS` guards only `CSRF_SECRET`; nothing fails loud if you ship Ory's, Postgres'
or the demo admin's throwaways.

## Email

The only emails are the **recovery** and **verification** codes from Kratos' self-service flows, and
**Kratos renders and sends them** — `web` never touches SMTP. Dev catches them in **mailpit**
(<http://localhost:8025>); prod points Kratos at a real server via `COURIER_SMTP_CONNECTION_URI`
(`courier.smtp` in `ory/kratos/kratos.yml`).

**Customizing the email content** is a built-in Kratos feature — no code here. Set
`courier.template_override_path` to a mounted directory and drop Go templates in it, keyed by type:

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

| Container      | Does |
| -------------- | ---- |
| `web`          | The Node 24 + TypeScript app: server-rendered EJS, the plugin host, the building-block partials. |
| `kratos`       | **Ory Kratos** — identity: login, registration, password reset, SSO, sessions. |
| `keto`         | **Ory Keto** — the authorization decisions (`can user X do Y on Z?`). |
| `hydra`        | **Ory Hydra** — OAuth2/OIDC provider, so other apps can log in *through* plainpages. |
| `postgres`     | **Ory's** storage (Kratos/Keto/Hydra). |

The `web` app is an Ory **relying party**: it never stores passwords. At login it turns the Kratos
session into a short-lived, **locally-validated JWT** carrying the user's coarse permissions, so
every later request gates the menu and pages **in-process, with no call to Ory**. Keto answers the
rarer fine-grained checks; Hydra only when the app acts as an OAuth2 login & consent provider. All
of it over their **REST APIs using Node's built-in `fetch`** — no SDK dependency.

In **dev** the host-facing Ory ports are published — Kratos public `4433` and Hydra public `4444`;
prod keeps them internal.

Runtime deps stay tiny and pinned: **`ejs`**, **`lucide-static`**, **`@larvit/log`**, and
**`postgres`** — the last one has no sub-dependencies of its own and is used in a single module, to
provision [plugin storage](#plugin-storage) at boot. Auth, sessions, SSO and OAuth2 add *services*,
not npm packages.

### Stateless core

The host holds **no state of its own**: it owns no schema and keeps nothing between requests. The
stack's **Postgres** backs Ory, and gives every plugin that asks for one a database of its own
([Plugin storage](#plugin-storage)) — which the host provisions but never reads or writes.

So a plugin gets its data one of two ways: by **calling an upstream service** from its route handler
— a REST API, an ERP, a plant historian, the customer's own backend — or from **its own database**.
Either keeps `web` trivially scalable and crash-safe: any instance can serve any request, because the
session lives in Kratos and the data lives outside the process.

## Testing

Type check and unit tests run off the Ory stack — `--no-deps` keeps `web` from dragging up its
`depends_on` services:

```bash
docker compose run --rm --no-deps web npm run typecheck   # strict tsc --noEmit
docker compose run --rm --no-deps web npm test            # node --test (units)
```

### End-to-end (Playwright)

E2E runs in the official Playwright image (browsers preinstalled) against the live `web` service —
no Node/browsers on the host. Five suites, each on its own stack:

| Suite | Compose overlay | Covers |
| --- | --- | --- |
| `visual.spec.ts` + `language.spec.ts` | `e2e-tests/compose.visual.yml` | Ory-free: the rendered design system (app shell, theme switch, mobile off-canvas, icon sprite, CSRF-guarded sign-out, landing, 404), plugin permission-gating, and [language switching](#languages-i18n) |
| `auth-refresh.spec.ts` | `e2e-tests/compose.auth.yml` | The real Ory stack with the session→JWT TTL cut to 8s: a lapsed JWT is silently re-minted from the live Kratos session, and once revoked the stale cookie is cleared |
| `oauth-login.spec.ts` | `e2e-tests/compose.oauth.yml` | Another app logging in through us — register a client, start an authorization flow, `/oauth2/login` accept, `/oauth2/consent` Allow → authorization code |
| `full-flow.spec.ts` | `e2e-tests/compose.full.yml` | The browser UI: password + mocked-SSO login, menu filtering by permission, admin users/groups/permissions CRUD, OAuth2-clients register → one-time secret → delete, a gated plugin page, logout |
| `devstack-login.spec.ts` | `compose.override.yml` + `e2e-tests/compose.devstack.yml` | The plain `docker compose up` topology on the **host network**: sign-in works both from the banner's `localhost:3000` and from `127.0.0.1:3000` via the [canonical-host redirect](#canonical-host-one-public-url) |

```bash
docker compose -f compose.yml -f e2e-tests/compose.visual.yml run --user "$(id -u):$(id -g)" --build --rm e2e
docker compose -f compose.yml -f e2e-tests/compose.visual.yml down -v
```

Swap the overlay for another suite; `devstack` also needs `-f compose.override.yml`, host networking
and the host ports `3000`/`4433` free. `--build` rebuilds the runner so spec edits are picked up (the
image bakes in `e2e-tests/`). `full-flow` fronts web + Kratos on one origin through
`e2e-tests/proxy.ts`, since the themed form posts straight to Kratos and cookies are host-scoped.

Screenshots + an HTML report land in `e2e-tests/artifacts/` (git-ignored). `--user` is what keeps
them yours to delete — the runner writes into your checkout. On **rootless** Docker drop that flag:
container root is already you there, and a mapped uid cannot write. Keep new tests
side-effect-free so the suite stays `fullyParallel`.

**Anything the browser logs fails the test.** Specs import `test` from
`e2e-tests/console-guard.ts`, which watches every page a test opens — a console error or warning, or
an uncaught exception, fails that test; a page that provokes one on purpose allows it explicitly
with `allowConsole(/…/)`. The Ory-free suites run in **Chromium, Firefox and WebKit**; the
Ory-backed ones share one backend and stay on Chromium.

### The full gate (one command)

`ci.sh` is the whole gate in one reproducible command — typecheck → unit tests →
each E2E suite against its own fresh stack, with a guaranteed `down -v` after each (even on
failure) and a non-zero exit on the first failure. Run it locally before a release, or wire
it into your CI service:

```bash
bash ci.sh
```

Each E2E suite **owns a clean stack** — never point two suites at one backend (auth-refresh
revokes the admin's sessions; full-flow writes users/groups/permissions to Keto), which is why the
gate runs them serially, one stack up/down per suite.

## CI/CD

Gitea Actions (`.gitea/workflows/`) runs the pipeline; the test job runs
[`ci.sh`](#the-full-gate-one-command) — the exact gate you run locally:

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | push, any branch except `main` | the full gate (`bash ci.sh`, a no-op on a docs-only branch), then build + push the app image |
| `release.yml` | push of a `vX.Y.Z` tag, or manual | check the tag against `HOST_API_VERSION`, re-tag that commit's image as `X.Y.Z`, `X.Y`, `latest` (plus `X` once major ≥ 1), sync those tags to Docker Hub; a second job publishes the Hub overview, and runs alone on a manual trigger |
| `mirror.yml` | push to `main` or any tag, or manual | force-push `main` + tags (pruning deleted ones) to the [GitHub mirror](https://github.com/larvit/plainpages) |
| `registry-cleanup.yml` | nightly cron, or manual | delete registry images that are neither release-tagged nor a branch head |
| `renovate.yml` | nightly cron, or manual | open dependency-update PRs, automerge them once the gate is green, then cut a release tag for what merged |

`main` is not re-tested on push — its commits are meant to arrive already green from a
gated branch, so the status check to gate a merge on is `CI / full-gate (push)`.

**Merge gate on `main`** (Gitea branch protection + repo merge settings, set via the API —
no repo files involved): direct pushes are blocked, changes land via PR only, the
`CI / full-gate (push)` status must be green (admins included), and the only merge style is
**fast-forward-only** — history stays linear and `main`'s head is the exact commit hash of
the merged branch, which is why the branch's push-triggered status carries over.

**Container images** — after a green gate, `ci.yml` builds the app image and pushes it as
`gitea.larvit.se/larvit/plainpages:<full commit hash>`. Because merges are fast-forward-only, the
image for any `main` commit already exists from that commit's branch gate — build once, promote by
re-tagging. The build runs inside the required gate, so a missing/expired token or a registry outage
blocks **all** merges until restored; use a non-expiring token or track its expiry. Hash tags
accumulate one image per gated push, so nightly `registry-cleanup.yml` prunes them
([`registry-cleanup/cleanup.ts`](registry-cleanup/cleanup.ts) defines what survives). Don't add a
pattern-based org cleanup rule for this package — its age/count heuristics can't see branch heads or
release tags and would delete images the workflow protects.

**Releases** — pushing a semver git tag (`git tag v1.2.3 && git push origin v1.2.3`) runs
`release.yml`, which pulls that commit's hash image and re-tags it `1.2.3`, `1.2`, `latest` and —
once the major reaches `1` — `1`; nothing is rebuilt, so the released image is byte-identical to the
gated one. While the major is `0` the bare-major tag is skipped, because a `0.x` minor is a contract
break and a moving `:0` would carry one. It fails loud if no
hash image exists — release tags must point at a commit that went through the gate. The same four
tags sync to [Docker Hub](https://hub.docker.com/r/larvit/plainpages), releases only.

The [contract check](#contract-versioning) guards the tag before anything is published, refusing one
whose `major.minor` disagrees with `HOST_API_VERSION` and naming the value to set.

**The Docker Hub overview** is published by a separate `publish-overview` job from
[`release-tooling/dockerhub-overview.md.tmpl`](release-tooling/dockerhub-overview.md.tmpl), with
`{{VERSION}}` rendered to the release, so the Plainpages tag it tells adopters to pull cannot go
stale. Its sidecar pins are Renovate-managed and gated against this repo's own compose files, so the
quick start stays a topology CI has actually run.
It is its own job for two reasons: the images are already pushed and irreversible by then, so a Hub
outage leaves the promotion green and the images untouched; and the page has its own door — run the
workflow manually with an `overview_version` input to republish it without cutting a release. That
input goes through the same contract check as a tag: a non-semver value, or one whose `major.minor`
disagrees with the tree being published, is refused. It uses
the same `DOCKERHUB_TOKEN` the image push uses, which is why that token needs the **delete** scope.

**GitHub mirror** — [github.com/larvit/plainpages](https://github.com/larvit/plainpages) is
read-only; after every merge `mirror.yml` force-pushes `main` and all tags, overwriting any drift.
Tags go with `--prune`, so deleting one here deletes it there on the next run, and a tag *created* on
GitHub is swept away — cut releases on Gitea, never on the mirror. Branches other than `main` match
no refspec and are left alone.

**Dependency updates** — `renovate.yml` runs [Renovate](https://docs.renovatebot.com) nightly
(self-hosted, this repo only) against [`renovate.json`](renovate.json), bumping npm deps, Docker base
images, Gitea action versions, and the image tags pinned inside workflow `run:` steps (a custom regex
manager, so nothing pinned drifts unmanaged). Version-locked sets move together in one PR — the Ory
images, and the Playwright runner + its browser image — and every bump keeps the **exact semver pin**
exact. Each PR runs the normal gate on its `renovate/*` branch and automerges once
`CI / full-gate (push)` is green; only a red gate needs a human.

**Auto-release on dependency updates** — a second job in `renovate.yml` (`auto-release`) cuts **one**
`vX.Y.Z` tag per run covering the renovate-bot commits merged to `main` since the last tag, and
**skips** when the tip isn't a Renovate commit, nothing new merged, or nothing that merged carried a
trailer — a dependency update that cannot reach the app releases nothing. Renovate stamps a
`Release-Bump: <updateType>` trailer onto the updates that reach a running Plainpages — the rules in
[`renovate.json`](renovate.json) name them — and
[`release-tooling/next-version.ts`](release-tooling/next-version.ts) turns the highest one into the next
version; pre-1.0 it never auto-crosses into `1.0.0`. Because the contract version *is* the release
version, an update big enough to reach a **minor** stops the job rather than tagging: bump
`HOST_API_VERSION` in a PR, merge, then tag by hand. Pre-1.0 that covers a dependency *major*, since
`nextVersion` shifts it down to a `0.x` minor. `updateType` rates the *dependency's* own jump,
so the trailer is an allowlist: an update outside those rules carries none and rides the next patch
release instead of escalating it. It is **tag-only**: the tag hands off to
`release.yml`, and is pushed with renovate-bot's PAT so that workflow actually fires (a tag pushed by
the built-in Actions token wouldn't trigger it). `HOST_API_VERSION` is never touched here.

### One-time CI setup

| Actions var / secret | Value |
| --- | --- |
| `DOCKER_REGISTRY_USER` (var) + `DOCKER_REGISTRY_TOKEN` (secret) | A Gitea account with package write in the `larvit` org, and its access token with `read:package` + `write:package`. Reused by `registry-cleanup.yml`. |
| `DOCKERHUB_USER` (var) + `DOCKERHUB_TOKEN` (secret) | The public `larvit/plainpages` Docker Hub repo, and a **read/write/delete** token **scoped to that repository** (an org access token, or one on a dedicated account — an account-wide PAT reaches every repo under it, and delete is destructive). Delete is what publishing the overview needs; pushing images alone would not. |
| `MIRROR_GITHUB_TOKEN` (secret) | A fine-grained PAT (Contents: read & write) for a GitHub machine account with write access to the mirror. Its `main` must not block force-pushes and must carry no tag protection, which would reject the prune. |
| `RENOVATE_TOKEN` (secret) | The shared `renovate@larvit.se` bot's Gitea PAT, with write access to this repo. |
| `RENOVATE_GITHUB_TOKEN` (secret) | A **scopeless** (read-only) github.com PAT, so Renovate's lookups of github.com-hosted deps run authenticated instead of tripping the anonymous 60-req/hour limit. |

Gitea rejects secret names prefixed `GITEA_`/`GITHUB_`. Each job fails loud until its secret exists.
The container package is **org-owned**, so it lists under `larvit/-/packages` — link it to the repo's
Packages tab once: `POST /api/v1/packages/larvit/container/plainpages/-/link/plainpages`.

**The runner** — register one
[act_runner](https://docs.gitea.com/usage/actions/act-runner) in host mode labelled `docker-host`
(`labels: ["docker-host:host"]`) on a machine with Docker Engine + Compose, git, and Node +
github.com access. Runs must **never overlap** — the e2e stacks use fixed compose project names, the
devstack suite uses host networking, and the workflows share the Docker daemon's registry login — so
keep exactly one runner at capacity 1, with host ports 3000/4433 free.

## Production & deployment

```bash
docker compose -f compose.yml up --build -d   # base config only, no source mount
```

`compose.yml` is the full prod stack — web + Postgres + the three Ory services (with migrations and
the one-shot bootstrap) — and mounts no source. Secrets come from the environment; the base sets
`REQUIRE_SECURE_SECRETS=true`, so a missing or dev-throwaway `CSRF_SECRET` fails the boot rather than
running insecure. Before going live, supply the production secrets and any SSO credentials — the
**only** manual prep ([What you must supply](#what-you-must-supply-the-only-manual-prep)).

**Back up the `pgdata` volume.** Once a plugin declares [storage](#plugin-storage), Postgres holds
business data that exists nowhere else, alongside Ory's identities — the stack stops being
reproducible from the image and config alone. Snapshot the volume, or `pg_dump` each database on a
schedule, and rehearse the restore.

Every response carries security headers (`src/http/security-headers.ts`): a strict
`Content-Security-Policy` (the core is zero-JS — `script-src 'self'`, no inline scripts),
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` + `frame-ancestors 'none'`,
`Referrer-Policy`, and HSTS when `SECURE_COOKIES=true`. The CSP allows **same-origin** assets only,
so a branding logo must live under `/public/` or be a `data:` URI; a plugin route can override any
header per-response via `RouteResult.headers`.

A deep link reached while signed out — or after the session JWT lapses mid-task — bounces to the
themed sign-in and returns to the **page that was requested** (`return_to`, validated host-relative
by `localPath` in `src/http/safe-url.ts`, so a crafted value can't turn login completion into an open
redirect). If Ory is unreachable on the sign-in path itself the user gets an honest **503**, distinct
from the catch-all 500. The server drains in-flight requests on `SIGTERM`/`SIGINT`.

The first-boot **bootstrap** is idempotent and runs on every `up`: it generates the JWT signing key
if absent, creates the demo admin in Kratos, and grants it every discovered plugin's declared
permission names in Keto (plus any `ADMIN_PERMISSIONS`), so a dropped-in plugin resolves out of the
box. The web app waits for Kratos + Keto healthy *and* the bootstrap to finish before starting.
**Change the demo admin before production.**

## Upgrading

**Re-copy your drop-in plugins.** Anything under `plugins/` is *your* copy — the host never updates
it. A plugin copied from `examples/` is still the old one after you pull, and the host may have
tightened a manifest rule since. Discovery fails loud at boot rather than running a plugin it can't
honour, naming the plugin and the rule:

```bash
rm -rf plugins/admin && cp -r examples/plugins/admin plugins/admin
docker compose up -d --build
```

Do the same for any other folder you copied out of `examples/`. A plugin you wrote yourself needs the
manifest change the error names. A host contract change big enough to move
[`HOST_API_VERSION`](#contract-versioning) shows up earlier and more precisely — discovery refuses the
plugin by **version** before any rule gets a chance to trip.

Two paths in the checkout are load-bearing and must stay clear of root-owned leftovers:
`node_modules/` must not exist (deps live at `/node_modules`, and anything at `/app/node_modules`
silently shadows them), and `e2e-tests/artifacts/` must be writable by you or every E2E suite fails
`EACCES`. Clearing the latter needs what `sudo` would do, which a dev box may lack:

```bash
docker run --rm -v "$PWD/e2e-tests:/x" node:24.19.0-alpine3.24 rm -rf /x/artifacts
git checkout -- e2e-tests/artifacts/.gitkeep   # only if a pull already deleted it
```

## Observability

Logging is **structured** and **OTLP-native**, on
[`@larvit/log`](https://www.npmjs.com/package/@larvit/log). One app logger tags every line with
`service.name`; each request is cloned into a short-lived **trace span**, made ambient for the whole
handler (an `AsyncLocalStorage`), so logs and traces correlate. Three explicit toggles:
`LOG_LEVEL`, `LOG_FORMAT` (`text` dev / `json` prod) and `SERVICE_NAME`.

Every request emits one access line (`method`, `path` — the query is dropped, it can carry tokens —
`status`, `ms`, `requestId`); login/logout, admin writes and missing-permission/CSRF rejections log
at `info`/`warn`, the catch-all 500 and Ory-unreachable re-mint at `error`/`warn`. An inbound W3C
`traceparent` is **adopted**, continuing a trace started upstream.

**Distributed tracing covers every outbound call.** Because the request logger is ambient, all
outbound HTTP — the Ory clients and the JWKS fetch — runs through `tracedFetch`, becoming a client
span under the request and carrying `traceparent` downstream. A plugin gets the same from
`ctx.log.fetch(url)`, or by defaulting an upstream client to the exported `tracedFetch`.

**OTLP export (off by default).** Point `OTLP_ENDPOINT` at an OpenTelemetry Collector's HTTP base URI
and logs **and** spans export there; `OTLP_PROTOCOL` selects `http/json` or `http/protobuf`. Export
is fire-and-forget — it never blocks or fails a served request, and nothing exports when the endpoint
is unset. A collector outage is survivable but noisy: each request's failed export writes a line to
stderr, so run a local collector you trust.

## JWT signing key & rotation

The session tokenizer signs each session→JWT with an **ES256** key at
`ory/kratos/tokenizer/jwks.json`. The committed one is a **dev throwaway** — **never run it in
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

**Rotation is zero-downtime** because Kratos signs with the **first** key in the set and stamps its
`kid` in each JWT header, while web selects the verify key by that `kid` — so a set can hold the new
key *and* the old one at once, and tokens minted before and after the swap both verify.

### Scheduled rotation

The token TTL is **10 min** (`kratos.yml` → `whoami.tokenizer.…ttl`); the wait window below is one
TTL + clock skew, rounded up to **~12 min**. Run from the repo root.

1. **Prepend a fresh key** (new key first, old key kept) — write via a temp file so the
   shell's `>` can't truncate the input before it's read:
   ```bash
   docker compose run --rm -T --no-deps web sh -c \
     'node src/auth/gen-jwks.ts --prepend ory/kratos/tokenizer/jwks.json' > /tmp/jwks.json \
     && mv /tmp/jwks.json ory/kratos/tokenizer/jwks.json
   ```
2. **Restart Kratos** so it signs with the new first key: `docker compose restart kratos`. web needs
   no restart — it hot-reloads the file.
3. **Verify** new logins mint the new `kid` — decode the `plainpages_jwt` cookie's JWT header, or
   watch web's logs for a `jwks reload on kid miss` debug line.
4. **Wait ~12 min**, then **prune** the superseded key:
   ```bash
   docker compose run --rm -T --no-deps web sh -c \
     'node src/auth/gen-jwks.ts --prune ory/kratos/tokenizer/jwks.json' > /tmp/jwks.json \
     && mv /tmp/jwks.json ory/kratos/tokenizer/jwks.json
   ```
   No Kratos restart needed — it already signs with that key; this only drops an unused verify key.

**Rollback** (before the prune): the old key is still in the set, so revert step 1's file and
`restart kratos`.

### Emergency rotation (key compromise)

Skip the overlap — every token signed with the leaked key must die now. **Replace** the set with a
single fresh key (no `--prepend`):

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
src/                 The app — strict tsc, no build step. *.test.ts sit beside their module.
  server.ts          Entry point; config.ts env loader; logger.ts structured log + trace span + tracedFetch
  *.test.ts          Topology guards with no source counterpart (compose/kratos/keto/hydra/postgres/ci-gate)
  http/              Request pipeline: app.ts (createApp), builtin-routes, context, body, cookie,
                     static, safe-url (safeUrl + localPath), security-headers
  auth/              Identity + the session-JWT hot path: jwt · jwt-middleware · jwks · gen-jwks (CLI) ·
                     login · guards · csrf · denylist · flow-view · oauth-login · oauth-consent ·
                     routes · bootstrap, and the Ory REST clients (kratos-public/admin, keto, hydra,
                     fetch-timeout)
  i18n/              catalog (parity rules) · locale (resolution) · translate · load · runtime ·
                     english · view-locals · locales/ (the core en-US + sv-SE catalogs)
  plugin-host/       plugin.ts (the contract) · plugin-api.ts (the `@plainpages/plugin-api` barrel) · system.ts
                     (ctx.system) · discovery · router · hooks · view-resolver · storage (the rules) ·
                     storage-provisioning (the DDL; bootstrap-only, holds the driver)
  ui/                chrome (the one global menu) · shell-context · dashboard · nav (composeNav) ·
                     menu-config (`#menu-config`) · icons (lucide sprite builder) · list-query · paginate

plugin-api/          The `@plainpages/plugin-api` package — the author barrel, linked into /node_modules
views/               Core EJS in the one app shell: home, index, auth, oauth-consent, error, 403/404/500/503,
                     and partials/ (shell, nav tree, filter bar, data table, pagination, field, auth card,
                     alert, menu/popover, theme switch, language picker, icon sprite). Domain screens live
                     in plugins.
public/              Static assets served at /public/
config/              Drop-in mount: the menu override + branding (config/menu.ts). Ships empty.
locales/             Drop-in mount: extra or replacement catalogs. Ships empty. See Languages.
plugins/             Drop-in mount: plugin folders, scanned at /app/plugins. Ships empty.
ory/                 Ory config — kratos/ (identity schema, oidc claims mapper, tokenizer + dev JWKS),
                     keto/ (namespaces.keto.ts OPL), hydra/, postgres/init/
examples/            Copy-in reference mirroring the mount dirs: plugins/scheduling/, plugins/admin/,
                     config/menu.ts, and shifts-upstream/ (the dev mock backend)
e2e-tests/           Playwright specs + their Dockerfile and compose.{visual,auth,oauth,full,devstack}.yml;
                     proxy.ts (same-origin gateway) and mock-oidc.ts back full-flow
release-tooling/     Everything the release runs: next-version (the bump math), contract-version
                     (the HOST_API_VERSION↔tag gate), dockerhub-overview (+ its .md.tmpl)
registry-cleanup/    Nightly image pruning — the Gitea client plus what survives (select-versions.ts)
ci.sh                The full gate: typecheck → unit tests → every E2E suite on a fresh stack
.gitea/workflows/    Gitea Actions — see CI/CD
```

## Extending the core

- **New page in a plugin:** add a route + handler to the plugin manifest and a template in
  its `views/`.
- **Static asset:** drop it in the plugin's `public/`; served at `/public/<plugin>/<path>`.
- **New dependency in a plugin:** the plugin owns it — see [Plugin dependencies](#plugin-dependencies).
- **New dependency in the core:** deps live in the image, so update the manifest + lockfile and rebuild —
  `--package-lock-only` writes nothing into the checkout, `--user` keeps the two files yours.
  Keep deps minimal — prefer the Node standard library, and an Ory REST call over an SDK.

  ```bash
  docker compose run --rm --no-deps --user "$(id -u):$(id -g)" web npm install --package-lock-only <pkg>
  docker compose build
  ```

All versions are pinned to **exact, human-readable semantic versions** (no ranges, no digests): npm
deps via `.npmrc` (`save-exact=true`) + the committed lockfile (`npm ci`), and container images by
tag in the `Dockerfile` / compose files.

A plugin's `apiVersion` follows the same spirit: a **literal** semver, bumped by hand on rebuild.
Never set it from the host's `HOST_API_VERSION` constant — the plugin would then always equal the
host, so the [compatibility check](#contract-versioning) could never fire.
