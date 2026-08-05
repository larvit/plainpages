// The manifest's own invariants. A route gating on a permission the manifest doesn't declare is
// silent: bootstrap seeds only declared names, so the demo admin would simply 403 on that screen
// with nothing in the logs to explain it. Pin the two halves against each other here.
import assert from "node:assert/strict";
import { test } from "node:test";
import manifest from "./plugin.ts";

const routes = manifest.routes ?? [];
const declared = (manifest.permissions ?? []).map((p) => p.name);

test("every route is gated, and gates on a permission the manifest declares", () => {
  assert.ok(routes.length > 0);
  for (const route of routes) {
    assert.equal(route.public, undefined, `${route.method} ${route.path} must not be public`);
    assert.ok(route.permission, `${route.method} ${route.path} has no permission`);
    assert.ok(declared.includes(route.permission!), `${route.method} ${route.path} gates on undeclared ${route.permission}`);
  }
});

test("the manifest declares no permission it never gates on", () => {
  const gated = new Set(routes.map((r) => r.permission));
  for (const name of declared) assert.ok(gated.has(name), `declared but unused: ${name}`);
});

test("every declared permission is <resource>:<action>, and reads and writes are split per resource", () => {
  for (const name of declared) assert.match(name, /^[a-z0-9][a-z0-9_-]*:(read|write)$/, name);
  assert.deepEqual([...declared].sort(), [
    "groups:read", "groups:write",
    "oauth2-clients:read", "oauth2-clients:write",
    "permissions:read", "permissions:write",
    "users:read", "users:write",
  ]);
});

test("GET routes gate on read and mutations on write, so a reader can open a screen but not change it", () => {
  for (const route of routes) {
    const action = route.method === "GET" ? "read" : "write";
    assert.ok(route.permission?.endsWith(`:${action}`), `${route.method} ${route.path} → ${route.permission}`);
  }
});
