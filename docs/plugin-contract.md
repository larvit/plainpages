# The Plainpages plugin contract

The authoritative reference for the plugin API — the product's main surface. A plugin is a
self-contained folder under `plugins/` that the host discovers at boot; there is no
registration step. The contract is **TypeScript** (`src/plugin.ts`), so the types here are the
single source of truth — this document explains them, the guarantees around them, and the rules
the host enforces.

**Design stance.** The audience is experienced developers. The API optimises for being
**powerful, predictable, and overloadable** — a plugin can take over as much of a page as it
wants. The host **fails loud at boot/discovery** rather than sandboxing at runtime: a malformed
manifest, a version mismatch, or a conflict stops startup with a clear message. Runtime
crash-isolation (one bad plugin can't take the host down) is a *non-goal* — diagnose at deploy
time, not in production.

> **Status.** This is the contract the §2 host implements. The types and pure rules
> (`checkApiVersion`, `findConflicts`, `isValidPluginId`) live in `src/plugin.ts`; **discovery**
> (`src/discovery.ts`), the **router** (`src/router.ts` — method+path match, `:name` params,
> permission gate, `RouteResult` → response), and the **per-plugin view resolver**
> (`src/view-resolver.ts` — a `view` result renders `plugins/<id>/views/`, with the core partials
> reachable via `include()`), **per-plugin static serving** (`/public/<id>/` → the plugin's
> `public/`, `routePublic` in `src/static.ts`), and the **central menu override + branding**
> (`config/menu.ts`, loaded by `src/menu-config.ts`, with branding — name, logo, default theme —
> rendered in the app shell) are wired. The §2 plugin host is feature-complete; the remaining §2
> items are a project-wide review and comment/test cleanup.

## Anatomy of a plugin

```
plugins/scheduling/      # folder name = the plugin id → mounted at /scheduling
  plugin.ts              # default export: the manifest (definePlugin(...))
  shifts.ts              # handlers, helpers — plain modules
  views/                 # EJS templates for this plugin's pages
    shifts.ejs
  public/                # static assets, served at /public/scheduling/
    scheduling.css
```

**Identity comes from the folder.** The folder name *is* the plugin `id`, and the mount path is
`/<id>` — neither is written in the manifest, so they can't drift or be claimed twice. The id
must be **URL/path-safe** (`isValidPluginId`: lowercase `a–z`, digits, and dashes — dashes
anywhere; no uppercase, underscores, dots, or slashes); the host rejects a malformed folder name
at discovery. The id also namespaces the plugin's `views/`, its `/public/<id>/` assets, and (by
convention) its nav/permission tokens.

Installing a plugin is "drop the folder, restart." Removing one is "delete the folder, restart."
Nothing else references it; the operator stays in control through the central menu override
(`config/menu.ts`).

## The manifest

