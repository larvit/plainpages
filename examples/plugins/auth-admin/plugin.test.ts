// The manifest's own invariants. A route gating on a permission the manifest doesn't declare is
// silent: bootstrap seeds only declared names, so the demo admin would simply 403 on that screen
// with nothing in the logs to explain it. Pin the two halves against each other here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidPermissionName } from "@plainpages/plugin-api";
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

// A nav permission is a plain string the host matches against the JWT claim: a typo ("user:read")
// passes discovery's shape check and silently hides that menu item forever. Same silent-failure
// class the route checks above close, so close it on the nav side too.
test("every nav permission is one the manifest declares", () => {
  const navPermissions: string[] = [];
  const walk = (nodes: typeof manifest.nav): void => {
    for (const node of nodes ?? []) {
      if (node.permission != null) navPermissions.push(node.permission);
      walk(node.children);
    }
  };
  walk(manifest.nav);
  assert.equal(navPermissions.length, 4);
  for (const name of navPermissions) assert.ok(declared.includes(name), `nav gates on undeclared ${name}`);
});

test("every declared permission is <resource>:<action>, and reads and writes are split per resource", () => {
  for (const name of declared) assert.ok(isValidPermissionName(name), name); // the host's rule, not a copy of it
  // Three CRUD screens × read/write, plus read-only plugin settings — a screen that never writes
  // declares no `:write`, since a permission nothing gates on is one an operator can only mis-grant.
  // There is deliberately no `permissions:` pair either: permissions are declared in plugin code, so
  // holding one is edited on the user or group that holds it.
  assert.deepEqual([...declared].sort(), [
    "groups:read", "groups:write",
    "oauth2-clients:read", "oauth2-clients:write",
    "plugin-settings:read",
    "users:read", "users:write",
  ]);
});

test("GET routes gate on read and mutations on write, so a reader can open a screen but not change it", () => {
  // …except a write-intent GET — a create form or a delete-confirm page, which exists only to start a
  // write. Those gate on `:write` so a reader is refused there rather than at the submit.
  const writeIntent = (path: string): boolean => path.endsWith("/new") || path.endsWith("/delete");
  for (const route of routes) {
    const action = route.method === "GET" && !writeIntent(route.path) ? "read" : "write";
    assert.ok(route.permission?.endsWith(`:${action}`), `${route.method} ${route.path} → ${route.permission}`);
  }
  assert.equal(routes.filter((r) => r.method === "GET" && writeIntent(r.path)).length, 6); // 2 per CRUD screen; plugin settings has none
});
