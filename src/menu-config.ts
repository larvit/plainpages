// Central menu config: config/menu.ts lets an operator set branding (app name, logo,
// default theme) and reorder/rename/group/hide nav nodes across all plugins. The reorder/rename/
// group/hide part is the NavOverride composeNav already applies (the override always wins, before
// the per-user permission filter). Authored as TypeScript (defineMenu types it); loaded once at
// boot — fail-loud on a malformed file, defaults when absent (clean clone needs no config).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { NavOverride } from "./nav.ts";

export type Theme = "auto" | "dark" | "light";

export interface Branding {
  logo?: string; // optional logo asset path/URL, rendered in the sidebar brand
  name: string; // app name shown in the sidebar brand
  sub?: string; // optional brand subtitle
  theme?: Theme; // default color theme for the theme-switch
}

export interface MenuConfig {
  branding: Branding;
  override: NavOverride;
}

// What config/menu.ts authors — every field optional; the loader fills branding defaults.
export interface MenuConfigInput {
  branding?: Partial<Branding>;
  override?: NavOverride;
}

export const DEFAULT_BRANDING: Branding = { name: "Plainpages", sub: "Console" };
export const DEFAULT_MENU: MenuConfig = { branding: DEFAULT_BRANDING, override: {} };

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MENU_CONFIG_FILE = join(rootDir, "config", "menu.ts");

// Identity helper: types the authored config, returns it unchanged (mirrors definePlugin).
export function defineMenu(config: MenuConfigInput): MenuConfigInput {
  return config;
}

export interface LoadMenuOptions {
  file?: string;
}

export async function loadMenuConfig(options: LoadMenuOptions = {}): Promise<MenuConfig> {
  const file = options.file ?? MENU_CONFIG_FILE;
  if (!existsSync(file)) return DEFAULT_MENU; // clean clone: no central override

  let mod: { default?: unknown };
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (err) {
    throw new Error(`config/menu.ts failed to import — ${err instanceof Error ? err.message : String(err)}`);
  }

  const errors = validate(mod.default);
  if (errors.length) throw new Error(`config/menu.ts is invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}`);

  const authored = mod.default as MenuConfigInput;
  return {
    branding: { ...DEFAULT_BRANDING, ...authored.branding },
    override: authored.override ?? {},
  };
}

const THEMES = new Set<string>(["auto", "dark", "light"]);

// Validate the authored shape so a typo fails at boot, not silently at render. Only the fields an
// operator commonly mis-types; composeNav consumes the override defensively beyond that.
function validate(input: unknown): string[] {
  if (!isObject(input)) return ["default export must be a config object (use defineMenu)"];
  const errors: string[] = [];

  if (input.branding !== undefined) {
    if (!isObject(input.branding)) errors.push("branding must be an object");
    else {
      for (const key of ["logo", "name", "sub"] as const) {
        if (input.branding[key] !== undefined && typeof input.branding[key] !== "string") errors.push(`branding.${key} must be a string`);
      }
      if (input.branding.theme !== undefined && !THEMES.has(input.branding.theme as string)) errors.push("branding.theme must be one of auto/dark/light");
    }
  }

  if (input.override !== undefined) {
    if (!isObject(input.override)) errors.push("override must be an object");
    else {
      for (const key of ["hide", "order"] as const) {
        if (input.override[key] !== undefined && !isStringArray(input.override[key])) errors.push(`override.${key} must be an array of strings`);
      }
      if (input.override.groups !== undefined && !Array.isArray(input.override.groups)) errors.push("override.groups must be an array");
      if (input.override.rename !== undefined && !isObject(input.override.rename)) errors.push("override.rename must be an object");
    }
  }
  return errors;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
