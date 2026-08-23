// Guards the plugin-settings rules: the env name a declaration maps to, per-type coercion, the
// required/default/secret resolution, and what the admin catalog is allowed to carry.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Plugin } from "./plugin.ts";
import {
  ENV_PREFIX,
  envName,
  isValidSettingKey,
  resolveSettings,
  settingsDeclError,
  settingsEnvNames,
  strayNames,
  type SettingDecl,
} from "./settings.ts";

function pluginWith(id: string, settings: SettingDecl[]): Plugin {
  return { apiVersion: "0.2.0", id, settings };
}

test("a key becomes one SCREAMING_SNAKE segment under the plugin's own", () => {
  assert.equal(envName("scheduling", "timezone"), "PLUGIN_SETTING_SCHEDULING_TIMEZONE");
  assert.equal(envName("scheduling", "maxShiftHours"), "PLUGIN_SETTING_SCHEDULING_MAX_SHIFT_HOURS");
  assert.equal(envName("my-plugin", "apiBase"), "PLUGIN_SETTING_MY_PLUGIN_API_BASE");
  assert.equal(ENV_PREFIX, "PLUGIN_SETTING_"); // never bare PLUGIN_ — the host owns PLUGIN_DB_*
});

test("the host's own PLUGIN_DB_* variables are unreachable from a declaration", () => {
  // A plugin id "db" with key "url" is exactly the collision the longer prefix rules out.
  assert.notEqual(envName("db", "url"), "PLUGIN_DB_URL");
  assert.equal(envName("db", "url"), "PLUGIN_SETTING_DB_URL");
});

test("a key is camelCase, so the env name is derivable and no two keys collide", () => {
  assert.ok(isValidSettingKey("timezone"));
  assert.ok(isValidSettingKey("maxShiftHours"));
  assert.ok(!isValidSettingKey("max_shift_hours")); // would collide with maxShiftHours
  assert.ok(!isValidSettingKey("MaxShiftHours"));
  assert.ok(!isValidSettingKey("2fa"));
  assert.ok(!isValidSettingKey(""));
});

test("a declaration is refused when it cannot mean what it says", () => {
  const why = (settings: unknown): string => settingsDeclError(settings) ?? "";

  assert.equal(settingsDeclError([{ key: "a", type: "string" }]), null);
  assert.match(why("nope"), /must be an array/);
  assert.match(why([{ key: "max_hours", type: "number" }]), /max_hours.*camelCase/);
  assert.match(why([{ key: "a", type: "date" }]), /"date".*string, number, boolean, enum, url/);
  assert.match(why([{ key: "a", type: "string" }, { key: "a", type: "number" }]), /declared twice/);
  // required means "boot fails without it", so a default would make the flag a lie.
  assert.match(why([{ default: "x", key: "a", required: true, type: "string" }]), /required.*default.*mutually exclusive/);
  assert.match(why([{ default: 8, key: "a", type: "string" }]), /default.*string/);
  assert.match(why([{ key: "a", type: "enum" }]), /enum.*values/);
  assert.match(why([{ key: "a", type: "enum", values: [] }]), /enum.*values/);
  assert.match(why([{ default: "c", key: "a", type: "enum", values: ["a", "b"] }]), /default "c".*a, b/);
  assert.match(why([{ key: "a", type: "string", values: ["a"] }]), /values.*only.*enum/);
});

test("an unset optional setting resolves to undefined, not to a stand-in", () => {
  const result = resolveSettings([pluginWith("p", [{ key: "a", type: "string" }])], {});
  assert.deepEqual(result.errors, []);
  assert.equal(result.values.get("p")?.["a"], undefined);
});

test("a default fills in, and an env value overrides it", () => {
  const plugins = [pluginWith("p", [{ default: 8, key: "maxHours", type: "number" }])];
  assert.equal(resolveSettings(plugins, {}).values.get("p")?.["maxHours"], 8);
  assert.equal(resolveSettings(plugins, { PLUGIN_SETTING_P_MAX_HOURS: "12" }).values.get("p")?.["maxHours"], 12);
});

test("an empty variable reads as unset — compose passes an unset one through as \"\"", () => {
  const plugins = [pluginWith("p", [{ default: "fallback", key: "a", type: "string" }])];
  assert.equal(resolveSettings(plugins, { PLUGIN_SETTING_P_A: "" }).values.get("p")?.["a"], "fallback");
  const required = [pluginWith("p", [{ key: "a", required: true, type: "string" }])];
  assert.match(resolveSettings(required, { PLUGIN_SETTING_P_A: "" }).errors.join("\n"), /must be set/);
});

test("a missing required setting is an error naming the plugin, the key and the variable", () => {
  const result = resolveSettings([pluginWith("scheduling", [{ key: "timezone", required: true, type: "string" }])], {});
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0] ?? "", /scheduling/);
  assert.match(result.errors[0] ?? "", /timezone/);
  assert.match(result.errors[0] ?? "", /PLUGIN_SETTING_SCHEDULING_TIMEZONE/);
});

