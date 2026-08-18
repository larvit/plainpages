import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  { name: "a route marked public AND permission is contradictory", files: { "contra/plugin.ts": `export default { apiVersion: "1.0.0", routes: [{ method: "GET", path: "/", public: true, permission: "x:read", handler: () => ({ html: "x" }) }] };` }, match: /contra.*public.*permission/s },
  { name: "a nav node marked public AND permission is contradictory", files: { "contranav/plugin.ts": `export default { apiVersion: "1.0.0", nav: [{ id: "n", label: "N", public: true, permission: "x:read" }] };` }, match: /contranav.*public.*permission/s },
  // A permission name is <resource>:<action> wherever the manifest mentions one. Enforced here, not
  // only in the admin GUI, so it holds for a plugin installed without that GUI.
  { name: "a route gating on a bare word", files: { "bare/plugin.ts": `export default { apiVersion: "1.0.0", routes: [{ method: "GET", path: "/", permission: "admin", handler: () => ({ html: "x" }) }] };` }, match: /bare.*admin.*<resource>:<action>/s },
  { name: "a nav node gating on a bare word", files: { "barenav/plugin.ts": `export default { apiVersion: "1.0.0", nav: [{ id: "n", label: "N", permission: "admin" }] };` }, match: /barenav.*admin.*<resource>:<action>/s },
  { name: "a declared permission that is a bare word", files: { "baredecl/plugin.ts": `export default { apiVersion: "1.0.0", permissions: [{ name: "admin" }] };` }, match: /baredecl.*admin.*<resource>:<action>/s },
  { name: "a plugin shipping its own copy of the barrel", files: { "shadow/node_modules/@plainpages/plugin-api/index.js": `export class GuardError extends Error {}`, "shadow/plugin.ts": full("shadow") }, match: /shadow.*@plainpages\/plugin-api/s },
  { name: "a plugin package.json that forgets type: module", files: { "cjs/package.json": `{ "name": "cjs" }`, "cjs/plugin.ts": full("cjs") }, match: /cjs.*"type": "module"/s },
  { name: "a plugin package.json that is not valid JSON", files: { "bent/package.json": `{`, "bent/plugin.ts": full("bent") }, match: /bent.*package\.json.*JSON/s },
  { name: "a plugin package.json holding null", files: { "nul/package.json": `null`, "nul/plugin.ts": full("nul") }, match: /nul.*"type": "module"/s },
  // `npm install --prefix plugins` — the documented command with one path segment dropped.
  { name: "a package.json in the scan root itself", files: { "package.json": `{ "name": "oops" }`, "ok/plugin.ts": full("ok") }, match: /plugins\/package\.json must not exist/ },
  { name: "a node_modules in the scan root itself", files: { "node_modules/@plainpages/plugin-api/index.js": `export class GuardError extends Error {}`, "ok/plugin.ts": full("ok") }, match: /plugins\/node_modules must not exist/ },
  { name: "two plugins claim the public home", files: { "a/plugin.ts": `export default { apiVersion: "1.0.0", home: () => ({ html: "a" }) };`, "b/plugin.ts": `export default { apiVersion: "1.0.0", home: () => ({ html: "b" }) };` }, match: /home/ },
  { name: "two plugins claim the gated dashboard", files: { "a/plugin.ts": `export default { apiVersion: "1.0.0", dashboard: () => ({ html: "a" }) };`, "b/plugin.ts": `export default { apiVersion: "1.0.0", dashboard: () => ({ html: "b" }) };` }, match: /dashboard/ },
];

for (const c of badCases) {
  test(`fails loud: ${c.name}`, async (t) => {
    await assert.rejects(discoverPlugins({ dir: scaffold(t, c.files) }), c.match);
  });
}

// The reader of a discovery failure is usually an operator whose plugins/ copy went stale after an
// upgrade, not the author of the manifest — so the message has to carry the remedy, not just the
// rule. A pre-existing `plugins/admin` gating on the old `admin` permission is exactly this case.
test("a discovery failure tells the operator their plugins/ copy may just be out of date", async (t) => {
  const dir = scaffold(t, { "admin/plugin.ts": `export default { apiVersion: "1.0.0", routes: [{ method: "GET", path: "/users", permission: "admin", handler: () => ({ html: "x" }) }] };` });
  await assert.rejects(discoverPlugins({ dir }), (err: Error) => {
    assert.match(err.message, /gates on "admin"/); // what is wrong
    assert.match(err.message, /re-copy it/); // …and what to do about it
    return true;
  });
});

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

// Host deps sit at /node_modules, above every plugin scope, so the barrel resolves from a folder
// that has its own package.json (README → Plugin dependencies).
test("a plugin may carry its own package.json, node_modules and dependencies", async (t) => {
  const dir = scaffold(t, {
    "shop/package.json": `{ "name": "shop", "version": "0.0.0", "type": "module", "dependencies": { "price-tag": "1.0.0" } }`,
    "shop/node_modules/price-tag/package.json": `{ "name": "price-tag", "version": "1.0.0", "type": "module", "exports": "./index.js" }`,
    "shop/node_modules/price-tag/index.js": `export default (n) => \`\${n} kr\`;`,
    "shop/plugin.ts": `import { definePlugin } from "@plainpages/plugin-api";\nimport price from "price-tag";\n` +
      `export default definePlugin({ apiVersion: "1.0.0", routes: [{ method: "GET", path: "/", handler: () => ({ html: price(20) }) }] });`,
  });

  const plugins = await discoverPlugins({ dir });

  assert.deepEqual(plugins.map((p) => p.id), ["shop"]);
  assert.deepEqual(await plugins[0]?.routes?.[0]?.handler(null as never), { html: "20 kr" });
});

test("a plugin folder may be a symlink", async (t) => {
  const ownRepo = scaffold(t, { "my-plugin/plugin.ts": full("my-plugin") });
  const dir = scaffold(t, {});
  symlinkSync(join(ownRepo, "my-plugin"), join(dir, "linked"));

  const plugins = await discoverPlugins({ dir });

  assert.deepEqual(plugins.map((p) => p.id), ["linked"]); // the link name is the id, not the target's
});

test("a dangling plugin symlink fails loud rather than vanishing", async (t) => {
  const dir = scaffold(t, {});
  symlinkSync(join(dir, "gone"), join(dir, "broken"));

  await assert.rejects(discoverPlugins({ dir }), /broken.*plugin\.ts/s);
});

test("a shared permission name only warns — both plugins still load", async (t) => {
  const shared = `export default { apiVersion: "1.0.0", permissions: [{ name: "shared:read" }] };`;
  const dir = scaffold(t, { "x/plugin.ts": shared, "y/plugin.ts": shared });
  const warnings: string[] = [];
  const plugins = await discoverPlugins({ dir, logger: { warn: (m) => warnings.push(String(m)) } });

  assert.equal(plugins.length, 2);
  assert.ok(warnings.some((w) => /shared:read/.test(w)), "expected a permission-conflict warning");
});
