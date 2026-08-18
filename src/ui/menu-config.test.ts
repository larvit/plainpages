import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { DEFAULT_MENU, loadMenuConfig } from "./menu-config.ts";

// Write a throwaway menu.ts (a plain object — defineMenu is identity) and clean it up after.
function scaffold(t: TestContext, source: string, strays: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "pp-menu-"));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const file = join(dir, "menu.ts");
  writeFileSync(file, source);
  for (const stray of strays) {
    if (stray.endsWith(".json")) writeFileSync(join(dir, stray), "{}");
    else mkdirSync(join(dir, stray), { recursive: true });
  }
  return file;
}

test("loadMenuConfig returns defaults when no config file exists (clean clone)", async () => {
  assert.deepEqual(await loadMenuConfig({ file: join(tmpdir(), "pp-no-such-menu-xyz.ts") }), DEFAULT_MENU);
});

test("loadMenuConfig reads branding + override, merging branding over defaults", async (t) => {
  const file = scaffold(t, `export default {
    branding: { name: "Acme Ops", theme: "dark" },
    override: { hide: ["teams"], order: ["reports", "people"], rename: { people: "Staff" } },
  };`);
  const menu = await loadMenuConfig({ file });

  assert.equal(menu.branding.name, "Acme Ops");
  assert.equal(menu.branding.sub, "brand.sub"); // default kept (only `name`/`theme` overridden); chrome translates it
  assert.equal(menu.branding.theme, "dark");
  assert.deepEqual(menu.override.hide, ["teams"]);
  assert.deepEqual(menu.override.rename, { people: "Staff" });
});

test("loadMenuConfig fails loud on a malformed config", async (t) => {
  await assert.rejects(loadMenuConfig({ file: scaffold(t, `export default [];`) }), /config object/);
  await assert.rejects(loadMenuConfig({ file: scaffold(t, `export default { branding: { theme: "neon" } };`) }), /theme/);
  await assert.rejects(loadMenuConfig({ file: scaffold(t, `export default { override: { hide: "teams" } };`) }), /hide.*array/s);
});

test("loadMenuConfig refuses a stray package.json or node_modules beside the config", async (t) => {
  const valid = `export default { branding: { name: "Acme Ops" } };`;

  for (const stray of ["node_modules", "package.json"]) {
    await assert.rejects(
      loadMenuConfig({ file: scaffold(t, valid, [stray]) }),
      new RegExp(`config/${stray.replace(".", "\\.")} must not exist.*delete`, "s"),
    );
  }
});
