// The plugin contract — the product's main API surface: the machine-readable types +
// pure rules; README.md (Building plugins) is the prose reference, discovery/router wire it to FS+HTTP.
// Powerful, predictable, fails loud at boot/discovery rather than sandboxing at runtime.
//
// A plugin's identity is its folder under plugins/: folder name = `id` (isValidPluginId), mount =
// `/<id>`. Neither is in the manifest — the host derives them, so they can't drift or be claimed twice.

import type { RequestContext } from "../http/context.ts";
import type { NavNode } from "../ui/nav.ts";

// Host contract version (semver). Bump major on a breaking manifest/handler change, minor on an
// additive one. A plugin pins the version it targets via `apiVersion`; the host applies
// provider/consumer semver semantics in checkApiVersion (refuse/warn on mismatch).
export const HOST_API_VERSION = "1.0.0";

export type HttpMethod = "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT";

// A handler's return value; the host turns it into the HTTP response. Returning void is the
// escape hatch — the handler wrote to `ctx.res` itself (streaming, custom headers, etc.).
export type RouteResult =
  | { headers?: Record<string, string>; html: string; status?: number }
  | { headers?: Record<string, string>; json: unknown; status?: number } // for opt-in JS enhancement
  | { data?: Record<string, unknown>; headers?: Record<string, string>; status?: number; view: string }
  | { redirect: string; status?: number };

export type RouteHandler = (ctx: RequestContext) => Promise<RouteResult | void> | RouteResult | void;

export interface Route {
  handler: RouteHandler;
  method: HttpMethod;
  path: string; // relative to the plugin's mount path `/<id>`; ":name" segments → ctx.params.name
  permission?: string; // coarse gate (a role token); checked before the handler runs
  // Mark the page reachable by anyone, signed in or not. The same as omitting `permission`
  // — a no-permission route is already open — but stated outright, so "public" is a deliberate
  // choice, not an accident. Mutually exclusive with `permission` (discovery refuses both).
  public?: boolean;
}

// A permission token this plugin introduces — declared for docs/seeding. Tokens are a shared
// global namespace (so an operator grants them in Keto); namespace as `<id>:<action>`.
export interface PermissionDecl {
  description?: string;
  token: string;
}

// Optional hooks on system actions. Crash-isolation is a non-goal — a throwing hook fails loud.
export interface PluginHooks {
  onBoot?: () => Promise<void> | void; // after discovery, before the server listens
  onRequest?: (ctx: RequestContext) => Promise<RouteResult | void> | RouteResult | void; // may short-circuit
  onResponse?: (ctx: RequestContext, result: RouteResult | null) => Promise<void> | void;
}

// The authored manifest — a plugin's `plugin.ts` default-exports this. No `id`/mount path: the
// host derives them from the folder name at discovery (see Plugin).
export interface PluginManifest {
  apiVersion: string; // semver of the host contract this targets — write a literal, NOT HOST_API_VERSION (see docs)
  // Take over the gated dashboard "/dashboard" — the post-login app home. A handler like any
  // route's; the host gates it to a signed-in session (anonymous → /login), then renders its own view
  // via ctx.chrome. At most one plugin may declare it (findConflicts → error, never last-write-wins).
  dashboard?: RouteHandler;
  // Take over the public landing "/" — the ungated front page. A handler like any route's,
  // anyone may reach it. At most one plugin may declare it (findConflicts → error).
  home?: RouteHandler;
  hooks?: PluginHooks;
  nav?: NavNode[]; // fragment merged into the menu (composeNav); node `icon` is a Lucide sprite id (src/ui/icons.ts), node ids must be globally unique
  permissions?: PermissionDecl[];
  routes?: Route[];
}

// A discovered plugin: the manifest plus the `id` the host read from the folder name. Mounted
// at `/<id>`, with views/static namespaced under the id.
export interface Plugin extends PluginManifest {
  id: string;
}

// Identity helper: types the manifest, returns it unchanged. Validation happens at discovery
//, so a plugin may equally be a plain typed object. Mirrors Vite's `defineConfig`.
export function definePlugin(manifest: PluginManifest): PluginManifest {
  return manifest;
}

// A plugin id (its folder name) — lowercase a–z, digits, and dashes, dashes allowed anywhere.
// Rejects uppercase, underscores, dots, slashes, spaces: the id forms the mount path `/<id>`,
// the view/static namespace, and the central-override target, so it must stay URL/path-safe.
const PLUGIN_ID = /^[a-z0-9-]+$/;

export function isValidPluginId(id: string): boolean {
  return PLUGIN_ID.test(id);
}

// Ids the host reserves for its own first-party mount segments (the gated /dashboard, the auth flows,
// /auth/complete, /logout, the /admin screens, the /oauth2 provider routes, the /public/ static).
// Plugin routes resolve before these, so a folder named one of them would silently shadow a
// built-in route — discovery refuses it, loud like any conflict. ("/" is owned by the `home` field,
// not a route, so it can't be shadowed and needs no reservation.)
export const RESERVED_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "admin", "auth", "dashboard", "login", "logout", "oauth2", "public", "recovery", "registration", "settings", "verification",
]);

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

// The official semver.org 2.0.0 core regex (major.minor.patch, optional prerelease/build) — a
// standardized parse with no dependency. We compare only major/minor for compatibility, so the
// prerelease/build groups are matched (to accept valid input) but otherwise ignored.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

