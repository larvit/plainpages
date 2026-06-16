import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";
import { createApp } from "./app.ts";
import type { Plugin } from "./plugin.ts";
import { contentTypeFor, resolveStaticPath } from "./static.ts";

const viewsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "views");

const server = createApp();
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

test("serves the home page: the app-shell People dashboard, filterable via the URL", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const html = await res.text();
  // Shell + building blocks composed around the mock data.
  assert.match(html, /Plainpages/); // sidebar brand
  assert.match(html, /<aside class="sidebar"/);
  assert.match(html, /<form class="filters"/);
  assert.match(html, /<table class="table"/);
  assert.match(html, /<footer class="pager"/);
  assert.match(html, /Avery Kline/); // a mock person on page 1

  // A search query filters server-side: a no-match query drops every row.
  const empty = await fetch(base + "/?q=zzz-no-such-person");
  assert.doesNotMatch(await empty.text(), /Avery Kline/);
});

test("serves a static file: GET sends body + content-type, HEAD sends headers only", async () => {
  const get = await fetch(base + "/public/css/styles.css");
  assert.equal(get.status, 200);
  assert.match(get.headers.get("content-type") ?? "", /text\/css/);

  const head = await fetch(base + "/public/css/styles.css", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get("content-length")) > 0);
  assert.equal((await head.text()).length, 0);
});

// Production caches compiled templates; rendering must stay correct across repeated requests.
test("renders correctly with template caching enabled", async () => {
  const app = createApp({ cache: true });
  try {
    await new Promise<void>((resolve) => app.listen(0, resolve));
    const url = `http://localhost:${(app.address() as AddressInfo).port}/`;
    for (let i = 0; i < 2; i++) {
      const res = await fetch(url);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /Plainpages/);
    }
  } finally {
    app.close();
  }
});

test("returns the 404 HTML page for unknown routes", async () => {
  const res = await fetch(base + "/missing");
  assert.equal(res.status, 404);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await res.text(), /404/);
});

test("renders the 500 HTML page when a handler throws", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pp-views-"));
  writeFileSync(join(dir, "index.ejs"), "<% throw new Error('boom'); %>");
  cpSync(join(viewsDir, "500.ejs"), join(dir, "500.ejs"));
  const app = createApp({ viewsDir: dir });
  try {
    await new Promise<void>((resolve) => app.listen(0, resolve));
    const res = await fetch(`http://localhost:${(app.address() as AddressInfo).port}/`);
    assert.equal(res.status, 500);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await res.text(), /500/);
  } finally {
    app.close();
    rmSync(dir, { force: true, recursive: true });
  }
});

// 403 has no first-party route yet (guards land in §4), so assert the template renders.
test("renders the 403 error page as HTML", async () => {
  const html = await ejs.renderFile(join(viewsDir, "403.ejs"), { title: "Forbidden" });
  assert.match(html, /403/);
  assert.match(html, /styles\.css/);
});

// A test plugin exercising each RouteResult shape, a path param, and the permission gate.
const demoPlugin: Plugin = {
  apiVersion: "1.0.0",
  id: "demo",
  routes: [
    { handler: (ctx) => ({ html: `<p>Hi ${ctx.params.name}</p>` }), method: "GET", path: "/hello/:name" },
    { handler: () => ({ json: { ok: true } }), method: "GET", path: "/data" },
    { handler: () => ({ redirect: "/demo/hello/world" }), method: "POST", path: "/go" },
    { handler: () => ({ html: "secret" }), method: "GET", path: "/secret", permission: "demo:read" },
    { handler: () => ({ data: { who: "Plainpages" }, view: "page" }), method: "GET", path: "/page" },
  ],
};

async function startApp(t: TestContext, plugins: Plugin[], pluginsDir?: string): Promise<string> {
  const app = createApp(pluginsDir ? { plugins, pluginsDir } : { plugins });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  return `http://localhost:${(app.address() as AddressInfo).port}`;
}

test("mounts plugin routes: params, html/json/redirect/view results, and the permission gate", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pp-plugins-"));
  mkdirSync(join(dir, "demo", "views"), { recursive: true });
  // The view also include()s a core building-block partial, proving plugin views reuse them.
  writeFileSync(join(dir, "demo", "views", "page.ejs"), `<h1>Hello <%= who %></h1><%- include("partials/theme-switch") %>`);
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const url = await startApp(t, [demoPlugin], dir);

  // Path param + html
  const hi = await fetch(url + "/demo/hello/world");
  assert.equal(hi.status, 200);
  assert.match(await hi.text(), /Hi world/);

  // json
  const data = await fetch(url + "/demo/data");
  assert.match(data.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await data.json(), { ok: true });

  // redirect (POST → 303 Location)
  const go = await fetch(url + "/demo/go", { method: "POST", redirect: "manual" });
  assert.equal(go.status, 303);
  assert.equal(go.headers.get("location"), "/demo/hello/world");

  // view rendered from the plugin's own views/, including a core partial
  const page = await (await fetch(url + "/demo/page")).text();
  assert.match(page, /Hello Plainpages/);
  assert.match(page, /role="radiogroup"/); // core partials/theme-switch resolved

  // gated route with no session → 403
  assert.equal((await fetch(url + "/demo/secret")).status, 403);

  // known path + wrong method → 405 with Allow; unknown path → 404
  const wrong = await fetch(url + "/demo/data", { method: "DELETE" });
  assert.equal(wrong.status, 405);
  assert.match(wrong.headers.get("allow") ?? "", /GET/);
  assert.equal((await fetch(url + "/demo/nope")).status, 404);
});

test("rejects unsafe static request paths (encoded traversal, NUL) with 403", async () => {
  assert.equal((await fetch(base + "/public/..%2f..%2fapp.ts")).status, 403);
  assert.equal((await fetch(base + "/public/%00")).status, 403);
});

test("resolveStaticPath blocks traversal and control chars, allows nested files", () => {
  assert.equal(resolveStaticPath("/srv/public", "../app.ts"), null);
  assert.equal(resolveStaticPath("/srv/public", "a\x00b"), null);
  assert.equal(resolveStaticPath("/srv/public", "css/styles.css"), "/srv/public/css/styles.css");
});

test("contentTypeFor maps known and unknown extensions", () => {
  assert.match(contentTypeFor("a.css"), /text\/css/);
  assert.equal(contentTypeFor("a.bin"), "application/octet-stream");
});
