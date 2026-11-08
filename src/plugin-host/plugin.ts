// The plugin contract — the product's main API surface: the machine-readable types + pure rules.
// README → Building plugins is the prose reference; discovery/router wire this to FS + HTTP.
//
// A plugin's identity is its folder under plugins/: folder name = `id` (isValidPluginId), mount =
// `/<id>`. Neither is in the manifest — the host derives them, so they can't drift or be claimed twice.

import type { Gate } from "../auth/gate.ts";
import type { RequestContext } from "../http/context.ts";
import type { ProfileMenuEntry } from "../ui/chrome.ts";
import type { NavNode } from "../ui/nav.ts";
import type { SettingDecl, SettingsOf } from "./settings.ts";
import type { StorageCredentials } from "./storage.ts";

// The Plainpages release this contract ships in — see README → Contract versioning.
export const HOST_API_VERSION = "0.5.0";

export type HttpMethod = "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT";

// A handler's return value; the host turns it into the HTTP response. Returning void is the
// escape hatch — the handler wrote to `ctx.res` itself (streaming, custom headers, etc.).
export type RouteResult =
  | { headers?: Record<string, string>; html: string; status?: number }
  | { headers?: Record<string, string>; json: unknown; status?: number } // for opt-in JS enhancement
  | { data?: Record<string, unknown>; headers?: Record<string, string>; status?: number; view: string }
  | { redirect: string; status?: number };

export type RouteHandler = (ctx: RequestContext) => Promise<RouteResult | void> | RouteResult | void;

export interface Route extends Gate {
  handler: RouteHandler;
  method: HttpMethod;
  path: string; // relative to the plugin's mount path `/<id>`; ":name" segments → ctx.params.name
}

// A Keto Permission this plugin gates on — declared for docs/seeding. Names are a shared global
// namespace, so an operator grants them once in Keto. See README → Users, groups & permissions.
export interface PermissionDecl {
  description?: string;
  name: string;
}

// `<resource>:<action>`. The 64-char cap keeps a name usable as a Keto object and a URL path
// segment. Enforced at discovery like every other manifest rule, so the convention holds for
// plugins the admin GUI never touches.
const PERMISSION_NAME = /^[a-z0-9][a-z0-9_-]*:[a-z0-9][a-z0-9_-]*$/;

export function isValidPermissionName(name: string): boolean {
  return name.length <= 64 && PERMISSION_NAME.test(name);
}

