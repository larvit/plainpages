// Per-plugin settings: the declaration shape, the env name it maps to, and the resolution rules
// (README → Plugin settings). Pure — server.ts passes `process.env` in, so the whole matrix is
// unit-testable without a stack.

import type { Plugin } from "./plugin.ts";

// `PLUGIN_` alone would let a plugin id "db" with key "url" produce the host's own PLUGIN_DB_URL.
export const ENV_PREFIX = "PLUGIN_SETTING_";

export const SETTING_TYPES = ["string", "number", "boolean", "enum", "url"] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

export type SettingValue = boolean | number | string;

// What a manifest declares. `required` and `default` are mutually exclusive: a default means the
// setting can never fail resolution, which is the opposite of what required asserts.
export interface SettingDecl {
  default?: SettingValue;
  description?: string;
  key: string;
  required?: boolean;
  secret?: boolean; // value reaches the plugin, never a log, an error or the catalog
  type: SettingType;
  values?: readonly string[]; // enum only — the accepted choices
}

interface SettingTypeMap {
  boolean: boolean;
  enum: string;
  number: number;
  string: string;
  url: string;
}

type ValueOfDecl<D> = D extends { type: "enum"; values: readonly (infer V extends string)[] }
  ? V
  : D extends { type: infer T extends keyof SettingTypeMap }
    ? SettingTypeMap[T]
    : never;

// The resolved shape a plugin's onBoot receives, inferred from its own declarations so no caller
// narrows with a cast. Only a required or defaulted setting is guaranteed present.
export type SettingsOf<D extends readonly SettingDecl[]> = {
  [K in D[number] as K["key"]]: K extends { required: true }
    ? ValueOfDecl<K>
    : K extends { default: SettingValue }
      ? ValueOfDecl<K>
      : ValueOfDecl<K> | undefined;
};

export type SettingsValues = Record<string, SettingValue | undefined>;

// One row of the admin catalog. `value` is a display string and is absent for a secret and for an
// unset setting — a secret's length is a disclosure too, so nothing stands in for it.
export interface SettingSummary {
  description?: string;
  envName: string;
  key: string;
  required: boolean;
  secret: boolean;
  source: "default" | "env" | "unset";
  type: SettingType;
  value?: string;
  values?: readonly string[];
}

export interface PluginSettings {
  pluginId: string;
  settings: SettingSummary[];
}

export interface ResolveResult {
  catalog: PluginSettings[];
  errors: string[];
  values: Map<string, SettingsValues>;
}

export interface ResolveOptions {
  requireSecureSecrets?: boolean;
}

type Env = Record<string, string | undefined>;

const SETTING_KEY = /^[a-z][a-zA-Z0-9]*$/;

export function isValidSettingKey(key: unknown): boolean {
  return typeof key === "string" && SETTING_KEY.test(key);
}

export function envName(pluginId: string, key: string): string {
  const plugin = pluginId.replaceAll("-", "_").toUpperCase();
  return `${ENV_PREFIX}${plugin}_${camelToSnake(key)}`;
}

function camelToSnake(key: string): string {
  return key.replaceAll(/(?<=[a-z0-9])(?=[A-Z])/g, "_").toUpperCase();
}

// Discovery-time shape check: the author's mistakes, refused before any value is read.
export function settingsDeclError(settings: unknown): string | null {
  if (!Array.isArray(settings)) return `"settings" must be an array`;

  const seen = new Set<string>();
  for (const decl of settings as SettingDecl[]) {
    const key = decl?.key;
    if (!isValidSettingKey(key)) {
      return `setting "${String(key)}" — a key must be camelCase (${SETTING_KEY.source}) so its variable name is derivable`;
    }
    if (seen.has(key)) return `setting "${key}" is declared twice`;
    seen.add(key);

    if (!(SETTING_TYPES as readonly string[]).includes(decl.type)) {
      return `setting "${key}" has type "${String(decl.type)}"; one of ${SETTING_TYPES.join(", ")}`;
    }
    if (decl.required === true && decl.default !== undefined) {
      return `setting "${key}" sets both required and default — they are mutually exclusive, a default means it can never fail`;
    }
    if (decl.type === "enum") {
      if (!Array.isArray(decl.values) || decl.values.length === 0 || decl.values.some((v) => typeof v !== "string")) {
        return `setting "${key}" has type enum, so it must declare a non-empty values array of strings`;
      }
    } else if (decl.values !== undefined) {
      return `setting "${key}" declares values, which only an enum type may do`;
    }

    const typeError = defaultTypeError(decl);
    if (typeError) return typeError;
  }
  return null;
}

