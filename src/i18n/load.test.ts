import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadI18n } from "./load.ts";

const catalog = (body: string): string => `const messages = ${body};\nexport default messages;\n`;

// A throwaway host tree: <root>/locales/*.ts and <root>/plugins/<id>/i18n/*.ts.
async function fixture(files: Record<string, string>): Promise<{ localesDir: string; pluginsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "i18n-"));
  for (const [path, body] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, body);
  }
  return { localesDir: join(root, "locales"), pluginsDir: join(root, "plugins") };
}

test("the shipped core catalogs load, agree key for key, and use one verb per action", async () => {
  const loaded = await loadI18n(); // no args ⇒ the real src/i18n/locales + plugins/
  assert.ok(loaded.available.includes("en-US"));
  assert.ok(loaded.available.includes("sv-SE"));
  assert.deepEqual([...loaded.available].sort(), loaded.available); // sorted, so "sv" resolves deterministically
  assert.ok(Object.keys(loaded.core.get("en-US") ?? {}).length > 20);

  // One verb per action; inflected too, and the noun ("a sign-in error") is fine. AGENTS.md → Rules.
  // The lookbehind spares a path (/login) and a word ending in one (blog in…).
  const competing = /(?<![/\w])(log(?:ged|ging)?[\s-]?(?:in|out)|sign(?:ed|ing)?[\s-]?up)s?\b/i;
  const offenders = Object.entries(loaded.core.get("en-US") ?? {})
    .map(([key, message]) => [key, typeof message === "string" ? message : Object.values(message).join(" ")] as const)
    .filter(([, text]) => competing.test(text))
    .map(([key, text]) => `${key}: ${text}`);
  assert.deepEqual(offenders, []);
});

test("a plugin's catalogs load under its id and may cover fewer locales than the host", async () => {
  const { localesDir, pluginsDir } = await fixture({
    "locales/en-US.ts": catalog(`{ hello: "Hello" }`),
    "locales/sv-SE.ts": catalog(`{ hello: "Hej" }`),
    "plugins/shop/i18n/en-US.ts": catalog(`{ "shop.title": "Shop" }`),
  });
  const loaded = await loadI18n({ localesDir, pluginIds: ["shop"], pluginsDir });
  assert.deepEqual(loaded.available, ["en-US", "sv-SE"]);
  assert.deepEqual(loaded.plugins.get("shop")?.get("en-US"), { "shop.title": "Shop" });
  assert.equal(loaded.plugins.get("shop")?.has("sv-SE"), false);
});

test("a locale that disagrees with the en-US baseline stops the boot", async () => {
  const { localesDir, pluginsDir } = await fixture({
    "locales/en-US.ts": catalog(`{ hello: "Hello", bye: "Bye" }`),
    "locales/sv-SE.ts": catalog(`{ hello: "Hej", hej: "Hej" }`),
  });
  await assert.rejects(loadI18n({ localesDir, pluginsDir }), (err: Error) => {
    assert.match(err.message, /sv-SE/);
    assert.match(err.message, /missing key "bye"/);
    assert.match(err.message, /unknown key "hej"/);
    return true;
  });
});

test("the en-US baseline itself must exist", async () => {
  const { localesDir, pluginsDir } = await fixture({ "locales/sv-SE.ts": catalog(`{ hello: "Hej" }`) });
  await assert.rejects(loadI18n({ localesDir, pluginsDir }), /en-US\.ts/);
});

test("a file in locales/ that is not a locale is an error, never silently skipped", async () => {
  const { localesDir, pluginsDir } = await fixture({
    "locales/en-US.ts": catalog(`{ hello: "Hello" }`),
    "locales/swedish.ts": catalog(`{ hello: "Hej" }`),
  });
  await assert.rejects(loadI18n({ localesDir, pluginsDir }), /swedish\.ts/);
});

test("a catalog that is not a catalog is an error", async () => {
  const { localesDir, pluginsDir } = await fixture({
    "locales/en-US.ts": catalog(`{ hello: 42 }`),
  });
  await assert.rejects(loadI18n({ localesDir, pluginsDir }), /en-US/);
});

test("a plugin locale the host does not have is an error", async () => {
  const { localesDir, pluginsDir } = await fixture({
    "locales/en-US.ts": catalog(`{ hello: "Hello" }`),
    "plugins/shop/i18n/en-US.ts": catalog(`{ "shop.title": "Shop" }`),
    "plugins/shop/i18n/fr-FR.ts": catalog(`{ "shop.title": "Boutique" }`),
  });
  await assert.rejects(loadI18n({ localesDir, pluginIds: ["shop"], pluginsDir }), /fr-FR/);
});

test("a plugin translation is checked against the plugin's own en-US", async () => {
  const { localesDir, pluginsDir } = await fixture({
    "locales/en-US.ts": catalog(`{ hello: "Hello" }`),
    "locales/sv-SE.ts": catalog(`{ hello: "Hej" }`),
    "plugins/shop/i18n/en-US.ts": catalog(`{ "shop.title": "Shop" }`),
    "plugins/shop/i18n/sv-SE.ts": catalog(`{ "shop.name": "Butik" }`),
  });
  await assert.rejects(loadI18n({ localesDir, pluginIds: ["shop"], pluginsDir }), /shop.*sv-SE|sv-SE.*shop/s);
});

