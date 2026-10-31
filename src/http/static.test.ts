import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { contentTypeFor, publicAssets, resolveStaticPath, routePublic } from "./static.ts";

const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300";

const root = mkdtempSync(join(tmpdir(), "static-test-"));
const publicDir = join(root, "public");
const pluginsDir = join(root, "plugins");
mkdirSync(join(publicDir, "css"), { recursive: true });
mkdirSync(join(pluginsDir, "demo", "public"), { recursive: true });
writeFileSync(join(publicDir, "css", "a.css"), "body { color: red }");
writeFileSync(join(pluginsDir, "demo", "public", "app.css"), ".demo {}");
const assets = publicAssets(publicDir, pluginsDir, new Set(["demo"]));
const assetHref = assets.href;

let base = "";
const server = createServer((req, res) => void assets.serve(new URL(req.url ?? "/", "http://localhost"), req, res, (err) => assert.fail(err)));
before(() => new Promise<void>((r) => server.listen(0, () => {
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  r();
})));
after(() => {
  server.close();
  rmSync(root, { force: true, recursive: true });
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

test("routePublic sends a plugin-id segment to its public/ dir, everything else to core", () => {
  const ids = new Set(["scheduling"]);
  assert.deepEqual(routePublic("scheduling/app.css", "/core", "/plugins", ids), { dir: "/plugins/scheduling/public", subPath: "app.css" });
  assert.deepEqual(routePublic("scheduling/img/logo.svg", "/core", "/plugins", ids), { dir: "/plugins/scheduling/public", subPath: "img/logo.svg" });
  assert.deepEqual(routePublic("scheduling", "/core", "/plugins", ids), { dir: "/plugins/scheduling/public", subPath: "" }); // bare /public/<id>, no file
  assert.deepEqual(routePublic("css/styles.css", "/core", "/plugins", ids), { dir: "/core", subPath: "css/styles.css" }); // not a plugin → core
});

test("assetHref versions a /public/ file, core or plugin, and leaves every other href alone", () => {
  assert.match(assetHref("/public/css/a.css"), /^\/public\/css\/a\.css\?v=[\w-]+$/);
  assert.match(assetHref("/public/demo/app.css"), /^\/public\/demo\/app\.css\?v=[\w-]+$/);
  assert.notEqual(assetHref("/public/css/a.css"), assetHref("/public/demo/app.css"));
  for (const href of ["/public/css/missing.css", "/public/css", "/public/css/a.css?x=1", "/public/css/a.css#top", "/public/..%2f..%2fetc/passwd", "/public/%E0%A4%A", "https://cdn.example/a.css", "data:image/svg+xml,<svg/>", "/elsewhere/a.css"]) {
    assert.equal(assetHref(href), href, href);
  }
});

test("assetHref changes when the file's content does", () => {
  const file = join(publicDir, "css", "changing.css");
  writeFileSync(file, "a {}");
  const first = assetHref("/public/css/changing.css");
  assert.equal(assetHref("/public/css/changing.css"), first);
  writeFileSync(file, "a { color: blue }");
  assert.notEqual(assetHref("/public/css/changing.css"), first);
});

test("a URL carrying the current version is cached for a year as immutable", async () => {
  for (const method of ["GET", "HEAD"]) {
    const res = await fetch(base + assetHref("/public/css/a.css"), { method });
    assert.equal(res.status, 200, method);
    assert.equal(res.headers.get("cache-control"), IMMUTABLE, method);
  }
  assert.equal((await fetch(base + assetHref("/public/demo/app.css"))).headers.get("cache-control"), IMMUTABLE);
});

test("an unversioned or stale-versioned URL is cached briefly, with an ETag and Last-Modified to revalidate", async () => {
  const lastModified = statSync(join(publicDir, "css", "a.css")).mtime.toUTCString();
  for (const path of ["/public/css/a.css", "/public/css/a.css?v=stale"]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.equal(await res.text(), "body { color: red }", path);
    assert.equal(res.headers.get("cache-control"), SHORT, path);
    assert.match(res.headers.get("etag") ?? "", /^"[\w-]+"$/, path);
    assert.equal(res.headers.get("last-modified"), lastModified, path);
  }
});

test("If-None-Match naming the current ETag answers 304 with no body, for GET and HEAD", async () => {
  const etag = (await fetch(base + "/public/css/a.css")).headers.get("etag") ?? "";
  for (const method of ["GET", "HEAD"]) {
    for (const ifNoneMatch of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const res = await fetch(base + "/public/css/a.css", { headers: { "if-none-match": ifNoneMatch }, method });
      assert.equal(res.status, 304, `${method} ${ifNoneMatch}`);
      assert.equal(await res.text(), "");
      assert.equal(res.headers.get("etag"), etag);
      assert.equal(res.headers.get("cache-control"), SHORT);
    }
  }
  const versioned = await fetch(base + assetHref("/public/css/a.css"), { headers: { "if-none-match": etag } });
  assert.equal(versioned.status, 304);
  assert.equal(versioned.headers.get("cache-control"), IMMUTABLE);

  assert.equal((await fetch(base + "/public/css/a.css", { headers: { "if-none-match": '"other"' } })).status, 200);
});

test("If-Modified-Since at or after the file's mtime answers 304; before it, or beside a failed If-None-Match, 200", async () => {
  const lastModified = (await fetch(base + "/public/css/a.css")).headers.get("last-modified") ?? "";
  for (const method of ["GET", "HEAD"]) {
    const res = await fetch(base + "/public/css/a.css", { headers: { "if-modified-since": lastModified }, method });
    assert.equal(res.status, 304, method);
    assert.equal(await res.text(), "");
  }
  const earlier = new Date(Date.parse(lastModified) - 1000).toUTCString();
  assert.equal((await fetch(base + "/public/css/a.css", { headers: { "if-modified-since": earlier } })).status, 200);
  assert.equal((await fetch(base + "/public/css/a.css", { headers: { "if-modified-since": "not a date" } })).status, 200);
  // RFC 9110 §13.2.2: If-None-Match, when present, decides alone.
  assert.equal((await fetch(base + "/public/css/a.css", { headers: { "if-modified-since": lastModified, "if-none-match": '"other"' } })).status, 200);
});

test("unsafe or missing paths still answer 400, 403 and 404", async () => {
  assert.equal((await fetch(base + "/public/%E0%A4%A")).status, 400);
  assert.equal((await fetch(base + "/public/..%2f..%2fetc%2fpasswd")).status, 403);
  assert.equal((await fetch(base + "/public/css/missing.css")).status, 404);
  assert.equal((await fetch(base + "/public/css")).status, 404);
});