// Parse a strict semver string → {major, minor, patch}, or null. Rejects ranges/prefixes
// (`^1.2.3`, `v1`), leading zeros, whitespace and missing parts — fail loud over coerce.
export function parseSemver(version: unknown): Semver | null {
  if (typeof version !== "string") return null;
  const m = SEMVER.exec(version);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export interface VersionCheck {
  level: "ok" | "refuse" | "warn";
  message: string;
}

// Provider/consumer semver check (full table in README.md → Contract versioning): same major+minor → ok,
// plugin minor < host → warn, else (newer minor, major mismatch, malformed) → refuse. Patch is
// ignored. Discovery maps refuse→throw, warn→log.
export function checkApiVersion(pluginVersion: unknown, hostVersion: string = HOST_API_VERSION): VersionCheck {
  const plugin = parseSemver(pluginVersion);
  const host = parseSemver(hostVersion);
  if (!host) throw new Error(`hostVersion is not a semver: ${JSON.stringify(hostVersion)}`); // invariant, not user input
  if (!plugin) {
    return { level: "refuse", message: `apiVersion must be a semver string (e.g. "${hostVersion}"); got ${JSON.stringify(pluginVersion)}` };
  }
  if (plugin.major !== host.major) {
    return { level: "refuse", message: `plugin targets apiVersion ${pluginVersion}; host is ${hostVersion} — incompatible major` };
  }
  if (plugin.minor > host.minor) {
    return { level: "refuse", message: `plugin targets apiVersion ${pluginVersion} but host is ${hostVersion}; upgrade the host` };
  }
  if (plugin.minor < host.minor) {
    return { level: "warn", message: `plugin targets apiVersion ${pluginVersion}; host is ${hostVersion} — newer features available` };
  }
  return { level: "ok", message: `apiVersion ${pluginVersion}` };
}

export interface PluginConflict {
  kind: "dashboard" | "home" | "id" | "nav-id" | "permission" | "route";
  level: "error" | "warn";
  message: string;
  plugins: string[]; // unique ids involved
}

// The conflict rules: defined, loud resolution — never last-write-wins. Pure over the discovered
// plugins; discovery throws on any "error" and logs every "warn". Mount-path (`/<id>`) uniqueness
// is structural — it follows from the id check, so it needs no rule of its own. Shared permission
// tokens are the one intentional overlap, so they warn rather than error.
export function findConflicts(plugins: Plugin[]): PluginConflict[] {
  const out: PluginConflict[] = [];

  const idCounts = new Map<string, number>();
  for (const plugin of plugins) idCounts.set(plugin.id, (idCounts.get(plugin.id) ?? 0) + 1);
  for (const [id, n] of idCounts) {
    if (n > 1) out.push({ kind: "id", level: "error", message: `${n} plugins share id "${id}"; ids must be globally unique`, plugins: [id] });
  }

  // The landing pages are single slots: "/" (home) and "/dashboard" (dashboard) take one owner
  // each — two plugins claiming either is a loud error, not a race.
  for (const slot of ["home", "dashboard"] as const) {
    const owners = plugins.filter((plugin) => plugin[slot]).map((plugin) => plugin.id);
    if (owners.length > 1) out.push({ kind: slot, level: "error", message: `${owners.length} plugins claim "${slot}" (${owners.join(", ")}); only one may own that page`, plugins: uniq(owners) });
  }

  collect(plugins, (plugin, push) => {
    for (const route of plugin.routes ?? []) push(`${route.method} ${fullPath(plugin.id, route.path)}`);
  }).forEach((owners, key) => {
    if (owners.length > 1) out.push({ kind: "route", level: "error", message: `${owners.length} routes resolve to "${key}"`, plugins: uniq(owners) });
  });

  collect(plugins, (plugin, push) => collectNavIds(plugin.nav, push)).forEach((owners, id) => {
    if (owners.length > 1) out.push({ kind: "nav-id", level: "error", message: `nav id "${id}" used ${owners.length}×; override targets ids, so they must be unique`, plugins: uniq(owners) });
  });

  collect(plugins, (plugin, push) => {
    for (const decl of plugin.permissions ?? []) push(decl.token);
  }).forEach((owners, token) => {
    if (owners.length > 1) out.push({ kind: "permission", level: "warn", message: `permission "${token}" declared by ${uniq(owners).length} plugins; namespace as "<id>:<action>" unless shared on purpose`, plugins: uniq(owners) });
  });

  return out;
}

// Map each emitted key → the plugin ids that emitted it (repeats kept, so within-plugin dups count).
function collect(plugins: Plugin[], emit: (plugin: Plugin, push: (key: string) => void) => void): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const plugin of plugins) emit(plugin, (key) => owners.set(key, [...(owners.get(key) ?? []), plugin.id]));
  return owners;
}

function collectNavIds(nodes: NavNode[] | undefined, push: (id: string) => void): void {
  for (const node of nodes ?? []) {
    if (node.id != null) push(node.id);
    collectNavIds(node.children, push);
  }
}

// A route's full path = the plugin's mount path `/<id>` + the route path. The single source of
// truth for both conflict detection (here) and the router, so they can't disagree.
export function fullPath(id: string, path: string): string {
  return `/${id}${path.startsWith("/") ? path : `/${path}`}`;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}
