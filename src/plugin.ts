// The plugin contract (todo §2) — the product's main API surface. This module is the
// authoritative, machine-readable shape; `docs/plugin-contract.md` is the prose reference.
// It only declares types + pure rules; the §2 discovery/router wire them to the filesystem
// and HTTP. Philosophy: a powerful, predictable, overload-friendly API that fails loud at
// boot/discovery rather than sandboxing at runtime.

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
  path: string; // relative to basePath; ":name" segments become ctx.params.name
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

export interface Plugin {
  apiVersion: string; // semver of the host contract this plugin targets (e.g. HOST_API_VERSION)
  basePath: string; // unique mount prefix, e.g. "/scheduling"; must not overlap another plugin's
  hooks?: PluginHooks;
  id: string; // globally unique; namespaces views, /public/<id>/, and nav/permission tokens
  nav?: NavNode[]; // fragment merged into the global menu (composeNav); ids must be globally unique
  permissions?: PermissionDecl[];
  routes?: Route[];
}

// Identity helper: types the manifest, returns it unchanged. Validation happens at discovery
// (§2), so a plugin may equally be a plain typed object. Mirrors Vite's `defineConfig`.
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
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
  kind: "basePath" | "id" | "nav-id" | "permission" | "route";
  level: "error" | "warn";
  message: string;
  plugins: string[]; // unique ids involved
}

// The conflict rules: defined, loud resolution — never last-write-wins. Pure over the discovered
// manifests; discovery throws on any "error" and logs every "warn". Shared permission tokens are
// the one intentional overlap, so they warn rather than error.
export function findConflicts(plugins: Plugin[]): PluginConflict[] {
  const out: PluginConflict[] = [];

  const idCounts = new Map<string, number>();
  for (const plugin of plugins) idCounts.set(plugin.id, (idCounts.get(plugin.id) ?? 0) + 1);
  for (const [id, n] of idCounts) {
    if (n > 1) out.push({ kind: "id", level: "error", message: `${n} plugins share id "${id}"; ids must be globally unique`, plugins: [id] });
  }

  for (let i = 0; i < plugins.length; i++) {
    for (let j = i + 1; j < plugins.length; j++) {
      const a = plugins[i] as Plugin;
      const b = plugins[j] as Plugin;
      if (basePathOverlap(a.basePath, b.basePath)) {
        out.push({ kind: "basePath", level: "error", message: `basePath "${a.basePath}" (${a.id}) overlaps "${b.basePath}" (${b.id})`, plugins: uniq([a.id, b.id]) });
      }
    }
  }

  collect(plugins, (plugin, push) => {
    for (const route of plugin.routes ?? []) push(`${route.method} ${joinPath(plugin.basePath, route.path)}`);
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

const trimSlash = (s: string): string => s.replace(/\/+$/, "");

function basePathOverlap(a: string, b: string): boolean {
  const x = trimSlash(a);
  const y = trimSlash(b);
  return x === y || y.startsWith(`${x}/`) || x.startsWith(`${y}/`);
}

function joinPath(basePath: string, path: string): string {
  return `${trimSlash(basePath)}${path.startsWith("/") ? path : `/${path}`}`;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}