test("each type coerces from the environment, and a bad value fails loud", () => {
  const decls: SettingDecl[] = [
    { key: "text", type: "string" },
    { key: "count", type: "number" },
    { key: "flag", type: "boolean" },
    { key: "mode", type: "enum", values: ["strict", "lenient"] },
    { key: "base", type: "url" },
  ];
  const ok = resolveSettings([pluginWith("p", decls)], {
    PLUGIN_SETTING_P_BASE: "https://example.com/v1",
    PLUGIN_SETTING_P_COUNT: "42",
    PLUGIN_SETTING_P_FLAG: "true",
    PLUGIN_SETTING_P_MODE: "strict",
    PLUGIN_SETTING_P_TEXT: "hello",
  });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.values.get("p"), { base: "https://example.com/v1", count: 42, flag: true, mode: "strict", text: "hello" });

  const bad = resolveSettings([pluginWith("p", decls)], {
    PLUGIN_SETTING_P_BASE: "not a url",
    PLUGIN_SETTING_P_COUNT: "twelve",
    PLUGIN_SETTING_P_FLAG: "yes",
    PLUGIN_SETTING_P_MODE: "loose",
  });
  assert.equal(bad.errors.length, 4);
  assert.match(bad.errors.join("\n"), /PLUGIN_SETTING_P_COUNT.*number/);
  assert.match(bad.errors.join("\n"), /PLUGIN_SETTING_P_FLAG.*"true".*"false"/);
  assert.match(bad.errors.join("\n"), /PLUGIN_SETTING_P_MODE.*strict, lenient/);
  assert.match(bad.errors.join("\n"), /PLUGIN_SETTING_P_BASE.*URL/);
});

test("a boolean is only \"true\"/\"false\" — a typo never degrades to false", () => {
  const plugins = [pluginWith("p", [{ default: true, key: "flag", type: "boolean" }])];
  assert.equal(resolveSettings(plugins, { PLUGIN_SETTING_P_FLAG: "false" }).values.get("p")?.["flag"], false);
  assert.equal(resolveSettings(plugins, { PLUGIN_SETTING_P_FLAG: "0" }).errors.length, 1);
});

test("REQUIRE_SECURE_SECRETS refuses an unset secret and one still on its dev default", () => {
  const decls: SettingDecl[] = [{ default: "dev-insecure", key: "apiKey", secret: true, type: "string" }];
  const plugins = [pluginWith("p", decls)];
  assert.deepEqual(resolveSettings(plugins, {}).errors, []); // off: the dev default boots a clean clone

  assert.match(resolveSettings(plugins, {}, { requireSecureSecrets: true }).errors.join("\n"), /apiKey.*must be set/);
  assert.match(
    resolveSettings(plugins, { PLUGIN_SETTING_P_API_KEY: "dev-insecure" }, { requireSecureSecrets: true }).errors.join("\n"),
    /apiKey.*dev/,
  );
  assert.deepEqual(resolveSettings(plugins, { PLUGIN_SETTING_P_API_KEY: "real" }, { requireSecureSecrets: true }).errors, []);
});

test("a secret's value reaches the plugin but never the catalog", () => {
  const plugins = [pluginWith("p", [{ key: "apiKey", secret: true, type: "string" }])];
  const result = resolveSettings(plugins, { PLUGIN_SETTING_P_API_KEY: "s3cr3t" });
  assert.equal(result.values.get("p")?.["apiKey"], "s3cr3t");

  const entry = result.catalog[0]?.settings[0];
  assert.equal(entry?.secret, true);
  assert.equal(entry?.source, "env");
  assert.equal(entry?.value, undefined); // not the value, not its length, not a mask of it
  assert.ok(!JSON.stringify(result.catalog).includes("s3cr3t"));
});

test("the catalog carries every installed plugin, so \"declares none\" is not \"not installed\"", () => {
  const plugins = [pluginWith("with", [{ default: "x", key: "a", type: "string" }]), { apiVersion: "0.2.0", id: "without" }];
  const catalog = resolveSettings(plugins, {}).catalog;
  assert.deepEqual(catalog.map((entry) => entry.pluginId), ["with", "without"]);
  assert.deepEqual(catalog[1]?.settings, []);
});

test("a catalog entry carries the variable to set and where the value came from", () => {
  const decls: SettingDecl[] = [
    { description: "Where shifts come from", key: "upstream", required: true, type: "url" },
    { default: 8, key: "maxHours", type: "number" },
    { key: "note", type: "string" },
  ];
  const catalog = resolveSettings([pluginWith("scheduling", decls)], { PLUGIN_SETTING_SCHEDULING_UPSTREAM: "https://x.test" }).catalog;
  assert.deepEqual(catalog[0]?.settings, [
    { description: "Where shifts come from", envName: "PLUGIN_SETTING_SCHEDULING_UPSTREAM", key: "upstream", required: true, secret: false, source: "env", type: "url", value: "https://x.test" },
    { envName: "PLUGIN_SETTING_SCHEDULING_MAX_HOURS", key: "maxHours", required: false, secret: false, source: "default", type: "number", value: "8" },
    { envName: "PLUGIN_SETTING_SCHEDULING_NOTE", key: "note", required: false, secret: false, source: "unset", type: "string" },
  ]);
});

test("a variable no plugin declares is reported, never acted on", () => {
  const declared = settingsEnvNames([pluginWith("scheduling", [{ key: "timezone", type: "string" }])]);
  const strays = strayNames(
    { PATH: "/usr/bin", PLUGIN_DB_URL: "postgres://x", PLUGIN_SETTING_GONE_KEY: "x", PLUGIN_SETTING_SCHEDULING_TIMEZOME: "UTC", PLUGIN_SETTING_SCHEDULING_TIMEZONE: "UTC" },
    declared,
  );
  assert.deepEqual(strays, ["PLUGIN_SETTING_GONE_KEY", "PLUGIN_SETTING_SCHEDULING_TIMEZOME"]); // sorted; the host's own untouched
});
