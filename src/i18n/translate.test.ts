import assert from "node:assert/strict";
import { test } from "node:test";
import type { Catalog } from "./catalog.ts";
import { createTranslator } from "./translate.ts";

const core: Catalog = {
  "greeting": "Hello, {{name}}!",
  "shell.signOut": "Sign out",
  "shifts.count": { one: "{{count}} shift", other: "{{count}} shifts" },
};
const coreSv: Catalog = {
  "greeting": "Hej, {{name}}!",
  "shell.signOut": "Logga ut",
  "shifts.count": { one: "{{count}} pass", other: "{{count}} pass" },
};

test("a key resolves from the first catalog that has it", () => {
  const t = createTranslator({ catalogs: [coreSv, core], locale: "sv-SE" });
  assert.equal(t("shell.signOut"), "Logga ut");
});

test("a key missing from the active locale falls back down the chain", () => {
  const t = createTranslator({ catalogs: [{ "shell.signOut": "Logga ut" }, core], locale: "sv-SE" });
  assert.equal(t("greeting", { name: "Li" }), "Hello, Li!");
});

test("a plugin catalog wins over the core one", () => {
  const plugin: Catalog = { "shell.signOut": "Leave" };
  const t = createTranslator({ catalogs: [plugin, core], locale: "en-US" });
  assert.equal(t("shell.signOut"), "Leave");
});

test("a key missing everywhere renders as itself", () => {
  const t = createTranslator({ catalogs: [core], locale: "en-US" });
  assert.equal(t("nope.at.all"), "nope.at.all");
  assert.equal(t("Shifts"), "Shifts"); // the nav-label contract: a plain label is its own fallback
});

test("{{vars}} interpolate; an unsupplied one stays visible", () => {
  const t = createTranslator({ catalogs: [{ both: "{{a}} and {{b}}", n: "n={{n}}" }], locale: "en-US" });
  assert.equal(t("both", { a: "x", b: "y" }), "x and y");
  assert.equal(t("both", { a: "x" }), "x and {{b}}");
  assert.equal(t("n", { n: 3 }), "n=3");
});

test("t returns raw text — escaping is the view's job", () => {
  const t = createTranslator({ catalogs: [{ hi: "Hi {{name}}" }], locale: "en-US" });
  assert.equal(t("hi", { name: "<b>ok</b>" }), "Hi <b>ok</b>");
});

test("plural messages select on count via Intl.PluralRules", () => {
  const t = createTranslator({ catalogs: [core], locale: "en-US" });
  assert.equal(t("shifts.count", { count: 1 }), "1 shift");
  assert.equal(t("shifts.count", { count: 0 }), "0 shifts");
  assert.equal(t("shifts.count", { count: 7 }), "7 shifts");
});

test("plural selection follows the active locale's own categories", () => {
  const cs: Catalog = { files: { few: "{{count}} soubory", many: "{{count}} souboru", one: "{{count}} soubor", other: "{{count}} souborů" } };
  const t = createTranslator({ catalogs: [cs], locale: "cs-CZ" });
  assert.equal(t("files", { count: 1 }), "1 soubor");
  assert.equal(t("files", { count: 3 }), "3 soubory");
  assert.equal(t("files", { count: 10 }), "10 souborů");
});

test("a plural message without a count, or without the selected category, falls back to other", () => {
  const t = createTranslator({ catalogs: [core], locale: "en-US" });
  assert.equal(t("shifts.count"), "{{count}} shifts");
  const partial = createTranslator({ catalogs: [{ x: { other: "many" } }], locale: "en-US" });
  assert.equal(partial("x", { count: 1 }), "many");
});
