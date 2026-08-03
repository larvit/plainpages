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

test("the shipped core catalogs load and agree key for key", async () => {
  const loaded = await loadI18n(); // no args ⇒ the real src/i18n/locales + plugins/
  assert.ok(loaded.available.includes("en-US"));
  assert.ok(loaded.available.includes("sv-SE"));
  assert.deepEqual([...loaded.available].sort(), loaded.available); // sorted, so "sv" resolves deterministically
  assert.ok(Object.keys(loaded.core.get("en-US") ?? {}).length > 20);
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

test("a plugin without an i18n folder is fine", async () => {
  const { localesDir, pluginsDir } = await fixture({ "locales/en-US.ts": catalog(`{ hello: "Hello" }`) });
  const loaded = await loadI18n({ localesDir, pluginIds: ["plain"], pluginsDir });
  assert.equal(loaded.plugins.size, 0);
});