// Every permission the installed plugins declare, deduped by name and sorted — the fixed list the
// admin screens offer when granting. Permissions are authored in code, never invented in the GUI, so
// this *is* the catalog; a name in Keto that no plugin declares is not offered.
// First declaration of a name wins its description (shared names are legitimate, findConflicts warns).
export function declaredPermissions(plugins: Plugin[]): PermissionDecl[] {
  const byName = new Map<string, PermissionDecl>();
  for (const plugin of plugins) {
    for (const decl of plugin.permissions ?? []) if (!byName.has(decl.name)) byName.set(decl.name, decl);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// What onBoot receives. A hook declaring no parameter stays valid, so this may grow additively.
export type BootContext<S extends readonly SettingDecl[] = readonly SettingDecl[]> = {
  storage?: StorageCredentials; // this plugin's own database; present iff the manifest declared `storage`
} & SettingsSlot<S>;

// Required once the manifest declares settings, so that plugin reads `settings.key` without a guard
// for the case it just ruled out; optional for a manifest that declared none.
type SettingsSlot<S extends readonly SettingDecl[]> = readonly [] extends S
  ? { settings?: SettingsOf<S> }
  : { settings: SettingsOf<S> };

// Optional hooks on system actions. Crash-isolation is a non-goal — a throwing hook fails loud.
export interface PluginHooks<S extends readonly SettingDecl[] = readonly SettingDecl[]> {
  onBoot?: (host: BootContext<S>) => Promise<void> | void; // after discovery, before the server listens
  onRequest?: (ctx: RequestContext) => Promise<RouteResult | void> | RouteResult | void; // may short-circuit
  onResponse?: (ctx: RequestContext, result: RouteResult | null) => Promise<void> | void;
}

// The authored manifest — a plugin's `plugin.ts` default-exports this. No `id`/mount path: the
// host derives them from the folder name at discovery (see Plugin).
export interface PluginManifest<S extends readonly SettingDecl[] = readonly SettingDecl[]> {
  apiVersion: string; // semver of the host contract this targets — write a literal, NOT HOST_API_VERSION (see docs)
  // Take over "/dashboard"; the host gates it to a signed-in session first. At most one plugin may
  // declare it (findConflicts → error, never last-write-wins).
  dashboard?: RouteHandler;
  // Take over the ungated public landing "/". At most one plugin may declare it.
  home?: RouteHandler;
  hooks?: PluginHooks<S>;
  nav?: NavNode[]; // fragment merged into the menu (composeNav); node `icon` is a Lucide sprite id (src/ui/icons.ts), node ids must be globally unique
  permissions?: PermissionDecl[];
  // Links above Sign out in the profile dropdown, each gated like a nav node; only a signed-in visitor sees any.
  profileMenu?: ProfileMenuEntry[];
  routes?: Route[];
  // Operator-supplied configuration, one PLUGIN_SETTING_<ID>_<KEY> variable per key; the resolved
  // values arrive on onBoot's BootContext, typed from these declarations (settings.ts).
  settings?: S;
  // Ask for a Postgres database of this plugin's own; its credentials arrive on onBoot's BootContext.
  // The host provisions and locks it down but owns no schema inside it, and never drops it.
  storage?: boolean;
}

// A discovered plugin: the manifest plus the `id` the host read from the folder name. Mounted
// at `/<id>`, with views/static namespaced under the id.
export interface Plugin extends PluginManifest {
  id: string;
}

// Types the manifest and returns it unchanged; validation happens at discovery, so a plugin may
// equally be a plain typed object.
// The `const` parameter captures the literal `settings`, so onBoot receives each key at its declared
// type instead of a union every plugin author would have to narrow with a cast.
export function definePlugin<const S extends readonly SettingDecl[]>(manifest: PluginManifest<S>): PluginManifest<S> {
  return manifest;
}

// The id forms the mount path `/<id>`, the view/static namespace and the central-override target,
// so it must stay URL/path-safe: no uppercase, underscores, dots, slashes or spaces.
const PLUGIN_ID = /^[a-z0-9-]+$/;

export function isValidPluginId(id: string): boolean {
  return PLUGIN_ID.test(id);
}

// Plugin routes resolve before the built-ins, so a folder named one of these would silently shadow
// one — discovery refuses it. "/" is owned by the `home` field, not a route, so it needs no
// reservation; `admin` is deliberately absent, the admin screens being a drop-in plugin.
export const RESERVED_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "auth", "dashboard", "error", "login", "logout", "oauth2", "public", "recovery", "registration", "settings", "verification",
]);

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

// The official semver.org 2.0.0 core regex. Only major/minor drive compatibility, so the
// prerelease/build groups are matched to accept valid input but otherwise ignored.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

// Rejects ranges/prefixes (`^1.2.3`, `v1`), leading zeros and missing parts — fail loud over coerce.
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

// Provider/consumer semver check (full table in README → Contract versioning). Discovery maps
// refuse→throw, warn→log.
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
    // Pre-1.0 the major is pinned at 0, so a minor is the only slot a breaking change can use.
    if (host.major === 0) {
      return { level: "refuse", message: `plugin targets apiVersion ${pluginVersion}; host is ${hostVersion} — pre-1.0 a minor is a contract break, rebuild against ${hostVersion}` };
    }
    return { level: "warn", message: `plugin targets apiVersion ${pluginVersion}; host is ${hostVersion} — built against an older release` };
  }
  return { level: "ok", message: `apiVersion ${pluginVersion}` };
}

// A route's full path = the plugin's mount path `/<id>` + the route path. The single source of
// truth for both conflict detection and the router, so they can't disagree.
export function fullPath(id: string, path: string): string {
  return `/${id}${path.startsWith("/") ? path : `/${path}`}`;
}