function defaultTypeError(decl: SettingDecl): string | null {
  if (decl.default === undefined) return null;
  if (decl.type === "enum") {
    const values = decl.values ?? [];
    return values.includes(String(decl.default))
      ? null
      : `setting "${decl.key}" has default "${String(decl.default)}", which is not one of ${values.join(", ")}`;
  }
  const expected = decl.type === "number" ? "number" : decl.type === "boolean" ? "boolean" : "string";
  return typeof decl.default === expected
    ? null
    : `setting "${decl.key}": default must be a ${expected} (type ${decl.type}), got ${typeof decl.default}`;
}

// Every variable the installed plugins answer to — the set a stray is measured against.
export function settingsEnvNames(plugins: Plugin[]): Set<string> {
  const names = new Set<string>();
  for (const plugin of plugins) {
    for (const decl of plugin.settings ?? []) names.add(envName(plugin.id, decl.key));
  }
  return names;
}

// A PLUGIN_SETTING_ variable no installed plugin declares — usually a typo in the one the operator
// meant to set, or a plugin they removed. Reported, never acted on (the orphan-database precedent).
export function strayNames(env: Env, declared: ReadonlySet<string>): string[] {
  return Object.keys(env)
    .filter((name) => name.startsWith(ENV_PREFIX) && !declared.has(name))
    .sort();
}

export function resolveSettings(plugins: Plugin[], env: Env, options: ResolveOptions = {}): ResolveResult {
  const catalog: PluginSettings[] = [];
  const errors: string[] = [];
  const values = new Map<string, SettingsValues>();

  for (const plugin of plugins) {
    const decls = plugin.settings ?? [];
    const resolved: SettingsValues = {};
    const summaries: SettingSummary[] = [];

    for (const decl of decls) {
      const name = envName(plugin.id, decl.key);
      const raw = env[name] || undefined; // compose passes an unset variable through as ""
      const fail = (message: string): void => void errors.push(`plugin "${plugin.id}": ${message}`);

      let value: SettingValue | undefined;
      let source: SettingSummary["source"] = "unset";
      if (raw !== undefined) {
        const coerced = coerce(decl, raw, name);
        if (typeof coerced === "string") fail(coerced);
        else {
          value = coerced.value;
          source = "env";
        }
      } else if (decl.default !== undefined) {
        value = decl.default;
        source = "default";
      } else if (decl.required === true) {
        fail(`setting "${decl.key}" must be set — ${name} (type ${decl.type}, no default)`);
      }

      const secretError = secretPolicyError(decl, raw, options.requireSecureSecrets === true, name);
      if (secretError) fail(secretError);

      resolved[decl.key] = value;
      summaries.push(summarize(decl, name, source, value));
    }

    if (decls.length > 0) values.set(plugin.id, resolved);
    catalog.push({ pluginId: plugin.id, settings: summaries });
  }

  return { catalog, errors, values };
}

// The host's own rule for a secret (readSecret), reaching plugins: enforced, neither unset nor the
// declared dev throwaway is accepted.
function secretPolicyError(decl: SettingDecl, raw: string | undefined, enforce: boolean, name: string): string | null {
  if (!enforce || decl.secret !== true) return null;
  if (raw === undefined) return `setting "${decl.key}" must be set when REQUIRE_SECURE_SECRETS=true — ${name}`;
  if (decl.default !== undefined && raw === String(decl.default)) {
    return `setting "${decl.key}" must not be its dev default when REQUIRE_SECURE_SECRETS=true — ${name}`;
  }
  return null;
}

function summarize(decl: SettingDecl, name: string, source: SettingSummary["source"], value: SettingValue | undefined): SettingSummary {
  const showValue = decl.secret !== true && value !== undefined;
  return {
    ...(decl.description !== undefined ? { description: decl.description } : {}),
    envName: name,
    key: decl.key,
    required: decl.required === true,
    secret: decl.secret === true,
    source,
    type: decl.type,
    ...(showValue ? { value: String(value) } : {}),
    ...(decl.values !== undefined ? { values: decl.values } : {}),
  };
}

// A coerced value, or the boot error naming the variable and what it accepts.
function coerce(decl: SettingDecl, raw: string, name: string): { value: SettingValue } | string {
  switch (decl.type) {
    case "boolean":
      if (raw === "true") return { value: true };
      if (raw === "false") return { value: false };
      return `${name} must be "true" or "false", got "${raw}"`;
    case "enum":
      return (decl.values ?? []).includes(raw)
        ? { value: raw }
        : `${name} must be one of ${(decl.values ?? []).join(", ")}, got "${raw}"`;
    case "number": {
      const value = Number(raw);
      return Number.isFinite(value) ? { value } : `${name} must be a number, got "${raw}"`;
    }
    case "url":
      try {
        new URL(raw);
      } catch {
        return `${name} is not a valid URL: ${raw}`;
      }
      return { value: raw };
    case "string":
      return { value: raw };
  }
}