test("a plugin with translations but no en-US baseline is an error", async () => {
  const { localesDir, pluginsDir } = await fixture({
    "locales/en-US.ts": catalog(`{ hello: "Hello" }`),
    "locales/sv-SE.ts": catalog(`{ hello: "Hej" }`),
    "plugins/shop/i18n/sv-SE.ts": catalog(`{ "shop.title": "Butik" }`),
  });
  await assert.rejects(loadI18n({ localesDir, pluginIds: ["shop"], pluginsDir }), /shop/);
});

test("a mounted locales/ adds a language, and replaces a shipped one wholesale", async () => {
  const { localesDir, pluginsDir } = await fixture({
    "locales/en-US.ts": catalog(`{ hello: "Hello" }`),
    "locales/sv-SE.ts": catalog(`{ hello: "Hej" }`),
    "mounted/nb-NO.ts": catalog(`{ hello: "Hei" }`),
    "mounted/sv-SE.ts": catalog(`{ hello: "Tjena" }`),
  });
  const loaded = await loadI18n({ localesDir, mountedLocalesDir: join(localesDir, "..", "mounted"), pluginsDir });
  assert.deepEqual(loaded.available, ["en-US", "nb-NO", "sv-SE"]);
  assert.deepEqual(loaded.core.get("sv-SE"), { hello: "Tjena" }); // the operator's file wins outright
});

test("a mounted catalog is held to the same baseline as a shipped one", async () => {
  const { localesDir, pluginsDir } = await fixture({
    "locales/en-US.ts": catalog(`{ hello: "Hello", bye: "Bye" }`),
    "mounted/nb-NO.ts": catalog(`{ hello: "Hei" }`), // no `bye` ⇒ half the app would be English
  });
  await assert.rejects(loadI18n({ localesDir, mountedLocalesDir: join(localesDir, "..", "mounted"), pluginsDir }), /nb-NO.*missing key "bye"/s);
});

test("a plugin without an i18n folder is fine", async () => {
  const { localesDir, pluginsDir } = await fixture({ "locales/en-US.ts": catalog(`{ hello: "Hello" }`) });
  const loaded = await loadI18n({ localesDir, pluginIds: ["plain"], pluginsDir });
  assert.equal(loaded.plugins.size, 0);
});

test("an operator adds a language for a plugin without forking it, and may replace one it ships", async () => {
  const { localesDir, pluginsDir } = await fixture({
    "locales/en-US.ts": catalog(`{ hello: "Hello" }`),
    "locales/sv-SE.ts": catalog(`{ hello: "Hej" }`),
    "plugins/shop/i18n/en-US.ts": catalog(`{ "shop.title": "Shop" }`),
    "plugins/shop/i18n/sv-SE.ts": catalog(`{ "shop.title": "Butik" }`),
    "mounted/plugins/shop/sv-SE.ts": catalog(`{ "shop.title": "Affär" }`), // replaces the plugin's
    "mounted/plugins/shop/nb-NO.ts": catalog(`{ "shop.title": "Butikk" }`), // …and adds one
    "mounted/nb-NO.ts": catalog(`{ hello: "Hei" }`), // the core side of the same language
  });
  const loaded = await loadI18n({ localesDir, mountedLocalesDir: join(localesDir, "..", "mounted"), pluginIds: ["shop"], pluginsDir });

  assert.deepEqual(loaded.available, ["en-US", "nb-NO", "sv-SE"]);
  assert.deepEqual(loaded.plugins.get("shop")?.get("sv-SE"), { "shop.title": "Affär" });
  assert.deepEqual(loaded.plugins.get("shop")?.get("nb-NO"), { "shop.title": "Butikk" });
  assert.deepEqual(loaded.plugins.get("shop")?.get("en-US"), { "shop.title": "Shop" }); // untouched
});

test("an operator's plugin catalog is held to the plugin's own baseline, and named by where it lives", async () => {
  const { localesDir, pluginsDir } = await fixture({
    "locales/en-US.ts": catalog(`{ hello: "Hello" }`),
    "locales/sv-SE.ts": catalog(`{ hello: "Hej" }`),
    "plugins/shop/i18n/en-US.ts": catalog(`{ "shop.title": "Shop", "shop.new": "New" }`),
    "mounted/plugins/shop/sv-SE.ts": catalog(`{ "shop.title": "Butik" }`), // shop.new missing
  });
  await assert.rejects(
    loadI18n({ localesDir, mountedLocalesDir: join(localesDir, "..", "mounted"), pluginIds: ["shop"], pluginsDir }),
    /locales\/plugins\/shop sv-SE: missing key "shop.new"/, // the folder the operator actually edited
  );
});
