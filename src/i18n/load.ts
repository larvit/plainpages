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

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The shipped catalogs, and the drop-in mount root an operator adds their own to — a folder there
// is a whole locale: a new tag adds a language, an existing one replaces the shipped catalog for it
// (and is held to the same parity check, so a partial replacement fails the boot rather than
// leaving half the app in English). Mirrors plugins/ and config/; ships empty.
export const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "locales");
export const MOUNTED_LOCALES_DIR = join(rootDir, "locales");

// A catalog file is named for the full locale it holds — sv-SE.ts, never sv.ts — with the script
// subtag when the language needs one (sr-Latn-RS). Anything else in the folder is a mistake worth
// stopping for.
const LOCALE_FILE = /^([a-z]{2,3}(?:-[A-Z][a-z]{3})?-(?:[A-Z]{2}|[0-9]{3}))\.ts$/;

export interface LoadI18nOptions {
  localesDir?: string;
  logger?: Pick<Console, "warn">; // warn-level diagnostics (a plugin missing an installed locale); defaults to console
  mountedLocalesDir?: string;
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
  const mountedDir = options.mountedLocalesDir ?? MOUNTED_LOCALES_DIR;
  const pluginsDir = options.pluginsDir ?? PLUGINS_DIR;
  const logger = options.logger ?? console;
  const errors: string[] = [];

  const shipped = await readSet(localesDir, "core", errors);
  // The SHIPPED en-US stays the baseline even when the mount replaces it — otherwise a mounted
  // en-US would only ever be compared against itself, and a one-key rewording would boot green with
  // the whole UI rendering bare keys.
  const baseline = shipped.get(DEFAULT_LOCALE);
  if (!baseline) errors.push(`core: no ${DEFAULT_LOCALE}.ts — it is the baseline every other locale is checked against`);
  const core = new Map(shipped);
  const mounted = await readSet(mountedDir, "locales", errors);
  for (const [locale, catalog] of mounted) core.set(locale, catalog);
  // Checked under the folder they actually live in: telling an operator "core de-DE: missing key …"
  // sends them to src/i18n/locales/, which holds no de-DE.ts at all.
  checkSet(new Map([...core].filter(([locale]) => !mounted.has(locale))), "core", baseline, errors);
  checkSet(mounted, "locales", baseline, errors);
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
    checkSet(set, `plugins/${id}`, set.get(DEFAULT_LOCALE), errors);
    // Legitimate — the plugin's strings fall back to en-US on that page — but an operator who
    // installed a locale should hear about the gap at deploy time, not see English islands later.
    const gaps = available.filter((locale) => !set.has(locale));
    if (gaps.length) logger.warn(`[i18n] plugins/${id}: no ${gaps.join(", ")} — those strings render in ${DEFAULT_LOCALE}`);
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
      errors.push(`${label}: "${entry.name}" is not a locale catalog — name it <language>-<REGION>.ts (sv-SE.ts, es-419.ts, sr-Latn-RS.ts)`);
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

function checkSet(set: Map<string, Catalog>, label: string, baseline: Catalog | undefined, errors: string[]): void {
  if (baseline === undefined) return; // already reported; nothing to compare against
  for (const [locale, catalog] of set) {
    for (const problem of checkCatalog({ baseline, baselineLocale: DEFAULT_LOCALE, catalog, locale })) {
      errors.push(`${label} ${locale}: ${problem}`);
    }
  }
}
