// Plugin discovery (todo §2): scan plugins/, import each folder's plugin.ts default export,
// validate it, assemble the loaded Plugin[]. The imperative shell over the pure rules in
// plugin.ts (isValidPluginId, checkApiVersion, findConflicts). Fails loud: every per-plugin
// problem and every error-level conflict is collected and thrown as one boot-stopping Error;
// warn-level diagnostics (older-minor apiVersion, shared permission token) are logged, load
// continues. The folder name is the id; mount/router wiring is the next §2 item.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkApiVersion, findConflicts, isValidPluginId, type Plugin, type PluginManifest } from "./plugin.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

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

  for (const id of pluginFolders(dir)) {
    const fail = (msg: string): number => errors.push(`plugins/${id}: ${msg}`);

    if (!isValidPluginId(id)) {
      errors.push(`"${id}" is not a valid plugin folder name (lowercase a–z, digits, dashes)`);
      continue;
    }
    const file = join(dir, id, "plugin.ts");
    if (!existsSync(file)) { fail("no plugin.ts found"); continue; }

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

    plugins.push({ ...manifest, id }); // identity is the folder, not the manifest
  }

  for (const conflict of findConflicts(plugins)) {
    if (conflict.level === "error") errors.push(conflict.message);
    else logger.warn(`[plugins] ${conflict.message}`);
  }

  if (errors.length) {
    throw new Error(`Plugin discovery failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
  return plugins;
}

// Subfolders of plugins/, sorted for deterministic load order + stable conflict messages. Hidden
// entries (.git, .DS_Store, …) and non-directories are skipped — only folders are plugins.
function pluginFolders(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

function asManifest(value: unknown): PluginManifest | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as PluginManifest) : null;
}

// The collection fields feed findConflicts, which iterates them — a non-array crashes it opaquely.
function shapeError(manifest: PluginManifest): string | null {
  for (const field of ["nav", "permissions", "routes"] as const) {
    if (manifest[field] !== undefined && !Array.isArray(manifest[field])) return `"${field}" must be an array`;
  }
  return null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
