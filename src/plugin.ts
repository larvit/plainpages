// The plugin contract (todo §2) — the product's main API surface. This module is the
// authoritative, machine-readable shape; `docs/plugin-contract.md` is the prose reference.
// It only declares types + pure rules; the §2 discovery/router wire them to the filesystem
// and HTTP. Philosophy: a powerful, predictable, overload-friendly API that fails loud at
// boot/discovery rather than sandboxing at runtime.
//
// A plugin's identity comes from its folder under plugins/: the folder name is the `id`
// (validated by isValidPluginId) and the mount path is `/<id>`. Neither is written in the
// manifest — the host derives them at discovery, so they can't drift or be claimed twice.

import type { RequestContext } from "./context.ts";
import type { NavNode } from "./nav.ts";

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
  hooks?: PluginHooks;
  nav?: NavNode[]; // fragment merged into the menu (composeNav); node `icon` is a Lucide sprite id (src/icons.ts), node ids must be globally unique
  permissions?: PermissionDecl[];
  routes?: Route[];
}

// A discovered plugin: the manifest plus the `id` the host read from the folder name. Mounted
// at `/<id>`, with views/static namespaced under the id.
export interface Plugin extends PluginManifest {
  id: string;
}

// Identity helper: types the manifest, returns it unchanged. Validation happens at discovery
// (§2), so a plugin may equally be a plain typed object. Mirrors Vite's `defineConfig`.
export function definePlugin(manifest: PluginManifest): PluginManifest {
  return manifest;
}

// A plugin id (its folder name) — lowercase letters in dash-separated segments: no digits,
// uppercase, or leading/trailing/double dashes. Tight on purpose: the id forms the mount path
// `/<id>`, the view/static namespace, and the central-override target.
const PLUGIN_ID = /^[a-z]+(?:-[a-z]+)*$/;

export function isValidPluginId(id: string): boolean {
  return PLUGIN_ID.test(id);
}

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

// The versioning rule (provider/consumer semver): the host provides a contract version, the
// plugin pins the one it targets. Different major → refuse (breaking either way). Same major,
// plugin minor > host → refuse (needs a newer host). Same major, plugin minor < host → warn
// (additive, still runs — nudge to update). Equal major/minor (patch ignored) → ok. Malformed →
// refuse. Discovery maps refuse→throw, warn→log.
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
  kind: "id" | "nav-id" | "permission" | "route";
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

// A route's full path = the plugin's mount path `/<id>` + the route path.
function fullPath(id: string, path: string): string {
  return `/${id}${path.startsWith("/") ? path : `/${path}`}`;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}
