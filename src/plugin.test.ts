import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkApiVersion,
  definePlugin,
  findConflicts,
  HOST_API_VERSION,
  parseSemver,
  type Plugin,
} from "./plugin.ts";

// A representative manifest exercising every field — its existence type-checks the contract
// (handler return variants, nav fragment, permission decls, hooks). The README example.
const scheduling: Plugin = definePlugin({
  apiVersion: HOST_API_VERSION,
  basePath: "/scheduling",
  hooks: { onBoot: () => {} },
  id: "scheduling",
  nav: [{
    children: [{ href: "/scheduling/shifts", id: "scheduling:shifts", label: "Shifts", permission: "scheduling:read" }],
    icon: "i-cal", id: "scheduling:root", label: "Scheduling",
  }],
  permissions: [{ description: "View shifts", token: "scheduling:read" }],
  routes: [
    { handler: () => ({ data: { rows: [] }, view: "shifts" }), method: "GET", path: "/shifts", permission: "scheduling:read" },
    { handler: () => ({ redirect: "/scheduling/shifts" }), method: "POST", path: "/shifts", permission: "scheduling:write" },
    { handler: (ctx) => void ctx.res.end("raw"), method: "GET", path: "/raw" }, // void = handler wrote res itself
  ],
});

test("definePlugin returns the manifest unchanged — it only types; validation is at discovery (§2)", () => {
  const m: Plugin = { apiVersion: "1.0.0", basePath: "/x", id: "x" };
  assert.equal(definePlugin(m), m); // identity, not a copy
  assert.equal(scheduling.routes?.length, 3);
});

test("parseSemver follows the semver core, rejecting ranges, prefixes, leading zeros and missing parts", () => {
  assert.deepEqual(parseSemver("1.2.3"), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseSemver("1.2.3-rc.1+build.5"), { major: 1, minor: 2, patch: 3 }); // prerelease/build tolerated, ignored
  for (const bad of ["1", "1.2", "1.2.3.4", "v1.2.3", "^1.2.3", "01.2.3", "1.2.x", "1.2.3 ", "", 3, null, undefined]) {
    assert.equal(parseSemver(bad), null, `${String(bad)} is not a semver`);
  }
});

test("checkApiVersion: semver compat — equal/patch ok, older minor warns, newer-minor/major-mismatch/malformed refuse", () => {
  assert.equal(checkApiVersion(HOST_API_VERSION).level, "ok"); // "1.0.0" vs "1.0.0"
  assert.equal(checkApiVersion("1.0.5", "1.0.0").level, "ok"); // patch never affects compatibility
  assert.equal(checkApiVersion("1.0.0", "1.2.0").level, "warn"); // older minor still runs (additive), nudge to update
  assert.equal(checkApiVersion("1.3.0", "1.2.0").level, "refuse"); // needs features a newer host has
  assert.equal(checkApiVersion("2.0.0", "1.5.0").level, "refuse"); // incompatible major (newer)
  assert.equal(checkApiVersion("1.0.0", "2.0.0").level, "refuse"); // incompatible major (older)
  for (const bad of ["1", "1.2", "v1.2.3", "01.2.3", "1.2.x", "", 1, undefined, null]) {
    assert.equal(checkApiVersion(bad).level, "refuse", `${String(bad)} must refuse`);
  }
});

// Minimal valid plugin, overridable per case.
const p = (over: Partial<Plugin> & Pick<Plugin, "id" | "basePath">): Plugin =>
  definePlugin({ apiVersion: HOST_API_VERSION, ...over });

test("findConflicts: a clean set has none", () => {
  assert.deepEqual(findConflicts([p({ basePath: "/a", id: "a" }), p({ basePath: "/b", id: "b" })]), []);
});

test("findConflicts: duplicate id, overlapping basePath, and colliding route are loud errors", () => {
  const dupId = findConflicts([p({ basePath: "/a", id: "a" }), p({ basePath: "/b", id: "a" })]);
  assert.ok(dupId.some((c) => c.kind === "id" && c.level === "error"));

  const sameBase = findConflicts([p({ basePath: "/x", id: "a" }), p({ basePath: "/x", id: "b" })]);
  assert.ok(sameBase.some((c) => c.kind === "basePath" && c.level === "error"));

  // A basePath that is a path-prefix of another also overlaps (routes would shadow).
  const prefix = findConflicts([p({ basePath: "/x", id: "a" }), p({ basePath: "/x/y", id: "b" })]);
  assert.ok(prefix.some((c) => c.kind === "basePath" && c.level === "error" && c.plugins.includes("a") && c.plugins.includes("b")));

  const noop = () => {};
  const dupRoute = findConflicts([p({
    basePath: "/a", id: "a",
    routes: [{ handler: noop, method: "GET", path: "/t" }, { handler: noop, method: "GET", path: "/t" }],
  })]);
  assert.ok(dupRoute.some((c) => c.kind === "route" && c.level === "error"));
});

test("findConflicts: duplicate nav id is an error, a shared permission token only warns", () => {
  const navDup = findConflicts([
    p({ basePath: "/a", id: "a", nav: [{ id: "dup", label: "A" }] }),
    p({ basePath: "/b", id: "b", nav: [{ id: "dup", label: "B" }] }),
  ]);
  assert.ok(navDup.some((c) => c.kind === "nav-id" && c.level === "error" && c.plugins.includes("a") && c.plugins.includes("b")));

  // Sharing a permission across plugins is legitimate (shared role) → warn, not error.
  const permDup = findConflicts([
    p({ basePath: "/a", id: "a", permissions: [{ token: "shared:read" }] }),
    p({ basePath: "/b", id: "b", permissions: [{ token: "shared:read" }] }),
  ]);
  assert.ok(permDup.some((c) => c.kind === "permission" && c.level === "warn"));
});
