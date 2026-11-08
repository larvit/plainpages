import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { createLogger } from "../logger.ts";
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

async function serve(t: TestContext, trustedProxies: string[]): Promise<{ lines: string[]; url: string }> {
  const lines: string[] = [];
  const log = createLogger({ format: "json", level: "info", stderr: () => {}, stdout: (l: string) => lines.push(l) });
  const app = createApp({ log, trustedProxies });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  return { lines, url: `http://localhost:${(app.address() as AddressInfo).port}` };
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
  for (const old of ["method", "path", "status", "ms"]) assert.equal(line[old], undefined, old);
});

test("a listed proxy lets X-Forwarded-For name the caller; an unmatched path carries no route", async (t) => {
  const { lines, url } = await serve(t, ["127.0.0.0/8", "::1"]);
  await (await fetch(`${url}/no-such-page`, { headers: { "x-forwarded-for": "198.51.100.7" } })).text();
  const line = await requestLineOf(lines);

  assert.equal(line["client.address"], "198.51.100.7");
  assert.equal(line["http.response.status_code"], 404);
  assert.equal(line["http.route"], undefined);
});
