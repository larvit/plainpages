import assert from "node:assert/strict";
import { test } from "node:test";
import type { Catalog } from "./catalog.ts";
import { createI18n } from "./runtime.ts";

const core = new Map<string, Catalog>([
  ["en-US", { "shell.signOut": "Sign out", "shop.title": "Core" }],
  ["sv-SE", { "shell.signOut": "Logga ut", "shop.title": "Kärna" }],
]);
const plugins = new Map<string, Map<string, Catalog>>([
  ["shop", new Map<string, Catalog>([["en-US", { "shop.new": "New order", "shop.title": "Shop" }], ["sv-SE", { "shop.new": "Ny order", "shop.title": "Butik" }]])],
  ["thin", new Map<string, Catalog>([["en-US", { "thin.title": "Thin" }]])],
]);
const i18n = createI18n({ available: ["en-US", "sv-SE"], core, plugins });

test("resolve applies the request precedence over the installed locales", () => {
  assert.deepEqual(i18n.resolve({ param: "sv-SE" }), { explicit: true, locale: "sv-SE" });
  assert.deepEqual(i18n.resolve({ acceptLanguage: "sv,en;q=0.5" }), { explicit: false, locale: "sv-SE" });
  assert.deepEqual(i18n.resolve({}), { explicit: false, locale: "en-US" });
});

test("a plugin's own translation wins over the core one", () => {
  assert.equal(i18n.translator("sv-SE", "shop")("shop.title"), "Butik");
  assert.equal(i18n.translator("sv-SE")("shop.title"), "Kärna");
});

test("a plugin key untranslated in this locale falls back to the plugin's en-US, not to core", () => {
  assert.equal(i18n.translator("sv-SE", "thin")("thin.title"), "Thin");
  assert.equal(i18n.translator("sv-SE", "thin")("shell.signOut"), "Logga ut"); // core still speaks Swedish
});

test("an unknown plugin or locale still translates what it can", () => {
  assert.equal(i18n.translator("sv-SE", "nope")("shell.signOut"), "Logga ut");
  assert.equal(i18n.translator("de-DE")("shell.signOut"), "Sign out"); // uninstalled locale ⇒ the baseline
});

test("translators are memoised per locale and plugin", () => {
  assert.equal(i18n.translator("sv-SE", "shop"), i18n.translator("sv-SE", "shop"));
  assert.notEqual(i18n.translator("sv-SE", "shop"), i18n.translator("sv-SE"));
});
