import assert from "node:assert/strict";
import { test } from "node:test";
import { findConflicts } from "./conflicts.ts";
import type { Plugin } from "./plugin.ts";

// A minimal discovered plugin (id = folder name; mount path is the derived `/<id>`), per case.
const p = (over: Partial<Plugin> & Pick<Plugin, "id">): Plugin => ({ apiVersion: "1.0.0", ...over });

test("findConflicts: a clean set has none", () => {
  assert.deepEqual(findConflicts([p({ id: "a" }), p({ id: "b" })]), []);
});

test("findConflicts: a duplicate id and a colliding route are loud errors", () => {
  const dupId = findConflicts([p({ id: "a" }), p({ id: "a" })]);
  assert.ok(dupId.some((c) => c.kind === "id" && c.level === "error"));

  // Cross-plugin routes can't collide (unique `/<id>` prefix); two identical routes in one can.
  const noop = () => {};
  const dupRoute = findConflicts([p({
    id: "a",
    routes: [{ handler: noop, method: "GET", path: "/t" }, { handler: noop, method: "GET", path: "/t" }],
  })]);
  assert.ok(dupRoute.some((c) => c.kind === "route" && c.level === "error" && c.message.includes("/a/t")));
});

test("findConflicts: duplicate nav id is an error, a shared permission name only warns", () => {
  const navDup = findConflicts([
    p({ id: "a", nav: [{ id: "dup", label: "A" }] }),
    p({ id: "b", nav: [{ id: "dup", label: "B" }] }),
  ]);
  assert.ok(navDup.some((c) => c.kind === "nav-id" && c.level === "error" && c.plugins.includes("a") && c.plugins.includes("b")));

  // Sharing a permission across plugins is legitimate → warn, not error.
  const permissionDup = findConflicts([
    p({ id: "a", permissions: [{ name: "shared:read" }] }),
    p({ id: "b", permissions: [{ name: "shared:read" }] }),
  ]);
  assert.ok(permissionDup.some((c) => c.kind === "permission" && c.level === "warn"));
});

const noopHandler = () => {};

test("findConflicts: a route, nav node or profile entry gating on a permission no plugin declares warns once per plugin and name, sorted", () => {
  const gated = findConflicts([
    p({ id: "a", nav: [{ children: [{ id: "a:x", label: "X", permission: "navonly:read" }], id: "a:root", label: "A", session: true }], routes: [
      { handler: noopHandler, method: "GET", path: "/x", permission: "routeonly:read" },
      { handler: noopHandler, method: "GET", path: "/y", permission: "both:read" },
      { handler: noopHandler, method: "POST", path: "/y", permission: "both:read" },
      { handler: noopHandler, method: "GET", path: "/z", permission: "declared:write" },
    ], permissions: [], profileMenu: [{ href: "/p", label: "P", permission: "profileonly:read" }, { href: "/q", label: "Q", session: true }, { href: "/r", label: "R", public: true }] }),
    p({ id: "b", nav: [{ id: "b:y", label: "Y", permission: "both:read" }], permissions: [{ name: "declared:write" }] }),
  ]);
  assert.ok(gated.every((c) => c.kind === "permission" && c.level === "warn"));
  assert.deepEqual(gated.map((c) => c.plugins), [["a"], ["a"], ["a"], ["a"], ["b"]]);
  assert.deepEqual(gated.map((c) => /"([^"]+:[a-z]+)"/.exec(c.message)?.[1]), ["both:read", "navonly:read", "profileonly:read", "routeonly:read", "both:read"]);
});

test("findConflicts: a gate on a permission another plugin declares, or on none, stays quiet", () => {
  assert.deepEqual(findConflicts([
    p({ id: "a", permissions: [{ name: "a:read" }], routes: [{ handler: noopHandler, method: "GET", path: "/x", permission: "a:read" }] }),
    p({ id: "b", routes: [{ handler: noopHandler, method: "GET", path: "/y", permission: "a:read" }, { handler: noopHandler, method: "GET", path: "/z", session: true }] }),
  ]), []);
});

test("findConflicts: each single slot (`home`/`dashboard`) may have one owner — two is a loud error", () => {
  const handler = () => ({ html: "x" });
  const homeDup = findConflicts([p({ id: "a", home: handler }), p({ id: "b", home: handler })]);
  assert.ok(homeDup.some((c) => c.kind === "home" && c.level === "error" && c.plugins.includes("a") && c.plugins.includes("b")));
  const dashDup = findConflicts([p({ id: "a", dashboard: handler }), p({ id: "b", dashboard: handler })]);
  assert.ok(dashDup.some((c) => c.kind === "dashboard" && c.level === "error" && c.plugins.includes("a") && c.plugins.includes("b")));
  // One owner of each (even both on one plugin) is fine.
  assert.deepEqual(findConflicts([p({ id: "a", dashboard: handler, home: handler }), p({ id: "b" })]).filter((c) => c.kind === "home" || c.kind === "dashboard"), []);
});

test("findConflicts: two settings that map to one environment variable are an error", () => {
  // `a-b` + `c` and `a` + `bC` both become A_B_C.
  const clash = findConflicts([
    p({ id: "a-b", settings: [{ key: "c", type: "string" }] }),
    p({ id: "a", settings: [{ key: "bC", type: "string" }] }),
  ]);
  assert.ok(clash.some((c) => c.kind === "setting" && c.level === "error" && c.plugins.includes("a") && c.plugins.includes("a-b")));
  assert.deepEqual(findConflicts([
    p({ id: "a", settings: [{ key: "x", type: "string" }] }),
    p({ id: "b", settings: [{ key: "x", type: "string" }] }),
  ]), []);
});

test("findConflicts: nav nodes without an id never collide, at any depth", () => {
  assert.deepEqual(findConflicts([
    p({ id: "a", nav: [{ children: [{ label: "A1" }], label: "A" }] }),
    p({ id: "b", nav: [{ children: [{ label: "B1" }], label: "B" }] }),
  ]), []);
});
