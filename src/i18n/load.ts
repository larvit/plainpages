// Catalog discovery: import src/i18n/locales/<tag>.ts and plugins/<id>/i18n/<tag>.ts, then
// check every one against its set's en-US baseline. The imperative shell over catalog.ts's pure
// rules — the same contract as plugin discovery: one boot-stopping Error listing every problem,
// so a half-translated deploy is caught at startup rather than as a stray English word in production.
//
// Installed locales are whatever the core folder holds; a plugin may translate fewer of them (its
// strings then render in en-US on that page) but never one the host does not have.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkCatalog, DEFAULT_LOCALE, isCatalog, type Catalog } from "./catalog.ts";
import { PLUGINS_DIR } from "../plugin-host/discovery.ts";

export const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "locales");

// A catalog file is named for the full locale it holds — sv-SE.ts, never sv.ts. Anything else in
// the folder is a mistake worth stopping for.
const LOCALE_FILE = /^([a-z]{2,3}-[A-Z]{2})\.ts$/;

export interface LoadI18nOptions {
  localesDir?: string;
  pluginIds?: string[]; // discovered plugins; their i18n/ folders are loaded under their id
  pluginsDir?: string;
}

export interface LoadedI18n {
  available: string[]; // installed locales, sorted — the switcher's list, and "sv" resolution order
  core: Map<string, Catalog>;
  plugins: Map<string, Map<string, Catalog>>; // plugin id → locale → catalog
}

export async function loadI18n(options: LoadI18nOptions = {}): Promise<LoadedI18n> {
  const localesDir = options.localesDir ?? LOCALES_DIR;
  const pluginsDir = options.pluginsDir ?? PLUGINS_DIR;
  const errors: string[] = [];

  const core = await readSet(localesDir, "core", errors);
  if (!core.has(DEFAULT_LOCALE)) errors.push(`core: no ${DEFAULT_LOCALE}.ts — it is the baseline every other locale is checked against`);
  checkSet(core, "core", errors);
  const available = [...core.keys()].sort();

  const plugins = new Map<string, Map<string, Catalog>>();
  for (const id of options.pluginIds ?? []) {
    const dir = join(pluginsDir, id, "i18n");
    if (!existsSync(dir)) continue;
    const set = await readSet(dir, `plugins/${id}`, errors);
    if (set.size === 0) continue;
    if (!set.has(DEFAULT_LOCALE)) errors.push(`plugins/${id}: no ${DEFAULT_LOCALE}.ts — a plugin's own baseline`);
    for (const locale of set.keys()) {
      if (!available.includes(locale)) errors.push(`plugins/${id}: ${locale} is not installed — add src/i18n/locales/${locale}.ts first`);
    }
    checkSet(set, `plugins/${id}`, errors);
    plugins.set(id, set);
  }

  if (errors.length) throw new Error(`Translation catalogs failed to load:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  return { available, core, plugins };
}

// Import every catalog in one folder. A stray file, a failed import or a value that is not a
// catalog is collected as an error — never skipped, or the locale would just go quietly missing.
async function readSet(dir: string, label: string, errors: string[]): Promise<Map<string, Catalog>> {
  const set = new Map<string, Catalog>();
  if (!existsSync(dir)) return set;

  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() || entry.name.startsWith(".")) continue;
    const locale = LOCALE_FILE.exec(entry.name)?.[1];
    if (locale === undefined) {
      errors.push(`${label}: "${entry.name}" is not a locale catalog — name it <language>-<REGION>.ts (e.g. sv-SE.ts)`);
      continue;
    }
    let mod: { default?: unknown };
    try {
      mod = (await import(pathToFileURL(join(dir, entry.name)).href)) as { default?: unknown };
    } catch (err) {
      errors.push(`${label}: ${entry.name} failed to import — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!isCatalog(mod.default)) {
      errors.push(`${label}: ${entry.name} must default-export an object of strings (or plural forms)`);
      continue;
    }
    set.set(locale, mod.default);
  }
  return set;
}

function checkSet(set: Map<string, Catalog>, label: string, errors: string[]): void {
  const baseline = set.get(DEFAULT_LOCALE);
  if (baseline === undefined) return; // already reported; nothing to compare against
  for (const [locale, catalog] of set) {
    for (const problem of checkCatalog({ baseline, baselineLocale: DEFAULT_LOCALE, catalog, locale })) {
      errors.push(`${label} ${locale}: ${problem}`);
    }
  }
}
