import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";
import { createApp } from "./app.ts";
import { contentTypeFor, resolveStaticPath } from "./static.ts";

const viewsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "views");

const server = createApp();
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

test("serves the home page as HTML", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await res.text(), /Plainpages/);
});

test("serves static CSS", async () => {
  const res = await fetch(base + "/public/css/style.css");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/css/);
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
  assert.match(html, /style\.css/);
});

test("blocks encoded path traversal out of /public/ with 403", async () => {
  const res = await fetch(base + "/public/..%2f..%2fapp.ts");
  assert.equal(res.status, 403);
});

test("rejects a control char (NUL) in a static path with 403", async () => {
  const res = await fetch(base + "/public/%00");
  assert.equal(res.status, 403);
});

test("HEAD on a static file sends headers but no body", async () => {
  const res = await fetch(base + "/public/css/style.css", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.ok(Number(res.headers.get("content-length")) > 0);
  assert.equal((await res.text()).length, 0);
});

test("resolveStaticPath blocks traversal and control chars, allows nested files", () => {
  assert.equal(resolveStaticPath("/srv/public", "../app.ts"), null);
  assert.equal(resolveStaticPath("/srv/public", "a\x00b"), null);
  assert.equal(resolveStaticPath("/srv/public", "css/style.css"), "/srv/public/css/style.css");
});

test("contentTypeFor maps known and unknown extensions", () => {
  assert.match(contentTypeFor("a.css"), /text\/css/);
  assert.equal(contentTypeFor("a.bin"), "application/octet-stream");
});
