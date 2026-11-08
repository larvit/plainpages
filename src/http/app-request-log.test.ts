import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { createLogger } from "../logger.ts";
import type { Plugin } from "../plugin-host/plugin.ts";
import { createApp } from "./app.ts";

// The `request` line, parsed, once the server has logged it (it logs on the response's close).
async function requestLineOf(lines: string[]): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i++) {
    const line = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((rec) => rec["message"] === "request" || rec["msg"] === "request");
    if (line) return line;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no request line was logged");
}

// `lines` is stdout (info); `problems` is stderr (warn and error).
async function serve(t: TestContext, trustedProxies: string[], plugins: Plugin[] = []): Promise<{ lines: string[]; problems: string[]; url: string }> {
  const lines: string[] = [];
  const problems: string[] = [];
  const log = createLogger({ format: "json", level: "info", stderr: (l: string) => problems.push(l), stdout: (l: string) => lines.push(l) });
  const app = createApp({ log, plugins, trustedProxies });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  return { lines, problems, url: `http://localhost:${(app.address() as AddressInfo).port}` };
}

test("the request line names the caller, the site and the matched route in OpenTelemetry's terms", async (t) => {
  const { lines, url } = await serve(t, []);
  await (await fetch(`${url}/?token=secret`, { headers: { "user-agent": "TV/1.0", "x-forwarded-for": "198.51.100.7" } })).text();
  const line = await requestLineOf(lines);

  assert.equal(line["http.request.method"], "GET");
  assert.equal(line["url.path"], "/"); // never the query
  assert.equal(line["http.response.status_code"], 200);
  assert.equal(line["http.route"], "/");
  assert.equal(line["server.address"], "localhost");
  assert.equal(line["user_agent.original"], "TV/1.0");
  assert.match(String(line["client.address"]), /^(127\.0\.0\.1|::1)$/); // the forged header is not believed
  assert.equal(line["service.name"], "plainpages");
  assert.ok(line["requestId"], "carries a requestId for log↔trace correlation");
  for (const old of ["method", "path", "status", "ms"]) assert.equal(line[old], undefined, old);
});

test("http.route is the full pattern, plugin prefix included, so two plugins' routes never merge", async (t) => {
  const plugin: Plugin = {
    apiVersion: "1.0.0",
    id: "demo",
    routes: [{ handler: () => ({ json: {} }), method: "GET", path: "/items/:id", public: true }],
  };
  const { lines, url } = await serve(t, [], [plugin]);
  await (await fetch(`${url}/demo/items/7`)).text();
  const line = await requestLineOf(lines);

  assert.equal(line["http.route"], "/demo/items/:id");
  assert.equal(line["url.path"], "/demo/items/7");
});

test("a listed proxy lets X-Forwarded-For name the caller; an unmatched path carries no route", async (t) => {
  const { lines, url } = await serve(t, ["127.0.0.0/8", "::1"]);
  await (await fetch(`${url}/no-such-page`, { headers: { "x-forwarded-for": "198.51.100.7" } })).text();
  const line = await requestLineOf(lines);

  assert.equal(line["client.address"], "198.51.100.7");
  assert.equal(line["http.response.status_code"], 404);
  assert.equal(line["http.route"], undefined);
});

test("an answered request goes no further: a refused visitor never reaches the handler, and nothing logs a problem", async (t) => {
  const ran: string[] = [];
  const plugin: Plugin = {
    apiVersion: "1.0.0",
    id: "demo",
    routes: [
      { handler: () => ({ html: "open" }), method: "GET", path: "/open", public: true },
      { handler: () => { ran.push("gated"); return { html: "gated" }; }, method: "GET", path: "/gated", permission: "demo:read" },
    ],
  };
  const { lines, problems, url } = await serve(t, [], [plugin]);
  // A plugin route, a refused plugin route, a built-in route, a refused built-in route, an asset.
  const paths = ["/demo/open", "/demo/gated", "/", "/dashboard", "/public/css/styles.css"];
  for (const path of paths) await (await fetch(url + path, { redirect: "manual" })).text();
  // A request that fell through to a later stage would log its error after its response closed.
  while (lines.filter((l) => l.includes('"request"')).length < paths.length) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 100));

  assert.deepEqual(ran, []);
  assert.deepEqual(problems, []);
});
