import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createApp } from "./app.ts";
import { contentTypeFor, resolveStaticPath } from "./static.ts";

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

test("returns 404 for unknown routes", async () => {
  const res = await fetch(base + "/missing");
  assert.equal(res.status, 404);
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
