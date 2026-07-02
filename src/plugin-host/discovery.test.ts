import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { discoverPlugins } from "./discovery.ts";

// Write a throwaway plugins/ tree of `relpath → source` and clean it up after the test. Fixtures
// default-export plain objects — definePlugin is identity, so a literal is an equivalent manifest.
function scaffold(t: TestContext, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pp-plugins-"));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const full = (id: string): string =>
  `export default { apiVersion: "1.0.0", nav: [{ id: "${id}:root", label: "${id}" }], ` +
  `routes: [{ method: "GET", path: "/", handler: () => ({ html: "${id}" }) }] };`;

test("a missing plugins/ dir means zero plugins, not an error (clean clone)", async () => {
  assert.deepEqual(await discoverPlugins({ dir: join(tmpdir(), "pp-does-not-exist-xyz") }), []);
});

test("discovers each folder's manifest, sorted, id derived from the folder name", async (t) => {
  const dir = scaffold(t, { "beta/plugin.ts": full("beta"), "alpha/plugin.ts": full("alpha") });
  const plugins = await discoverPlugins({ dir });

  assert.deepEqual(plugins.map((p) => p.id), ["alpha", "beta"]); // deterministic order
  assert.equal(plugins[0]?.apiVersion, "1.0.0");
  assert.equal(plugins[0]?.nav?.[0]?.label, "alpha");
  assert.equal(typeof plugins[0]?.routes?.[0]?.handler, "function"); // handlers survive import
});

// Every per-plugin problem and every error-level conflict aborts boot with a message naming it.
const badCases: Array<{ name: string; files: Record<string, string>; match: RegExp }> = [
  { name: "invalid folder name", files: { "Bad_Name/plugin.ts": full("x") }, match: /Bad_Name/ },
  { name: "reserved id shadows a host route", files: { "login/plugin.ts": full("login") }, match: /login.*reserved/s },
  { name: "reserved oauth2 id shadows the provider routes", files: { "oauth2/plugin.ts": full("oauth2") }, match: /oauth2.*reserved/s },
  { name: "missing plugin.ts", files: { "broken/readme.txt": "x" }, match: /broken.*plugin\.ts/s },
  { name: "no default export", files: { "named-only/plugin.ts": "export const x = 1;" }, match: /named-only.*default/s },
  { name: "import throws", files: { "explodes/plugin.ts": "throw new Error('boom');" }, match: /explodes.*boom/s },
  { name: "incompatible apiVersion", files: { "future/plugin.ts": `export default { apiVersion: "2.0.0" };` }, match: /future.*apiVersion/s },
  { name: "non-array routes", files: { "weird/plugin.ts": `export default { apiVersion: "1.0.0", routes: "nope" };` }, match: /weird.*routes.*array/s },
  { name: "non-function home", files: { "weirdhome/plugin.ts": `export default { apiVersion: "1.0.0", home: "nope" };` }, match: /weirdhome.*home.*function/s },
  { name: "non-function dashboard", files: { "weirddash/plugin.ts": `export default { apiVersion: "1.0.0", dashboard: "nope" };` }, match: /weirddash.*dashboard.*function/s },
  { name: "reserved dashboard id shadows the gated dashboard", files: { "dashboard/plugin.ts": full("dashboard") }, match: /dashboard.*reserved/s },
  { name: "duplicate nav id across plugins", files: { "a/plugin.ts": full("a").replace("a:root", "dup"), "b/plugin.ts": full("b").replace("b:root", "dup") }, match: /nav id "dup"/ },
  { name: "a route marked public AND permission is contradictory", files: { "contra/plugin.ts": `export default { apiVersion: "1.0.0", routes: [{ method: "GET", path: "/", public: true, permission: "x", handler: () => ({ html: "x" }) }] };` }, match: /contra.*public.*permission/s },
  { name: "a nav node marked public AND permission is contradictory", files: { "contranav/plugin.ts": `export default { apiVersion: "1.0.0", nav: [{ id: "n", label: "N", public: true, permission: "x" }] };` }, match: /contranav.*public.*permission/s },
  { name: "two plugins claim the public home", files: { "a/plugin.ts": `export default { apiVersion: "1.0.0", home: () => ({ html: "a" }) };`, "b/plugin.ts": `export default { apiVersion: "1.0.0", home: () => ({ html: "b" }) };` }, match: /home/ },
  { name: "two plugins claim the gated dashboard", files: { "a/plugin.ts": `export default { apiVersion: "1.0.0", dashboard: () => ({ html: "a" }) };`, "b/plugin.ts": `export default { apiVersion: "1.0.0", dashboard: () => ({ html: "b" }) };` }, match: /dashboard/ },
];

for (const c of badCases) {
  test(`fails loud: ${c.name}`, async (t) => {
    await assert.rejects(discoverPlugins({ dir: scaffold(t, c.files) }), c.match);
  });
}

test("a route + nav node may be marked public and load fine", async (t) => {
  const dir = scaffold(t, { "pub/plugin.ts": `export default { apiVersion: "1.0.0", nav: [{ href: "/pub", id: "n", label: "N", public: true }], routes: [{ method: "GET", path: "/", public: true, handler: () => ({ html: "x" }) }] };` });
  const plugins = await discoverPlugins({ dir });
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0]?.routes?.[0]?.public, true);
  assert.equal(plugins[0]?.nav?.[0]?.public, true);
});

test("`admin` is not reserved — the admin screens ship as a drop-in plugin mounted at /admin", async (t) => {
  const dir = scaffold(t, { "admin/plugin.ts": full("admin") });
  const plugins = await discoverPlugins({ dir });
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0]?.id, "admin");
});

test("a plugin may declare `home` (public /) and `dashboard` (gated /dashboard) handlers", async (t) => {
  const dir = scaffold(t, { "portal/plugin.ts": `export default { apiVersion: "1.0.0", home: () => ({ view: "home" }), dashboard: () => ({ view: "dash" }) };` });
  const plugins = await discoverPlugins({ dir });
  assert.equal(plugins.length, 1);
  assert.equal(typeof plugins[0]?.home, "function");
  assert.equal(typeof plugins[0]?.dashboard, "function");
});

test("a shared permission token only warns — both plugins still load", async (t) => {
  const perm = `export default { apiVersion: "1.0.0", permissions: [{ token: "shared:read" }] };`;
  const dir = scaffold(t, { "x/plugin.ts": perm, "y/plugin.ts": perm });
  const warnings: string[] = [];
  const plugins = await discoverPlugins({ dir, logger: { warn: (m) => warnings.push(String(m)) } });

  assert.equal(plugins.length, 2);
  assert.ok(warnings.some((w) => /shared:read/.test(w)), "expected a permission-conflict warning");
});
