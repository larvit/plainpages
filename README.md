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
**Admin** section now shows in the menu. Use `up -d`, not `restart web`: the seed runs in the
one-shot `bootstrap` service, and only `up` re-runs it to pick up the new plugin's permissions
(it is idempotent, so re-running costs nothing).
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
**drop a folder in `plugins/`, restart, it's live.** A plugin that declares `permissions` needs
`docker compose up -d` instead, so the seed re-runs and grants them (as in step 3).

From here, render real pages against the app shell and fetch upstream data — see
[Building plugins](#building-plugins) and the runnable reference in
[`examples/plugins/scheduling/`](examples/plugins/scheduling/).

## Contents

- [Overview](#overview)
  - [how it compares](#how-it-compares)
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
  - [Stateless](#stateless)
- [Testing](#testing)
  - [end-to-end](#end-to-end-playwright)
  - [the full gate](#the-full-gate-one-command)
- [CI/CD](#cicd)
- [Production & deployment](#production--deployment)
- [Upgrading](#upgrading)
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
all** — even the screens for running the system (**users, groups, OAuth2 clients**) are a **drop-in
plugin** you opt into ([`examples/plugins/admin/`](examples/plugins/admin/)). Everything is a plugin.

**Who it's for.** Experienced developers building server-rendered web products — back-office
and operational tools, dashboards, portals, or public sites with a gated area — for their own
use or for a client. You know HTTP, Docker, and identity
providers, and you'd rather assemble pages from building blocks than fight a framework or
hand-roll auth for the tenth time. It's not a no-code tool and doesn't hide its moving
parts: if "Ory is down ⇒ no logins" (see [Auth](#auth-sessions--access)) reads as
obvious rather than surprising, you're the audience.

**Who *they* build for.** The people who end up in front of a Plainpages app are not the
audience above, and three of them shape the design more than any feature request does:

- **The end user** — anyone using the product you assemble from Plainpages + your plugins.
  They never hear the word "plugin": to them the menu, the screens and the sign-in are one app,
  which is why the shell, the auth pages and every plugin share one design system, one menu and
  one language.
- **The power user** — lives in the app all day. Ctrl-clicks a row to open it in a new tab,
  bookmarks a filtered-and-sorted list to come back to on Monday, sends that URL to a colleague,
  and edits the query string by hand when it's faster. This is why list state and the chosen
  language live **in the URL** and why every navigation is a real `<a href>`: middle-click, "open
  in new tab", back, and bookmark all have to work without a second thought.
- **The non-technical user** — clicks a button twice when nothing happens fast enough, never
  touches the tab key, doesn't distinguish a link from a button, and won't recognise an error
  code. This is why destructive actions go through a confirm page instead of an inline
  `?confirm=1`, why a form's labels are clickable and its errors sit next to the field they
  belong to, and why a page must never depend on keyboard-only affordances. A double-clicked
  submit is a real event, not a misuse.

**Included vs. what you add.**

- **Included in the core:** themed sign-in / register / reset (Kratos-backed), the design
  system + app shell, the config-driven menu, sessions, and access control. No domain screens.
- **Opt-in admin plugin:** the **users, groups, and OAuth2-clients** screens (users via
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
server-rendered** design system, **[optional auth](#auth-sessions--access)** (any page
public or gated), **no app database**, and a **framework-light TypeScript** core with no build
step. Each neighbour shares one trait and trades away the rest — Plainpages is the intersection.

## Users, groups & permissions

Authorization here is two hops: a **user** — directly, or through a **group** — is granted a
**permission**, and that permission's *name* is exactly the string a plugin gates on.

- **Group** answers *who* — a reusable set of people. Optional: a permission can be granted
  straight to a user.
- **Permission** answers *what* — its **name is the string** you write in a manifest's
  `permission:` gate.
- **A relation tuple** is the grant: `Permission:<name>#granted@user:<id>`, or
  `@Group:<name>#members`.
- **Resource** answers *which row* — a live check, run only where a plugin explicitly asks for it.

| Entity | Lives in | Answers | Example |
| --- | --- | --- | --- |
| **User** | Kratos | who you are | `user:0198f2c1-…` |
| **Group** | Keto | who — a reusable set | `Group:support` |
| **Permission** | Keto | what you may do | `Permission:scheduling:read` |
| **Resource** | Keto | which specific row | `Resource:shift-4471` |

Users live in Kratos; every authorization edge is a Keto relation tuple. The app itself
stores none of it — it is [stateless](#stateless).

**Keto ships no entities of its own.** Its entire model is one primitive —
`namespace:object#relation@subject` — so the four namespaces above are *ours*, declared in
`ory/keto/namespaces.keto.ts`; Keto only supplies the machinery that resolves them (including
transitively, through nested groups).

> **Ory calls a user an "identity".** Kratos owns that record and names it so: its API is
> `/admin/identities`, and a session carries `session.identity`. Plainpages says **user**
> everywhere, because that is the word readers already know — and Ory's own documentation states
> it uses "identity" interchangeably with "users" and "accounts". You will meet Ory's spelling in
> exactly two places: the Kratos API itself, and the `Identity` type in `src/auth/kratos-admin.ts`
> that mirrors it.

> **There is no `Role`.** In RBAC a permission is a single operation ("read shifts") and a role is
> a *bundle* of them ("IT Support staff"). A route gates on one operation, so it gates on a
> **permission**. When you want the bundle, make a group and grant it several — groups nest, so a
> group of groups works too.

### Naming a permission

**Every permission name is `<resource>:<action>`.** `scheduling:read`, `users:write`,
`oauth2-clients:read`. Both halves are lowercase letters, digits, dashes and underscores, and the
host refuses a plugin that breaks the rule at discovery — so it holds for every installed plugin,
not just the ones you wrote.

- **`<resource>`** names the thing acted on, not the plugin that happens to own it — permission
  names are one **global namespace**, so an operator grants `scheduling:read` once and every plugin
  referencing it is gated consistently. Pick a name no other plugin would claim for something else:
  `oauth2-clients`, not `clients`.
- **`<action>`** names the operation. `read` and `write` cover most screens; use a more specific
  verb when the operation really is distinct (`invoices:approve`).

A bare word is the mistake this rule exists to stop. `admin` says *who someone is*, not *what they
may do* — that is a role, and roles are **groups** here. Split it by resource and action, then
bundle it back up with a group if you want one grant to hand out several:

```
Group:it-support ──> Permission:users:read, Permission:users:write, Permission:groups:read, …
```

The host checks the shape at **discovery**: a plugin gating on — or declaring — a name that isn't
`<resource>:<action>` stops the boot, like any other bad manifest. Declaring is still optional, so
two plugins may deliberately share a name.

> **A `:write` is not a small grant.** Splitting by resource contains the **read** half — `users:read`
> alone is a safe helpdesk grant. It contains the write half much less than the naming suggests:
> `groups:write` lets someone add themselves to a group that holds every permission, and `users:write`
> lets them mint a recovery code for any account and sign in as it. Treat `users:write` and
> `groups:write` as full administrative access.

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

At login the host asks Keto which permissions the user holds, walking those arrows
transitively, and bakes the answer into the session JWT (see [Login and the session
JWT](#login-and-the-session-jwt)):

```
alice → permissions: ["scheduling:read", "scheduling:write"]
bob   → permissions: ["scheduling:read"]
carol → permissions: ["users:read", "users:write"]
```

Note what Carol does *not* have. **Permissions do not nest, and there is no superuser** — running
the Users screen grants nothing on Groups, and nothing at all on `/scheduling`. `it-support` is the
bundle; it is a **group**, not a permission.

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

Bob reaches the shifts list with no direct grant: he is in `support`, support's members are
`staff`, and staff holds `scheduling:read` — two hops, resolved by Keto at his login. He is
refused the new-shift form because `scheduling:write` hangs off `sched-leads`, which he is not in.
Carol reads *and* writes users because `it-support` holds both halves, but the Groups screen is a
different resource and she was never granted it.
An anonymous visitor gets a **redirect**, not a 403, carrying `return_to` so signing in lands them
on the page they asked for; a signed-in user who merely lacks the permission gets the 403 page,
because there is nothing to sign in *as* that would help. The menu is filtered by the same
permissions, so nobody is shown a door they cannot open.

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
declares the permissions it gates on (`permissions:` in the manifest), and the host collects them
into one catalog — `ctx.declaredPermissions` — which is exactly the fixed list the admin screens
offer. Nothing in the GUI invents a name: granting is ticking a box against that list, and a tuple
in Keto naming something no installed plugin declares gates nothing. Name yours
[`<resource>:<action>`](#naming-a-permission).

A change takes effect on the user's **next login or JWT re-mint** (~10 min) — see [Instant
revoke](#instant-revoke-the-optional-denylist) when you need it sooner.

### Fine-grained, per-row access

The `Resource` namespace covers what a coarse permission cannot express: *this* row, shared with
*this* person. It is a separate mechanism — a `Resource` carries Keto `permits` (`view`, `edit`,
`delete`, which nest as `owner` ⊇ `editor` ⊇ `viewer`) and never appears in the JWT.

**A per-row grant never widens a coarse gate.** The route's `permission` is checked *before* the
handler runs, so a user rejected there never reaches the check. Gate the route on something they
hold, then narrow inside the handler:

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

This is the **authoritative reference** for the plugin API — the product's main surface. The
contract is **TypeScript** (`src/plugin-host/plugin.ts`), so the types there are the single
source of truth; the sections below explain them, the guarantees around them, and the rules
the host enforces. A complete, runnable example lives in
**[`examples/plugins/scheduling/`](examples/plugins/scheduling/)** — a public overview page, a
permission-gated list page fetching upstream data (it points `SCHEDULING_UPSTREAM` at its backend;
the dev compose ships a tiny mock, `examples/shifts-upstream/`), a CSRF-guarded form forwarding
writes upstream, and a mix of public + permission-gated nav. It is **not** pre-installed — `plugins/`
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
  i18n/                  # fixed name, optional — this plugin's own catalogs (see Languages)
    en-US.ts             #   the baseline; sv-SE.ts et al are written against its type
  handlers.ts            # your code, any names/layout — host never looks here; plugin.ts imports it
  service.ts             #   e.g. route handlers, upstream calls, domain helpers — design as you wish
```

**Only `plugin.ts` is required.** The host looks for exactly that filename and its
default-exported manifest. `views/`, `public/` and `i18n/` are the fixed folder *names* it resolves
against — used only if the plugin renders views, serves assets or ships translations — but the files
inside are yours to name (a catalog is named for its locale). Everything else (handlers, upstream clients, their filenames and folder layout)
the host never sees; `plugin.ts` simply imports it. The `handlers.ts`/`service.ts` split above is
just an example — name and arrange your modules however you like, or keep a routes-only plugin to a
single `plugin.ts`.

**Identity comes from the folder.** The folder name *is* the plugin `id`, and the mount path is
`/<id>` — neither is written in the manifest, so they can't drift or be claimed twice. The id
must be **URL/path-safe** (`isValidPluginId`: lowercase `a–z`, digits, and dashes — dashes
anywhere; no uppercase, underscores, dots, or slashes); the host rejects a malformed folder name
at discovery. The id also namespaces the plugin's `views/`, its `/public/<id>/` assets, and (by
convention) its nav/permission names.

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
| `nav` | no | `NavNode[]` fragment (same shape `composeNav` consumes). `icon` is a Lucide sprite id (`src/ui/icons.ts`); node `id`s must be globally unique. A `label` that names a catalog key is [translated](#languages-i18n); anything else renders as written. |
| `permissions` | no | Permissions this plugin gates on. See [Nav & permission gates](#nav--permission-gates). |
| `routes` | no | See [Routes & handlers](#routes--handlers). |
| `hooks` | no | See [Hooks](#hooks). |

A plugin may be routes-only, nav-only, or hooks-only — every collection field is optional.

### Routes & handlers

A route is `{ method, path, permission?, public?, handler }`. `path` is **relative to the plugin's
mount path `/<id>`** (so `path: "/:id"` in the `things` plugin serves `/things/:id`); the host
matches `method` + the resolved full path, extracts `:name` segments into `ctx.params.name`,
runs the `permission` gate (a coarse JWT-claim check — see [Nav & permission gates](#nav--permission-gates)),
and only then calls the handler with the [request context](#requestcontext). When the gate fails, an
**anonymous** visitor is redirected to `/login` to sign in; the
requested page is preserved as `return_to`, so after signing in they land **back on the page they
asked for**, not the dashboard. A **signed-in** user who simply lacks the permission gets the **403** page.
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
  to sign in), `can(ctx, permission)` (a coarse JWT-claim check, zero I/O), and `check(keto, ctx,
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
branch on `ctx.permissions` *inside* to tailor the page per permission. Don't gate `dashboard` itself behind a
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

**`ctx.chrome`** is the page chrome the host builds per request — `{ brand, csrfToken, nav, signInHref,
theme, user }`. Hand it to `partials/shell` so a `view` result renders the **native app shell** (the same
sidebar, branding, theme switch and signed-in profile every page uses); `chrome.nav` is the
global menu — your plugin's nav fragment plus every other installed plugin's (the admin section among
them, when that plugin is present) — already composed, permission-filtered, and current-marked for this
request (the gated **Dashboard** link is omitted for an
anonymous visitor). `chrome.signInHref` is where the shell's anonymous **Sign in** link points — the
current page baked in as `return_to`. Map each `chrome.*` to the matching `partials/shell` local —
`brand`, `csrfToken`, `nav` (the rendered nav-tree), `signInHref`, `theme`, `user` — exactly as the
reference `examples/plugins/scheduling/views/overview.ejs` does; a value you forget simply falls back to its
shell default (e.g. a bare `/login`), it does not error. **`ctx.verifyCsrf(submitted)`** guards a
state-changing form: render `chrome.csrfToken` in a hidden `_csrf` field, then on POST read your own
body and `if (!ctx.verifyCsrf(form.get("_csrf"))) throw new GuardError(403, …)`. The host owns the
secret and sets the cookie; the plugin never touches it. It is **opt-in per handler** — a route
that never calls it has no CSRF guard at all. (See the reference: `examples/plugins/scheduling/`.)

The same shell renders **every** page (the dashboard, your plugin pages — the admin plugin's included, and the
login/registration/front pages), so the menu looks identical signed in or out — it just permission-filters.
A page that wants a focused, chrome-free layout passes **`menu: false`** to `partials/shell` (drops the
sidebar, single column); everything else still renders.

**`ctx.t`** translates in the request's language, and the same block (`t`, `locale`, `locales`,
`localeHref`, `dir`) is merged into every view's data — see [Languages](#languages-i18n).

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
but prefer the typed fields so a handler keeps working as the host evolves. `user`/`permissions` come
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
  keto?: KetoClient;                    // relationship read/write (groups, permissions)
  kratosAdmin?: KratosAdmin;            // identity admin (create/edit/deactivate/delete users)
  revoke?: (sub: string) => void;       // instant-revoke a subject's live tokens (needs the denylist)
}
```

`ctx.system` is **`undefined` unless the host wired at least one** of these (Kratos/Keto configured,
Hydra configured, the [revocation denylist](#instant-revoke-the-optional-denylist) enabled). A system
plugin treats every field as optional and **degrades when absent** — the host never fails a request
over it. The built-in **admin plugin** ([`examples/plugins/admin/`](examples/plugins/admin/)) is the
reference consumer: its Users screen uses `ctx.system.kratosAdmin`, Groups and the permission pickers use `ctx.system.keto`,
OAuth2 clients use `ctx.system.hydra`, and a deactivate/delete or user permission-change calls
`ctx.system.revoke` so the change lands now instead of after the JWT TTL; where a capability is missing
the screen renders a themed 503.

This is a **privileged** surface — it hands a plugin the keys to identity and authorization. It's meant
for first-party system plugins you author or vendor, the same trust level as any plugin (the host
doesn't sandbox — [crash-isolation is a non-goal](#overview)). An ordinary domain plugin ignores it.

### Nav & permission gates

A plugin's `nav` fragment is merged into the global menu by `composeNav` (`src/ui/nav.ts`), which
applies the central override and then **filters per user** by the permissions in the session JWT — a
node shows iff it is `public`, declares no `permission`, or the user's permissions include that name. Use
arbitrary depth, counts, and icons; see `composeNav` for the node shape. A node's `icon` is a
**Lucide icon**, referenced by its sprite id (e.g. `i-cal` → lucide `calendar`); the available ids
are `ICON_NAMES` in `src/ui/icons.ts`, and adding one means registering its lucide name there.

**Gating a section header.** Putting the `permission` on the header is the simple form — the whole
subtree disappears with it. When the children need *different* permissions, leave the header ungated
and gate each child: `composeNav` drops a header whose children all filtered out. That second form
only works while the header carries **no `href`** — give it one and it survives the filter as an
ungated leaf, visible to everyone. The admin example uses it (three screens, six permissions).

#### Public pages & menu items

A route or nav node may be marked **`public: true`** — reachable by **anyone, signed in or not**,
and the menu item shows for everyone. This is the same as omitting `permission` (an ungated
route/node is already open) but stated outright, so "public" is a **deliberate choice, not the
accident of a forgotten gate**. `public` and `permission` are **mutually exclusive** — declaring
both is contradictory and discovery refuses the plugin at boot.

A public page still renders in the native shell via `ctx.chrome`; for an anonymous visitor
`ctx.user` is `null`, the shell shows a **Sign in** link (`chrome.signInHref`, returning to this page)
in place of the profile/sign-out block, the gated **Dashboard** link is hidden, and `ctx.permissions` is
empty (read a permission with `can(ctx, …)` to branch). The reference plugin's `/scheduling`
**Overview** is a worked example: it's `public`, so the "Scheduling" menu header shows for everyone,
while the actual shifts list stays behind `scheduling:read`.

The gate passes iff the user's JWT `permissions` include that name. How permissions are granted, why their
names are a shared global namespace, and the fine-grained per-row tier are all covered in
[Users, groups & permissions](#users-groups--permissions).

Declaring the ones you gate on in `permissions` is **optional but recommended**: it documents them,
feeds conflict detection, and lets the one-command bootstrap seed them — the demo admin is
granted every discovered plugin's declared permissions, so a dropped-in plugin works out of the box
without editing host config.

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
| `permission` | warn | A permission name is declared by more than one plugin. Sharing is legitimate; pick a more specific [`<resource>`](#naming-a-permission) if unintended. |

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
reading the permissions in the session JWT (no per-request authz call — see
[Auth, sessions & access](#auth-sessions--access)), so the menu only ever shows
what that person can reach. An item (or a whole page) may instead be marked **`public:
true`** to show it to **everyone, signed in or not** — the blessed, explicit way to expose
a public page and its menu entry (an ungated item is already public; `public` just
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
  session — a `GuardError` the host turns into a redirect to sign in), `can(permission)` (a coarse
  JWT-claim check, zero I/O), `check(relation, object)` (the one live Keto call, for
  relationship rules).

## Interactivity: zero-JS spine

The core and all building blocks **work with zero JavaScript** — theme switching and filtering
are pure CSS + GET forms, and menus are the platform's own [popover
API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API): a `<button popovertarget>`
opens the panel and the browser dismisses it on a click outside or `Esc`; CSS anchor positioning
places it. On a browser too old for the popover API the trigger is inert, so each panel falls back to
flowing inline underneath it — cramped inside a table cell, but nothing is unreachable. That path
is deliberately untested: no browser that supports popovers can render it. On the [low-end, low-bandwidth targets](#overview)
we care about this is usually *faster*: a round-trip returning a small, pre-rendered HTML
page beats a client-side runtime that must boot, fetch JSON, and re-render before anything
shows. List state (`?q=…&status=…&sort=…&page=…`) lives **in the URL**, so a view is
bookmarkable, shareable, and reproducible — the URL is the only state the UI keeps.

Plugins that genuinely need it — live dashboards, bulk actions, client-side validation —
may **opt into progressive enhancement** (htmx, Alpine, or vanilla JS) on top of working
server-rendered HTML. The baseline never depends on it.

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
**adds** a language, one for a tag the image already ships **replaces** that catalog wholesale (and
is held to the same parity check, so a partial replacement fails the boot instead of leaving half
the app in English). `locales/plugins/<id>/<tag>.ts` does the same for an installed plugin's words,
checked against *that plugin's* `en-US` — so translating a vendored plugin, or fixing its wording,
never means forking its folder:

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
catalog for it. There is **no locale cookie**: the URL is the only place a choice
is stored, so a link is shareable and a page is what its address says it is. When the URL asked
for a language, the host carries `?locale=` onto every link *it* renders (menu, sign-in, its own
redirects) and `ctx.localeHref(href)` does the same for a plugin's links. The picker in the
sidebar footer (and on the auth pages) lists every installed locale, each a plain link to the
same page in that language; it renders whenever more than one locale is installed — **on every
page**. After a POST the current URL may answer no GET at all (`POST /admin/users/:id/recovery`
renders a page and has no GET sibling), so the host points the picker at the nearest page that does:
this path when it answers GET, else the page the form was submitted from, else `/`. Switching
language there therefore leaves the POST's own result behind — a re-rendered form's input, or a
one-time code — which is the accepted cost of having the picker everywhere.

**Writing a catalog.** `en-US.ts` exports the object and its type; every other locale is written
against that type, so a missing or misspelled key is a type error before the app ever boots. For a
language of your own: copy `src/i18n/locales/en-US.ts` into `locales/<tag>.ts`, type it
`CoreMessages` (from `#plugin-api`), and translate. The `as PluralMessage` cast below is required —
without it the inferred type pins the plural forms to English's two, and a locale that selects more
(Polish, Arabic) becomes unwritable:

```ts
// plugins/shop/i18n/en-US.ts
import type { PluralMessage } from "#plugin-api";

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
plural message that doesn't cover the categories its locale actually selects (`Intl.PluralRules`)
**stops startup** with the full list — a half-translated deploy never reaches a visitor. A plugin
may translate *fewer* locales than the host (its strings then render in `en-US` on that page), but
never one the host doesn't have.

**Using it.** `ctx.t(key, vars)` in a handler; in a view `t(...)` is already there, along with
`locale`, `locales`, `localeHref()` and `dir` — the host merges them into every render, at any
include depth:

```ts
// handler
return { data: { title: ctx.t("shop.title"), lead: ctx.t("shop.greeting", { name }) }, view: "shop" };

// a pure view model built outside a request (its unit test) defaults to the plugin's own English:
import { englishTranslator, type Translate } from "#plugin-api";
import enUS from "./i18n/en-US.ts";
const EN: Translate = englishTranslator(enUS); // your catalog, then the host's
```
```html
<!-- view -->
<h1><%= t("shop.title") %></h1>
<p><%= t("shop.orders", { count: orders.length }) %></p>
<a href="<%= localeHref("/shop/new") %>"><%= t("shop.new") %></a>
```

Three rules worth knowing:

- **An unknown key renders as itself.** That is what lets a nav label be either a catalog key or
  plain text — `nav: [{ label: "shop.title" }]` is translated, `label: "Shop"` is not, and neither
  breaks. The same holds for `config/menu.ts` branding and its `rename` overrides.
- **`t()` returns raw text; the view escapes it.** Use `<%= %>` as for any other value. A message
  that deliberately carries markup is rendered with `<%- %>` — and its `{{vars}}` must then be
  escaped at the call site, since nothing escapes them there (`pagination.ejs` is the worked example).
- **Dates and numbers are `Intl`'s job**, not the catalog's: `new Intl.DateTimeFormat(ctx.locale)`.
- **The core building blocks carry the locale for you** — every href they render (menu, breadcrumbs,
  pagination, sort headers, row actions, the auth card's links) goes through `localeHref`, and their
  GET forms carry it as a hidden field, since a GET submit replaces the whole query string.
  `ctx.localeHref` is for hrefs and form actions your own markup emits (a POST replaces the URL just
  as a GET submit does), and `localeParam` (a view local: the tag, or null) for your own GET forms.
  `locale` is reserved: `parseListQuery` never returns it as a filter. Responses carry
  `Vary: Accept-Language`, so a cache in front of the app keys on the language too.
- **Reuse the core words.** Generic UI verbs live in the core catalog — `common.add/cancel/delete/
  edit/new/remove/save`, `filter.*`, `pagination.*`, `table.*` — and a plugin's lookup falls through
  to them. Keep your catalog for your domain words, so N plugins don't re-translate "Cancel" N times.
- **These view locals are reserved:** `t`, `locale`, `locales`, `localeHref`, `localeParam`,
  `localeSwitch`, `dir`. They are merged after your `data`, so a key of yours with one of those names
  is ignored rather than breaking the shell.

**Kratos writes the auth flow's own text** (field labels, validation errors) and tags each string
with a stable numeric id; a `kratos.<id>` key replaces it, and anything unmapped renders Kratos'
English as-is. Field labels are keyed on the input name instead (`auth.field.password`), because
Kratos' trait-label id is generic — the same id says "Email" on the login form and "First name" on
a registration form. Operator- and developer-facing text (boot errors, logs) stays English.

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
| `KETO_READ_URL` / `KETO_WRITE_URL` | `http://keto:4466` / `:4467` | authorization check / write |
| `HYDRA_ADMIN_URL` | `http://hydra:4445` | OAuth2 provider admin API (login/consent handshake) |
| `JWKS_URL` | `file://…/tokenizer/jwks.json` | the Kratos tokenizer signing key; verifies the session JWT |
| `JWT_ISSUER` / `JWT_AUDIENCE` | _unset_ | optional: when set, the session JWT's `iss` / `aud` must match (the dev tokenizer sets neither) |
| `JWT_CLOCK_SKEW_SEC` | `60` | exp/nbf leeway (s) for Kratos↔web clock drift (the auth E2E sets `0`) |
| `ORY_TIMEOUT_SEC` | `5` | per-call timeout for outbound Kratos/Keto/Hydra (and http JWKS) fetches, so a hung Ory can't park a request |
| `REVOCATION_DENYLIST` | `false` | when `true`, enable the optional [instant permission/session revoke denylist](#instant-revoke-the-optional-denylist) |
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
[Quick start](#quick-start)). What can't be auto-generated is **production-only** — none of it
blocks a clean clone:

1. **Production secrets** — every value below ships as a committed dev throwaway that works
   out of the box and **must** be replaced before a deploy faces the internet. Only the first
   is enforced: `REQUIRE_SECURE_SECRETS=true` refuses to boot on a missing or throwaway
   `CSRF_SECRET` and **nothing else** — the rest fail silently, so treat this as a checklist.

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

2. **SSO provider client id/secret** — **optional**; password login works without them.
   Supplying a provider's creds via env activates it; no creds ⇒ no SSO button (see
   [Social sign-in (SSO)](#social-sign-in-sso)).

Everything else is generated or seeded on first boot — Ory migrations, the dev signing key,
the demo admin identity and its Keto permissions, the Keto OPL model — so there is nothing else to
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

## Auth, sessions & access

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

**Keto is the single source of truth for permissions.** Coarse permissions are Keto relations (e.g.
`Permission:admin#granted@user:alice`); the admin screens write them *only* to Keto. But the
tokenizer's claims mapper can read only the **identity**, not call Keto — so at login the
app reads the permissions from Keto and refreshes a **derived projection**: a read-only copy
written onto the identity's `metadata_public` for the tokenizer to see, which the template
maps into the JWT `permissions` claim. (It must be `metadata_public`, not `metadata_admin`: the
session Kratos hands the tokenizer carries only *public* metadata — and the user can already
read these coarse permissions in their own JWT, so nothing is leaked.) That projection is a
per-login cache, authoritative nowhere; nothing edits it by hand, and a stale one self-heals
on the next login.

A permission can be granted to a user directly or to a **group** the user belongs to; login
resolves both (enumerate the defined permissions, ask Keto to resolve each membership), so the JWT
`permissions` match what the admin **Effective access** view shows.

Cost: **a handful of Keto reads + one identity refresh per login** — never per request. JWKS
is cached, so even signature verification hits the network only on key rotation. The app
stays stateless; "stay signed in" = re-mint the JWT on a short TTL, the one moment authz is
recomputed from Keto.

#### Two trade-offs — both deliberate

This design buys an I/O-free hot path that scales to **tens of thousands of concurrent
users** on modest hardware. In return:

- **Permission changes lag by up to one TTL (~10m).** Gating reads the JWT, not Keto, so a granted
  or revoked permission only takes effect when the token is next minted (re-login or TTL refresh).
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
security-critical revoke (offboarding, a compromised account) the ~10m permission/session lag
above is too long. When enabled, an admin **deactivating** or **deleting** a user, or
**granting/revoking** a permission to a *user*, records that subject as revoked-now; the hot path
then rejects every token for it minted **before** the revoke and forces a re-mint — which
re-reads permissions from Keto, or clears a now-dead session. A fresh re-login (its JWT issued
*after* the revoke) passes, so a permission downgrade lands immediately without locking the
account.

It's an in-memory, auto-evicting map — no database, like the JWKS cache, so it stays inside
the stateless model. Entries self-evict after `REVOCATION_TTL_SEC` (default 900s ≥ the 10m
token TTL + skew), by which point any pre-revoke token has expired anyway. The check is pure
CPU — **Keto stays off the hot path**. Two deliberate bounds: it's instant on the **single
instance** that handled the revoke (across replicas/restarts the guarantee falls back to the
token TTL — back the denylist with a shared store for hard multi-instance instant-revoke),
and a **group** membership change is transitive across many users, so it's left to lag —
deactivate the user, or use a direct user-permission change, for an instant effect.

### Three tiers of "may I?"

[Users, groups & permissions](#users-groups--permissions) covers *what* the entities are; this is where each
**kind** of rule belongs.

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

The admin plugin's users / groups screens write authorization **only to Keto** — coarse
permissions and fine-grained relationships alike.

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

### Security model

Everything above is *how* auth works. These are the few things the code won't tell you quickly,
and that get a deployment wrong if you don't know them.

**The private container network is the *only* thing guarding the Ory APIs.** Kratos admin
(`4434`), Hydra admin (`4445`) and Keto write (`4467`) authenticate no one — reaching them *is*
full identity and authorization control. Keto **read** (`4466`) cannot write, but discloses the
entire authorization graph, so treat it the same. `compose.yml` publishes none of the six Ory
ports (guarded by `src/compose.test.ts`); dev publishes only the two a browser must reach. Never
expose one, and never front one with a proxy that lacks its own auth.

**The JWT is signed, not encrypted.** Claims are base64: a signed-in user can read their own
`sub`, `email` and `permissions`. `HttpOnly` keeps page JavaScript out of the cookie, not the user.
Never put anything in a claim you wouldn't show them.

**The JWT's ~10m TTL is not the session lifetime.** The browser also holds Kratos'
`plainpages_session` cookie (30 days, sliding), and *that* is what silently re-mints a lapsed
JWT. So a stolen cookie jar is worth 30 days of re-mintable access, not ten minutes. Only our
two cookies obey `SECURE_COOKIES`; the Kratos one takes its flags from Kratos' own config.

**Offboarding is not instant by default.** An expired JWT re-mints off that live Kratos session,
re-reading permissions from Keto — so a revoked permission, or a deactivated identity, lands within one
token TTL rather than immediately. With the
[denylist](#instant-revoke-the-optional-denylist) on (it is off by default), both take effect at
once, on the instance that handled the change.

**Not guaranteed** — accepted, and stated where each mechanism is: permission changes
[lag up to one token TTL and sign-in needs Ory up](#two-trade-offs--both-deliberate), and the
denylist is [single-instance and skips group changes](#instant-revoke-the-optional-denylist).
Hardening a real deploy is `REQUIRE_SECURE_SECRETS=true`, `SECURE_COOKIES=true`, and replacing
**every** committed dev secret — see
[what you must supply](#what-you-must-supply-the-only-manual-prep). `REQUIRE_SECURE_SECRETS`
guards only `CSRF_SECRET`; nothing fails loud if you ship Ory's, Postgres' or the demo admin's
throwaways.

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

| Container      | Permission |
| -------------- | ---- |
| `web`          | The Node 24 + TypeScript app: server-rendered EJS, the plugin host, the building-block partials. Stays tiny. |
| `kratos`       | **Ory Kratos** — identity: login, registration, password reset, SSO, sessions. |
| `keto`         | **Ory Keto** — permissions: the authorization decisions (`can user X do Y on Z?`). |
| `hydra`        | **Ory Hydra** — OAuth2/OIDC provider, so other apps can log in *through* plainpages. |
| `postgres`     | **Ory's** storage (Kratos/Keto/Hydra). |

The `web` app is an Ory **relying party**: it never stores passwords. At login it turns
the Kratos session into a short-lived, **locally-validated JWT** (the Kratos session
tokenizer) carrying the user's coarse permissions — so every later request gates the menu and
pages by **verifying the JWT in-process, with no per-request call to Ory**. Keto answers
the rarer fine-grained checks; Hydra is used only when the app acts as an OAuth2 **login &
consent provider** for other apps. It reaches the Ory services over their **REST APIs
using Node's built-in `fetch`** — no SDK dependency. See
[Auth, sessions & access](#auth-sessions--access).

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

**Visual + design system** (`visual.spec.ts`, `language.spec.ts`) — Ory-free, so it stays fast. It
screenshots the live pages and asserts the rendered design system — the app shell, theme switch,
mobile off-canvas layout, icon sprite, CSRF-guarded sign-out, the public landing, the 404 page, and
plugin permission-gating — the last exercised by bind-mounting the reference example
(`examples/plugins/scheduling/`) onto `/app/plugins/scheduling`. `language.spec.ts` drives
[language switching](#languages-i18n) in the browser: the picker, the choice surviving a click into
the plugin's own pages, an `Accept-Language`-only visitor, and the fallback for an uninstalled locale.

```bash
docker compose -f compose.yml -f e2e-tests/compose.visual.yml run --user "$(id -u):$(id -g)" --build --rm e2e   # run the suite
docker compose -f compose.yml -f e2e-tests/compose.visual.yml down -v                 # tear down after
```

**Auth — token timeout + refresh** (`auth-refresh.spec.ts`) — the full-stack counterpart: it
boots the real Ory stack (Postgres + Kratos + Keto + bootstrap), shortens the session→JWT TTL
to 8s (`ory/kratos/e2e.yml`) and sets `JWT_CLOCK_SKEW_SEC=0`, then logs in the seeded admin
and proves the "stay signed in" hot path: the lapsed JWT is silently **re-minted** from the
live Kratos session (permissions re-read from Keto), and once that session is revoked the stale
cookie is **cleared**.

```bash
docker compose -f compose.yml -f e2e-tests/compose.auth.yml run --user "$(id -u):$(id -g)" --build --rm e2e   # run the suite
docker compose -f compose.yml -f e2e-tests/compose.auth.yml down -v                 # tear down after
```

**OAuth2 login + consent** (`oauth-login.spec.ts`) — another app logs in *through* us: it
boots the real stack (incl. Hydra), registers an OAuth2 client, starts an authorization flow,
and drives the handlers end-to-end — `/oauth2/login` bounces an unauthenticated user to the
themed login and **accepts** the challenge once a Kratos session exists; `/oauth2/consent`
then shows the consent screen for the third-party client and **Allow** drives Hydra to issue
the authorization code.

```bash
docker compose -f compose.yml -f e2e-tests/compose.oauth.yml run --user "$(id -u):$(id -g)" --build --rm e2e   # run the suite
docker compose -f compose.yml -f e2e-tests/compose.oauth.yml down -v                 # tear down after
```

**Full browser flow** (`full-flow.spec.ts`) — the real Playwright UI against the live stack:
the themed **password login** and a **mocked-SSO** login (an in-network mock OIDC provider,
`e2e-tests/mock-oidc.ts`), **menu filtering by permission**, the **users/groups/permissions** admin CRUD, the
**OAuth2-clients** admin screen (register → one-time secret → delete; Hydra is part of this stack
for it), a permission-gated **plugin page**, and **logout**. Because the themed form posts straight to
Kratos and cookies are host-scoped, a tiny same-origin gateway (`e2e-tests/proxy.ts`) fronts web +
Kratos on one host (`ory/kratos/e2e-proxy.yml` points Kratos at it) — exactly as a production
reverse proxy would.

```bash
docker compose -f compose.yml -f e2e-tests/compose.full.yml run --user "$(id -u):$(id -g)" --build --rm e2e   # run the suite
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
docker compose -f compose.yml -f compose.override.yml -f e2e-tests/compose.devstack.yml run --user "$(id -u):$(id -g)" --build --rm e2e   # run it
docker compose -f compose.yml -f compose.override.yml -f e2e-tests/compose.devstack.yml down -v                # tear down
```

Screenshots + an HTML report land in `e2e-tests/artifacts/` (git-ignored; `--user` above is what
keeps them yours to delete — the runner writes them into your checkout). On **rootless** Docker drop
that flag: container root is already you there, and a mapped uid cannot write. Every user-facing flow
is covered end-to-end; tests are independent and run **fully in parallel** for speed
([AGENTS.md](AGENTS.md)) — keep new tests side-effect-free so the suite stays fast.

**Anything the browser logs fails the test.** Specs import `test` from
`e2e-tests/console-guard.ts`, which watches every page a test opens — a console error or warning, or
an uncaught exception, fails that test; a page that provokes one on purpose allows it explicitly with
`allowConsole(/…/)`. The Ory-free suites run in **Chromium, Firefox and WebKit**, so each engine's
console is read; the Ory-backed suites share one backend and stay on Chromium.

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
| `release.yml` | push of a `vX.Y.Z` tag | re-tag that commit's image as `X.Y.Z`, `X.Y`, `X`, `latest`; sync those tags to Docker Hub |
| `mirror.yml` | push to `main` or any tag, or manual | force-push `main` + tags (pruning deleted ones) to the [GitHub mirror](https://github.com/larvit/plainpages) |
| `registry-cleanup.yml` | nightly cron, or manual | delete registry images that are neither release-tagged nor a branch head |
| `renovate.yml` | nightly cron, or manual | open dependency-update PRs, automerge them once the gate is green; the release-tag job only runs when `AUTO_RELEASE` is `true` |

`main` is not re-tested on push — its commits are meant to arrive already green from a
gated branch, so the status check to gate a merge on is `CI / full-gate (push)`.

**Merge gate on `main`** (Gitea branch protection + repo merge settings, set via the API —
no repo files involved): direct pushes are blocked, changes land via PR only, the
`CI / full-gate (push)` status must be green (admins included), and the only merge style is
**fast-forward-only** — history stays linear and `main`'s head is the exact commit hash of
the merged branch, which is why the branch's push-triggered status carries over.

**Container images** — after a green gate, `ci.yml` builds the app image and pushes it to the
Gitea container registry as `gitea.larvit.se/larvit/plainpages:<full commit hash>`. Because
merges are fast-forward-only, the image for any `main` commit already exists — it was built
and pushed by that exact commit's branch gate; nothing is rebuilt after merge (build once,
promote by re-tagging). One-time setup: on an account with package write in the `larvit` org,
create a Gitea access token with `read:package` + `write:package`, and store the account name
as the Actions **variable** `DOCKER_REGISTRY_USER` and the token as the Actions **secret**
`DOCKER_REGISTRY_TOKEN` (a `GITEA_` prefix is rejected — reserved, like `GITHUB_`). The
package is **org-owned** (the image path starts with `larvit/`), so it lists under
`larvit/-/packages`, not the repo — link it once to the repo's Packages tab:
`POST /api/v1/packages/larvit/container/plainpages/-/link/plainpages`. Because
this step runs
inside the required gate, a missing/expired token (or registry outage) fails every branch's
gate and blocks **all** merges until restored — set the secrets before this lands, and use a
non-expiring token or track its expiry. Retention: hash tags accumulate one image per gated
push, so the nightly `registry-cleanup.yml` prunes them
([`registry-cleanup/cleanup.ts`](registry-cleanup/cleanup.ts) defines what survives).
It reuses `DOCKER_REGISTRY_USER`/`DOCKER_REGISTRY_TOKEN` — no extra setup. Don't
add a pattern-based org cleanup rule for this package (and remove it if one exists): its
age/count heuristics can't see branch heads or release tags and would delete images the
workflow protects.

**Releases** — pushing a semver git tag (`git tag v1.2.3 && git push origin v1.2.3`) runs
`release.yml`, which pulls that commit's hash image from the registry and re-tags it as
`1.2.3`, `1.2`, `1`, and `latest` — nothing is rebuilt, the released image is byte-identical
to the gated one. It fails loud if no hash image exists: release tags must point at a commit
that went through the gate (in practice, any `main` commit). The same four tags are then
synced to [Docker Hub](https://hub.docker.com/r/larvit/plainpages) (`larvit/plainpages`) —
releases only, no hash tags. One-time setup: create the public `larvit/plainpages`
repository on Docker Hub, generate a read/write access token **scoped to that repository**
(an organization access token, or a token on a dedicated single-purpose account — an
account-wide PAT can push to every repo under the account), and store the account name as
the Actions **variable** `DOCKERHUB_USER` and the token as the Actions **secret**
`DOCKERHUB_TOKEN`. Until they exist, a release run fails at the Docker Hub step — after the
Gitea re-tag has succeeded — so set them, then re-run the workflow. The Docker Hub
repository **description** is maintained by hand: its source is
[`README-dockerhub.md`](README-dockerhub.md) — paste it into the repository overview on
Docker Hub when it changes.

**GitHub mirror** — [github.com/larvit/plainpages](https://github.com/larvit/plainpages) is a
read-only mirror; after every merge, `mirror.yml` force-pushes `main` and all tags there,
overwriting any drift. Tags are pushed with `--prune`, so deleting one here deletes it there on
the next mirror run — ref deletions don't trigger the workflow themselves — and the mirror can't
go on advertising a version the source dropped; branches other than `main` are matched by no
refspec and are left alone. The same sweep removes a tag *created* on GitHub, so cut releases on
Gitea, never on the mirror — a GitHub Release made there loses its tag and does not come back.
One-time setup: a dedicated
GitHub machine account with write access to the GitHub repo (whose `main` must not block
force-pushes, and which must carry no tag protection — that would reject the prune and fail every
run), and a fine-grained PAT scoped to that repo (Contents: read & write), stored
as the Gitea Actions secret `MIRROR_GITHUB_TOKEN` (repo Settings → Actions → Secrets; Gitea
rejects secret names starting with `GITHUB_`/`GITEA_`). Trigger the workflow manually for
the first sync — until the secret exists, the mirror job fails loud on each merge.

**Dependency updates** — `renovate.yml` runs [Renovate](https://docs.renovatebot.com)
nightly (self-hosted, this repo only) against [`renovate.json`](renovate.json), opening PRs
that bump npm deps (both `package.json`s), Docker base images (both Dockerfiles +
`compose*.yml`), Gitea action versions, and the image tags pinned inside workflow `run:`
steps (a custom regex manager, so nothing pinned drifts unmanaged). Version-locked sets move
together in one PR — the Ory images (kratos/keto/hydra) and the Playwright runner + its
browser image — and every bump keeps the existing **exact semver pin** exact, never widening
to a range or adding a digest. Each PR
runs through the normal gate on its `renovate/*` branch and, with `"automerge": true`,
Renovate merges it once `CI / full-gate (push)` is green (rebasing stale branches so the
fast-forward-only merge still holds) — routine bumps land untouched; only a red gate needs a
human. One-time setup: reuse the shared `renovate@larvit.se` bot — give it write access to
this repo and store its Gitea PAT as the Actions **secret** `RENOVATE_TOKEN`. Until it
exists, the nightly job fails loud (and, like the other secrets, a `GITEA_`/`GITHUB_`
prefix is rejected). Also store a **scopeless** (read-only) github.com PAT as the secret
`RENOVATE_GITHUB_TOKEN` — the workflow hands it to Renovate as `GITHUB_COM_TOKEN`, so
lookups of github.com-hosted deps (actions, Playwright, changelogs) run authenticated
instead of tripping the anonymous 60-requests/hour limit.

**Releases are paused.** Plainpages is pre-announcement: the repository carries **no tags**, and
neither `release.yml` nor Docker Hub has a version to promote. Turn releasing back on by setting the
Actions **variable** `AUTO_RELEASE` to `true` (that alone re-enables the job below), or cut a
`vX.Y.Z` tag by hand **on `main`'s tip** — with nothing tagged, the nightly registry cleanup keeps
only branch-head images, so an older commit's image is already gone and `release.yml` would fail
loud with nothing to promote.

**Auto-release on dependency updates** — a second job in `renovate.yml` (`auto-release`, `needs:
renovate`, gated on `AUTO_RELEASE` above) cuts **one** `vX.Y.Z` tag per run covering the
renovate-bot commits merged to `main` since the last tag (it targets `origin/main`, and
**skips** when the tip isn't a Renovate commit —
a human owns that release — or when nothing new merged). Renovate stamps every commit with a
`Release-Bump: <updateType>` trailer (`commitBody` in `renovate.json`), and
[`auto-release/next-version.ts`](auto-release/next-version.ts) (unit-tested) turns the highest
trailer on those commits into the next version — pre-1.0 it never auto-crosses into `1.0.0`,
which stays a deliberate hand-cut tag. It's
**tag-only** (no source commits): the tag hands off to `release.yml`, which promotes the
already-built image, and is pushed with renovate-bot's PAT so `release.yml` actually fires (a tag
pushed by the built-in Actions token wouldn't trigger it). The plugin-contract version
(`HOST_API_VERSION`) is deliberately **not** touched here — it moves only when the plugin API
itself changes, by hand.

**One-time server setup** — register an
[act_runner](https://docs.gitea.com/usage/actions/act-runner) in host mode with the label
`docker-host` (config: `labels: ["docker-host:host"]`) on a machine with Docker Engine +
Compose, git, and Node + github.com access (for `actions/checkout`). Runs must **never
overlap** — the e2e stacks use fixed compose project names and the devstack suite uses host
networking, and the workflows share the Docker daemon's registry login (`ci.yml` and
`release.yml` each log in and log out) — so register exactly **one** `docker-host` runner,
keep its capacity at 1, and keep host ports 3000/4433 free.

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
signing key if absent, creates the demo admin in Kratos, and grants it every discovered plugin's
declared permission names in Keto (plus any `ADMIN_PERMISSIONS`), so permission checks (and any
dropped-in plugin) resolve out of the box. The web app waits for Kratos + Keto to be healthy
*and* the bootstrap to finish before starting. **Change the demo admin before production.**

## Upgrading

**Re-copy your drop-in plugins.** Anything under `plugins/` is *your* copy — the host never updates
it. When you pull a newer Plainpages, a plugin you copied from `examples/` is still the old one, and
the host may have tightened a manifest rule since. Discovery fails loud at boot rather than running a
plugin it can't honour, naming the plugin and the rule:

```bash
rm -rf plugins/admin && cp -r examples/plugins/admin plugins/admin
docker compose up -d --build
```

Do the same for any other folder you copied out of `examples/`. A plugin you wrote yourself needs the
manifest change the error names — the same rules the shipped examples follow.

Once [`HOST_API_VERSION`](#contract-versioning) starts moving, you won't have to read the rule to know
why: a breaking manifest change bumps the major, and a plugin built against an older host is refused
by **version**, naming both. The version is frozen at `1.0.0` until the first external plugin exists,
so for now the error names the rule it tripped instead.

### Breaking changes

- **Permission names must be `<resource>:<action>`** (2026-08-05). A manifest gating on — or
  declaring — a bare word like `admin` now stops the boot. The bundled admin plugin was split into
  `users:`/`groups:`/`oauth2-clients:` × `read`/`write`, so a copy taken before this needs re-copying.
  `ADMIN_PERMISSIONS` is held to the same rule, but an unusable value there is dropped with a warning
  rather than failing the boot. See [Naming a permission](#naming-a-permission).
- **Deps moved to `/node_modules`, above `/app`** (2026-08-05). Run `rmdir node_modules` after
  pulling (it is empty — no `sudo`) and `docker volume prune`. Keep that path clear: anything there
  silently shadows the image's deps.
- **`e2e-tests/artifacts/` is tracked, and the E2E runner writes as you** (2026-08-05). A root-owned
  leftover from an earlier run blocks the checkout of its `.gitkeep` — git reports the failure but
  still exits 0, leaving the file staged as deleted — and every E2E suite then fails `EACCES`. Clear
  it before pulling; a root container does what `sudo` would, which this needs and a dev box may lack:

  ```bash
  docker run --rm -v "$PWD/e2e-tests:/x" alpine:3.23 rm -rf /x/artifacts
  git checkout -- e2e-tests/artifacts/.gitkeep
  ```

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
missing-permission/CSRF rejections log at `info`/`warn`, and the catch-all 500 + the
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
3. **Verify** new logins mint the new `kid` — decode the `plainpages_jwt` cookie's JWT
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
    jwt-middleware.ts resolveSession()/authenticate(): per-request session-JWT verify — key by kid → signature → exp/nbf/iss/aud (clock skew) → ctx.user/permissions; flags a lapsed token for re-mint
    jwks.ts           JwksProvider — resolve the verify key by kid; createJwksProvider() picks by scheme: staticJwks (base64) or cachingJwks (file/http: TTL cache + rotation-on-miss reload)
    gen-jwks.ts       generateJwks()/rotateJwks() + CLI (mint · --prepend · --prune): the ES256 session-tokenizer signing JWKS; see JWT signing key & rotation
    login.ts          completeLogin()/remintSession(): login completion + TTL re-mint — permissions from Keto → metadata_public projection → tokenize → session JWT cookie
    guards.ts         requireSession()/can()/check(): in-handler authorization — the imperative counterpart to the route permission gate; GuardError → 303 /login or 403; check() is the one live Keto "may I?" call
    csrf.ts           CSRF for our own POST forms: signed double-submit token — issue/verify, cookie, request gate
    denylist.ts       Optional instant-revoke denylist: in-memory, auto-evicting; hot path rejects a revoked subject's pre-revoke tokens (REVOCATION_DENYLIST)
    flow-view.ts      buildFlowView(): Kratos self-service Flow → themed view model (fields, hidden csrf, buttons, tone-mapped messages) for views/auth.ejs
    oauth-login.ts    resolveLoginChallenge(): authenticate a Hydra login challenge via the Kratos session → accept, or bounce to /login
    oauth-consent.ts  resolveConsentChallenge()/acceptConsent()/rejectConsent(): auto-accept first-party, else show the consent screen → grant scopes
    routes.ts         buildAuthRoutes(): the built-in auth/OAuth2 endpoints as named handlers on the internal route table — themed flow pages, /oauth2/* challenges, /auth/complete, POST /logout, /error; only what the wired clients support is registered
    bootstrap.ts      One-command bootstrap: idempotent first-boot seed — JWKS-if-absent, demo admin in Kratos, admin permission in Keto
    kratos-public.ts  createKratosPublic(): Kratos public-API fetch client — self-service flow init/get/submit, browser logout, whoami, session→JWT tokenize
    kratos-admin.ts   createKratosAdmin(): Kratos admin-API fetch client — identity CRUD + surgical metadata_public update (login permission projection)
    keto-client.ts    createKetoClient(): Keto fetch client — check / list / expand relations (read API) + write / delete tuples (write API)
    hydra-admin.ts    createHydraAdmin(): Hydra admin-API fetch client — OAuth2 login + consent challenge get/accept/reject + OAuth2 client CRUD
    fetch-timeout.ts  withTimeout(): bound every outbound Ory call — wrap the injected fetch so each request aborts after a deadline unless the caller passed its own signal; server.ts wires it into the Kratos/Keto/Hydra clients

  i18n/               Translation: which language a request gets, and the words for it
    catalog.ts        Catalog/Message types + checkCatalog(): the boot-time parity rules a locale is held to (keys, kinds, plural categories)
    locale.ts         resolveLocale()/matchLocale()/parseAcceptLanguage() (?locale → Accept-Language → en-US) + localeHref(), textDirection(), localeLabel()
    translate.ts      createTranslator(): key + vars → text — the catalog chain, {{var}} interpolation, Intl.PluralRules selection; an unknown key renders as itself
    load.ts           loadI18n(): import src/i18n/locales/*.ts + plugins/<id>/i18n/*.ts and check every catalog against its en-US baseline — one boot-stopping error listing every problem
    runtime.ts        createI18n(): the loaded catalogs per request — resolve the locale, hand out a memoised translator per locale+plugin
    english.ts        The shipped en-US catalog as a ready translator + I18n, for paths the loaded catalogs aren't wired into (tests, ad-hoc contexts)
    view-locals.ts    i18nLocals(): the t/locale/dir/localeSwitch block merged into every render (EJS passes it down into includes)
    locales/          The core catalogs — en-US.ts (the baseline + its type) and sv-SE.ts

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
    nav.ts            composeNav(): merge plugin nav fragments + central override, permission-filter → nav-tree model
    menu-config.ts    loadMenuConfig()/defineMenu(): read config/menu.ts (central override + branding, imported as `#menu-config`), validated at boot
    icons.ts          Used-icon registry + sprite builder from lucide-static (regenerates partials/icons.ejs)
    list-query.ts     parseListQuery(): read a list URL → { q, filters, sort, page, pageSize }
    paginate.ts       paginate(total,page,pageSize): page model (counts, row window, ellipsis sequence) for pagination.ejs

views/               Core EJS templates, all in the one app shell: home (public "/" landing), index (instructional /dashboard), auth (themed Kratos flows), oauth-consent (OAuth2 consent), error (flow-error sink → /error), 403/404/500/503 (503 = Ory-unreachable on sign-in), partials/ (shell, nav tree, filter bar, data table, pagination, field, auth card, alert, landing/flow/consent bodies, menu/popover, theme switch, language picker, icon sprite). Domain screens live in plugins, not here — the admin plugin ships its own views/ (incl. its Users/Groups/Clients + permission-picker + confirm bodies)
public/              Static assets under /public/ (css/styles.css + auth.css, favicon, robots.txt)
config/              Drop-in mount point for the central menu override + branding (config/menu.ts). Ships empty (.gitkeep, git-ignored otherwise) — mount your own or copy the template from examples/config/; defaults apply when absent
locales/             Drop-in mount point for extra (or replacement) language catalogs — a <locale>.ts here adds a language for the core, or replaces the shipped catalog for that tag wholesale; plugins/<id>/<locale>.ts does the same for an installed plugin. Ships empty (.gitkeep, git-ignored otherwise); see Languages
ory/                 Ory service config (kratos/: identity schema, kratos.yml, oidc/ SSO claims mapper, tokenizer/ session→JWT claims mapper + dev signing JWKS; keto/: keto.yml + namespaces.keto.ts OPL — permission/group/resource; hydra/hydra.yml: OAuth2 issuer + login/consent URLs → /oauth2/*) + storage init (postgres/init/init.sql: one DB per service)
plugins/             Drop-in plugin folders (scanned at /app/plugins; bind-mount or bake in). Ships empty (.gitkeep, git-ignored otherwise) — mount your own; the E2E suites bind-mount the example plugins onto /app/plugins/scheduling and /app/plugins/admin
examples/            Copy-in reference material, mirroring the mount dirs: plugins/scheduling/ (the reference plugin — list/form over an upstream + permission-gated nav), plugins/admin/ (the system-admin plugin — Users/Groups/OAuth2-clients over Ory via ctx.system, permissions granted from the host's declared catalog), both copied into plugins/; and config/menu.ts (the menu/branding template copied into config/); shifts-upstream/ is the dev mock backend the scheduling plugin reads/writes (stand-in for your real service)
e2e-tests/           Playwright E2E: visual.spec (design system, Ory-free) + auth-refresh.spec (token timeout/re-mint) + oauth-login.spec (OAuth2 login + consent) + full-flow.spec (browser UI: password/SSO login, menu-by-permission, admin CRUD, plugin page, logout) + devstack-login.spec (regression: login works from the banner's localhost URL and 127.0.0.1 is canonicalised, on the plain `docker compose up` topology); proxy.ts (same-origin gateway) + mock-oidc.ts (mock SSO provider) back full-flow. e2e-tests/Dockerfile + e2e-tests/compose.{visual,auth,oauth,full,devstack}.yml run them
ci.sh                The full CI gate: typecheck → unit tests → every E2E suite, each on a fresh, always-torn-down stack (`bash ci.sh`)
.gitea/workflows/    Gitea Actions: ci.yml — the full gate (ci.sh) on every branch push except main;
                     mirror.yml — force-sync main + tags to the GitHub mirror; see CI/CD
README-dockerhub.md  The Docker Hub repository description (docker.io/larvit/plainpages) — pasted into the Docker Hub overview by hand when it changes; see CI/CD
```

## Extending the core

- **New page in a plugin:** add a route + handler to the plugin manifest and a template in
  its `views/`.
- **Static asset:** drop it in the plugin's `public/`; served at `/public/<plugin>/<path>`.
- **New dependency:** deps live in the image, so update the manifest + lockfile and rebuild —
  `--package-lock-only` writes nothing into the checkout, `--user` keeps the two files yours.
  Keep deps minimal — prefer the Node standard library, and an Ory REST call over an SDK.

  ```bash
  docker compose run --rm --no-deps --user "$(id -u):$(id -g)" web npm install --package-lock-only <pkg>
  docker compose build
  ```

All versions are pinned to **exact, human-readable semantic versions** (no ranges, no
digests): npm deps via `.npmrc` (`save-exact=true`) + the committed lockfile (`npm ci`), and
container images by tag in the `Dockerfile` / compose files (e.g. `node:24.16.0-alpine3.24`,
pinned Ory and Postgres tags).

A plugin's `apiVersion` follows the same pin-it-by-hand spirit: write a **literal** semver — the
host version the plugin was built against — and bump it by hand on rebuild. Never set it from the
host's `HOST_API_VERSION` constant: that would make the plugin always equal the host, so the
compatibility check ([Contract versioning](#contract-versioning)) could never fire and a breaking
change would slip through silently.
