import assert from "node:assert/strict";
import test from "node:test";
import type { PageChrome, PluginSettings } from "@plainpages/plugin-api";
import { buildPluginSettingsModel } from "./admin-plugin-settings.ts";

const CHROME: PageChrome = { brand: { name: "Test" }, csrfToken: "tok", nav: [], signInHref: "/login", user: { email: "", initials: "T", name: "Tester" } };

const CATALOG: readonly PluginSettings[] = [
  {
    pluginId: "scheduling",
    settings: [
      { description: "Where shifts come from", envName: "PLUGIN_SETTING_SCHEDULING_UPSTREAM", key: "upstream", required: true, secret: false, source: "env", type: "url", value: "https://shifts.test" },
      { envName: "PLUGIN_SETTING_SCHEDULING_MODE", key: "mode", required: false, secret: false, source: "default", type: "enum", value: "strict", values: ["strict", "lenient"] },
      { envName: "PLUGIN_SETTING_SCHEDULING_NOTE", key: "note", required: false, secret: false, source: "unset", type: "string" },
    ],
  },
  { pluginId: "quiet", settings: [] },
];

test("a row carries the variable to set and where the value came from", () => {
  const model = buildPluginSettingsModel({ chrome: CHROME, settings: CATALOG });
  const rows = model.groups[0]?.table.rows ?? [];
  assert.deepEqual(rows.map((r) => r.name), ["upstream", "mode", "note"]);
  assert.deepEqual(rows[0]?.cells, [
    { rowHeader: { text: "upstream" } }, "Where shifts come from", "url", "Yes", "PLUGIN_SETTING_SCHEDULING_UPSTREAM", "Environment", "https://shifts.test",
  ]);
  assert.equal(rows[1]?.cells[2], "enum (strict, lenient)"); // the choices are the useful half of the type
  assert.equal(rows[2]?.cells[5], "Not set");
});

test("a plugin declaring nothing still gets a section, so it is visibly installed", () => {
  const model = buildPluginSettingsModel({ chrome: CHROME, settings: CATALOG });
  assert.deepEqual(model.groups.map((g) => g.pluginId), ["scheduling", "quiet"]);
  assert.deepEqual(model.groups[1]?.table.rows, []);
  assert.match(model.groups[1]?.emptyText ?? "", /no settings/i);
});

test("a secret renders as set-or-not, never as a value, a mask or a length", () => {
  const settings: readonly PluginSettings[] = [{
    pluginId: "billing",
    settings: [
      { envName: "PLUGIN_SETTING_BILLING_API_KEY", key: "apiKey", required: false, secret: true, source: "env", type: "string" },
      { envName: "PLUGIN_SETTING_BILLING_WEBHOOK_KEY", key: "webhookKey", required: false, secret: true, source: "unset", type: "string" },
    ],
  }];
  const rows = buildPluginSettingsModel({ chrome: CHROME, settings }).groups[0]?.table.rows ?? [];
  assert.equal(rows[0]?.cells[6], "Secret — set");
  assert.equal(rows[1]?.cells[6], "Secret — not set");
});

test("two tables on one page need distinct row-action id stems", () => {
  const model = buildPluginSettingsModel({ chrome: CHROME, settings: CATALOG });
  const stems = model.groups.map((g) => g.table.actionsId);
  assert.equal(new Set(stems).size, stems.length);
});