```ts
import { definePlugin } from "../../src/plugin.ts";
import { listShifts, createShift } from "./shifts.ts";

export default definePlugin({
  apiVersion: "1.0.0",                // semver of the host contract this was built against (a literal — see Versioning)

  // Nav fragment, merged into the global menu and permission-filtered per user.
  // `icon` is a Lucide icon by its sprite id (src/icons.ts).
  nav: [{
    icon: "i-cal", id: "scheduling:root", label: "Scheduling",
    children: [{ href: "/scheduling/shifts", id: "scheduling:shifts", label: "Shifts", permission: "scheduling:read" }],
  }],

  // Permission tokens this plugin introduces (for docs + Keto seeding). Optional.
  permissions: [
    { token: "scheduling:read", description: "View shifts" },
    { token: "scheduling:write", description: "Create and edit shifts" },
  ],

  // Route handlers, mounted under the plugin's path (/scheduling). `permission` gates first.
  routes: [
    { method: "GET",  path: "/shifts", permission: "scheduling:read",  handler: listShifts },
    { method: "POST", path: "/shifts", permission: "scheduling:write", handler: createShift },
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
| `apiVersion` | yes | Semver the plugin was built against — a **literal**, not `HOST_API_VERSION`. See [Versioning](#contract-versioning). |
| `nav` | no | `NavNode[]` fragment (same shape `composeNav` consumes). `icon` is a Lucide sprite id (`src/icons.ts`); node `id`s must be globally unique. |
| `permissions` | no | Tokens this plugin introduces; declared for documentation and seeding. |
| `routes` | no | See [Routes & handlers](#routes--handlers). |
| `hooks` | no | See [Hooks](#hooks). |

A plugin may be routes-only, nav-only, or hooks-only — every collection field is optional.

## Routes & handlers

A route is `{ method, path, permission?, handler }`. `path` is **relative to the plugin's mount
path `/<id>`** (so `/shifts` in the `scheduling` plugin serves `/scheduling/shifts`); the host
matches `method` + the resolved full path, extracts `:name` segments into `ctx.params.name`,
runs the `permission` gate (a coarse JWT-claim check — see the README), and only then calls the
handler with the [request context](#requestcontext).

`method` is one of `GET HEAD POST PUT PATCH DELETE`. A `GET` route also answers `HEAD`.

A handler returns a **`RouteResult`** (or a `Promise` of one); the host turns it into the HTTP
response. Returning `void` is the escape hatch — the handler wrote to `ctx.res` itself.

```ts
type RouteResult =
  | { view: string; data?: Record<string, unknown>; status?: number; headers?: Record<string, string> }
  | { html: string;  status?: number; headers?: Record<string, string> }
  | { json: unknown;  status?: number; headers?: Record<string, string> }  // opt-in JS enhancement
  | { redirect: string; status?: number };                                  // 303 unless status set
```

```ts
// shifts.ts
import type { RequestContext } from "../../src/context.ts";
import { parseListQuery } from "../../src/list-query.ts";

