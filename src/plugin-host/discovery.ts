// Plugin discovery: scan plugins/, import each folder's plugin.ts default export,
// validate it, assemble the loaded Plugin[]. The imperative shell over plugin.ts's pure rules
// (isValidPluginId, checkApiVersion, findConflicts). Fails loud: every per-plugin problem and
// error-level conflict is collected into one boot-stopping Error; warn-level diagnostics
// (older-minor apiVersion, shared permission name) log and load continues. Folder name = id.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkApiVersion, findConflicts, isValidPermissionName, isValidPluginId, RESERVED_PLUGIN_IDS, type Plugin, type PluginManifest } from "./plugin.ts";
import { isValidStoragePluginId, MAX_STORAGE_PLUGIN_ID_LENGTH } from "./storage.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Default scan root — <repo>/plugins, i.e. the /app/plugins the container mounts (README).
export const PLUGINS_DIR = join(rootDir, "plugins");

export interface DiscoverOptions {
  dir?: string;
  logger?: Pick<Console, "warn">; // warn-level diagnostics; defaults to console
}

export async function discoverPlugins(options: DiscoverOptions = {}): Promise<Plugin[]> {
  const dir = options.dir ?? PLUGINS_DIR;
  const logger = options.logger ?? console;
  if (!existsSync(dir)) return []; // a clean clone has no plugins/ yet — zero plugins is valid

  const errors: string[] = [];
  const plugins: Plugin[] = [];

  // `npm install --prefix plugins` instead of `--prefix plugins/<id>`: the package.json becomes the
  // scope for every plugin below it, and the node_modules outranks the host's own — barrel included.
  for (const stray of ["node_modules", "package.json"]) {
    if (existsSync(join(dir, stray))) {
      errors.push(`plugins/${stray} must not exist — it sits above every plugin and shadows the host's own; delete plugins/{node_modules,package.json,package-lock.json} and install into plugins/<id>`);
    }
  }

  for (const id of pluginFolders(dir)) {
    const fail = (msg: string): void => void errors.push(`plugins/${id}: ${msg}`);

    if (!isValidPluginId(id)) {
      errors.push(`"${id}" is not a valid plugin folder name (lowercase a–z, digits, dashes)`);
      continue;
    }
    if (RESERVED_PLUGIN_IDS.has(id)) { fail(`"${id}" is a reserved id — it would shadow a built-in host route`); continue; }
    const file = join(dir, id, "plugin.ts");
    if (!existsSync(file)) { fail("no plugin.ts found"); continue; }
    const packaging = packagingError(join(dir, id));
    if (packaging) { fail(packaging); continue; }

    let mod: { default?: unknown };
    try {
      mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
    } catch (err) {
      fail(`failed to import plugin.ts — ${messageOf(err)}`);
      continue;
    }

    const manifest = asManifest(mod.default);
    if (!manifest) { fail("plugin.ts must default-export a manifest object"); continue; }

    const version = checkApiVersion(manifest.apiVersion);
    if (version.level === "refuse") { fail(version.message); continue; }
    if (version.level === "warn") logger.warn(`[plugins] ${id}: ${version.message}`);

    const shape = shapeError(manifest);
    if (shape) { fail(shape); continue; }

    // The folder name becomes a Postgres identifier, which truncates past 63 bytes — two long ids
    // would then share one database. Only checked for a plugin that asked for storage.
    if (manifest.storage === true && !isValidStoragePluginId(id)) {
      fail(`declares storage, so its folder name must be at most ${MAX_STORAGE_PLUGIN_ID_LENGTH} characters`);
      continue;
    }

    plugins.push({ ...manifest, id }); // identity is the folder, not the manifest
  }

  for (const conflict of findConflicts(plugins)) {
    if (conflict.level === "error") errors.push(conflict.message);
    else logger.warn(`[plugins] ${conflict.message}`);
  }

  if (errors.length) {
    // `plugins/` is a drop-in mount the operator owns, so the reader of this message often didn't
    // write the manifest — they copied it. Tightening a contract rule breaks those copies at boot,
    // and the rule alone doesn't tell them the remedy is one command.
    throw new Error(
      `Plugin discovery failed:\n${errors.map((e) => `  - ${e}`).join("\n")}\n` +
      `A plugin under plugins/ is your own copy. If it came from examples/, re-copy it — ` +
      `the host contract may have changed since (see README → Upgrading).`,
    );
  }
  return plugins;
}

