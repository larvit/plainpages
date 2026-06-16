import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { renderPluginView, resolveViewPath } from "./view-resolver.ts";

const coreViewsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "views");

test("resolveViewPath resolves names/nested subfolders within the views dir, rejects traversal + control chars", () => {
  const dir = "/srv/plugins";
  assert.equal(resolveViewPath(dir, "demo", "page"), "/srv/plugins/demo/views/page.ejs");
  assert.equal(resolveViewPath(dir, "demo", "shifts/edit"), "/srv/plugins/demo/views/shifts/edit.ejs");
  assert.equal(resolveViewPath(dir, "demo", "page.ejs"), "/srv/plugins/demo/views/page.ejs"); // extension not doubled
  assert.equal(resolveViewPath(dir, "demo", "../../secret"), null); // traversal escapes the dir
  assert.equal(resolveViewPath(dir, "demo", "a\x00b"), null); // control char
});

test("renderPluginView: a (nested) view includes a core building-block partial and its own partial", async (t: TestContext) => {
  const pluginsDir = mkdtempSync(join(tmpdir(), "pp-views-"));
  t.after(() => rmSync(pluginsDir, { force: true, recursive: true }));
  const views = join(pluginsDir, "demo", "views");
  mkdirSync(join(views, "partials"), { recursive: true });
  mkdirSync(join(views, "sub"), { recursive: true });
  writeFileSync(join(views, "partials", "local.ejs"), "<span class=local><%= who %></span>");
  writeFileSync(
    join(views, "sub", "page.ejs"),
    `<%- include("partials/theme-switch") %><%- include("partials/local", { who }) %>`,
  );

  const render = renderPluginView({ cache: false, coreViewsDir, pluginsDir });
  const html = await render("demo", "sub/page", { who: "Plug" });
  assert.match(html, /role="radiogroup"/); // core partial, resolved from coreViewsDir
  assert.match(html, /<span class=local>Plug<\/span>/); // the plugin's own partial, with data
});

test("renderPluginView throws on an out-of-bounds view name", async () => {
  const render = renderPluginView({ cache: false, coreViewsDir, pluginsDir: "/srv/plugins" });
  await assert.rejects(render("demo", "../../etc/passwd", {}), /invalid view name/);
});