export async function listShifts(ctx: RequestContext) {
  const q = parseListQuery(ctx.url);
  const rows = await fetch(`${upstream}/shifts?${ctx.url.searchParams}`).then((r) => r.json());
  return { view: "shifts", data: { rows, q } }; // renders plugins/scheduling/views/shifts.ejs
}
```

- **`view`** resolves against the plugin's own `views/` (`src/view-resolver.ts`) — nested names
  like `"shifts/edit"` work, and an out-of-bounds name is refused. The template may `include()`
  the core building-block partials (app shell, nav tree, data table, …) and its own
  partials/subfolders to render a full page — exactly as the built-in screens do.
- The handler **fetches its own data** from upstream and renders it; plugins hold no state
  (see the README's *Stateless* section). The partials only need rows.
- `default` status: `200` for `view`/`html`/`json`, `303` for `redirect`.

## RequestContext

Every handler receives one argument, the `RequestContext` (`src/context.ts`), built once per
request:

```ts
interface RequestContext {
  params: Record<string, string>;   // path params from the route match, e.g. /shifts/:id → { id }
  query: URLSearchParams;            // alias of url.searchParams
  req: IncomingMessage;
  res: ServerResponse;
  roles: string[];                   // user?.roles ?? [] — coarse gate without a null-check
  url: URL;
  user: User | null;                 // { id, email, roles } from the verified session JWT, or null
}
```

**Stability guarantee.** The fields above are the stable contract — present and non-breaking
across a major `apiVersion`. New fields may be **added** within a major version (additive, never
breaking). `req`/`res` are the raw Node objects and the full escape hatch; reading them is fine,
but prefer the typed fields so a handler keeps working as the host evolves. `user`/`roles` come
from the §4 JWT middleware and are `null`/`[]` until a session exists.

## Nav & permissions

A plugin's `nav` fragment is merged into the global menu by `composeNav` (`src/nav.ts`), which
applies the central override and then **filters per user** by the roles in the session JWT — a
node shows iff it declares no `permission` or the user's roles include that token. Use arbitrary
depth, counts, and icons; see `composeNav` for the node shape. A node's `icon` is a **Lucide
icon**, referenced by its sprite id (e.g. `i-cal` → lucide `calendar`); the available ids are
`ICON_NAMES` in `src/icons.ts`, and adding one means registering its lucide name there.

Permission tokens are a **shared global namespace** — that's deliberate, so an operator grants
`scheduling:read` once in Keto and every plugin referencing it is gated consistently. Namespace
your tokens as `<id>:<action>` to avoid accidental clashes. Declaring them in `permissions` is
optional but recommended (it documents them and lets the bootstrap seed Keto, §3).

## Contract versioning

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

**Write a literal, never `HOST_API_VERSION`.** `apiVersion` records the version the plugin was
*built against*. Importing the host's current constant would make every plugin always equal the
host — the check could never fire, and a future breaking change would slip through silently.

## Conflict rules

Plugins are independent folders, so the host detects collisions across all discovered plugins
with `findConflicts` and resolves them **loudly — never last-write-wins**. `error` aborts boot;
`warn` logs and continues.

| Kind | Level | Rule |
| --- | --- | --- |
| `id` | error | Two plugins share an `id` (folder name). Ids must be globally unique — they namespace the mount path, views/static, and the override target. |
| `route` | error | Two routes resolve to the same `method` + full path. Cross-plugin routes can't collide (the `/<id>` prefix is unique), so this catches a plugin duplicating one of its own. |
| `nav-id` | error | A nav node `id` is used more than once — the central override targets ids, so they must be unique. |
| `permission` | warn | A permission token is declared by more than one plugin. Sharing is legitimate (shared role); namespace as `<id>:<action>` if unintended. |

There is **no separate `basePath` rule**: the mount path is the derived `/<id>`, so its
uniqueness follows from the id check. `permission` is the one intentional overlap, so it warns
rather than aborts; everything else is an error an author fixes before the host will start.

## Hooks

Optional, for reacting to system actions. A plugin's `hooks` may implement:

| Hook | When | May |
| --- | --- | --- |
| `onBoot()` | after discovery, before the server listens | warm caches, validate upstream config |
| `onRequest(ctx)` | before route matching | inspect, or **short-circuit** by returning a `RouteResult` |
| `onResponse(ctx, result)` | after the handler | observe/log; cannot change the response |

Hooks run with no sandbox — a throwing hook fails loud (boot for `onBoot`, the request for the
others). Keep them cheap; `onRequest` is on the hot path. This surface is intentionally small and
may grow additively within the major version.

## Local dev & test story

A plugin is a normal folder of TypeScript, so an author tests it the same way the core is tested
— everything in Docker, no host tooling.

1. **Unit-test handlers as pure functions.** Keep a handler thin: parse `ctx`, fetch upstream,
   return a `RouteResult`. Test the data-shaping in isolation (mock `fetch`/upstream) with
   `node --test`, exactly like `src/dashboard.test.ts` tests the dashboard model. No host needed.

   ```bash
   docker compose run --rm web npm test
   ```

2. **Run one plugin against the host.** Get the folder into the container's `/app/plugins/<id>`
   — either in your clone (the dev compose bind-mounts the tree) or by bind-mounting an external
   folder (README → *Where plugins live*) — and `docker compose up`; the host discovers it. For
   an isolated harness, the §2 host exposes plugin injection (`createApp({ plugins: [myPlugin] })`)
   so a test can mount a single manifest and assert its routes, nav, and gating without the rest
   of the stack.

3. **E2E the user-facing flow.** Per AGENTS.md §6, every plugin page/form ships *with* a
   Playwright test in `e2e/`, side-effect-free so the suite stays `fullyParallel`. The test runs
   against the live `web` service with the plugin mounted.

The validation an author hits is the same the host runs: bad `apiVersion` or a conflict
([above](#conflict-rules)) stops boot with a precise message naming the plugin(s) involved.