// Sorted for deterministic load order + stable conflict messages. A symlink counts as a folder, and
// one whose target the container cannot see trips "no plugin.ts found" rather than vanishing.
function pluginFolders(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => e.name)
    .sort();
}

// A barrel copy resolves before the host's, so its GuardError matches no `instanceof` here and a
// sign-in redirect becomes a 500.
function packagingError(folder: string): string | null {
  if (existsSync(join(folder, "node_modules", "@plainpages", "plugin-api"))) {
    return "ships its own copy of @plainpages/plugin-api — remove it; the host provides the one instance";
  }

  const file = join(folder, "package.json");
  if (!existsSync(file)) return null;

  let manifest: { type?: unknown } | null;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8")) as { type?: unknown } | null;
  } catch (err) {
    return `package.json could not be read as JSON — ${messageOf(err)}`;
  }
  return manifest?.type === "module"
    ? null
    : `package.json must set "type": "module" — npm writes no type, and Node then re-parses every file in the folder`;
}

function asManifest(value: unknown): PluginManifest | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as PluginManifest) : null;
}

// The collection fields feed findConflicts, which iterates them — a non-array crashes it opaquely.
function shapeError(manifest: PluginManifest): string | null {
  for (const field of ["nav", "permissions", "routes"] as const) {
    if (manifest[field] !== undefined && !Array.isArray(manifest[field])) return `"${field}" must be an array`;
  }
  // `home` / `dashboard` (the landing-page overrides) are route handlers; the host calls them, so
  // a non-function fails loud.
  for (const slot of ["home", "dashboard"] as const) {
    if (manifest[slot] !== undefined && typeof manifest[slot] !== "function") return `"${slot}" must be a function (a route handler)`;
  }
  // A truthy non-boolean (a DSN, say) must not quietly read as "provision me one".
  if (manifest.storage !== undefined && typeof manifest.storage !== "boolean") return `"storage" must be a boolean`;
  // `public` and `permission` are contradictory on the same route/nav node — "open to all" vs
  // "needs this permission". Refuse rather than silently pick one, so the author's intent is unambiguous.
  for (const route of Array.isArray(manifest.routes) ? manifest.routes : []) {
    if (route?.public === true && route.permission != null) return `route "${route.method} ${route.path}" sets both public and permission — they are mutually exclusive`;
  }
  const navContradiction = findPublicNavContradiction(manifest.nav);
  if (navContradiction) return navContradiction;
  // Every permission name the manifest mentions — gated on or declared — must be `<resource>:<action>`.
  // A bare word names a role, and roles are groups here (README → Naming a permission).
  for (const route of Array.isArray(manifest.routes) ? manifest.routes : []) {
    if (route?.permission != null && !isValidPermissionName(route.permission)) {
      return `route "${route.method} ${route.path}" gates on "${route.permission}"; a permission name is <resource>:<action>, e.g. "things:read"`;
    }
  }
  for (const decl of Array.isArray(manifest.permissions) ? manifest.permissions : []) {
    if (decl?.name == null || !isValidPermissionName(decl.name)) {
      return `declared permission "${decl?.name}" is not <resource>:<action>, e.g. "things:read"`;
    }
  }
  const navPermission = findInvalidNavPermission(manifest.nav);
  if (navPermission) return navPermission;
  return null;
}

// Recurse the nav fragment: a node that is both `public` and `permission`-gated is contradictory.
function findPublicNavContradiction(nodes: PluginManifest["nav"]): string | null {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.public === true && node.permission != null) return `nav node "${node.label ?? node.id ?? "?"}" sets both public and permission — they are mutually exclusive`;
    const inChild = findPublicNavContradiction(node?.children);
    if (inChild) return inChild;
  }
  return null;
}

function findInvalidNavPermission(nodes: PluginManifest["nav"]): string | null {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.permission != null && !isValidPermissionName(node.permission)) {
      return `nav node "${node.label ?? node.id ?? "?"}" gates on "${node.permission}"; a permission name is <resource>:<action>, e.g. "things:read"`;
    }
    const inChild = findInvalidNavPermission(node?.children);
    if (inChild) return inChild;
  }
  return null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
