import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkApiVersion,
  definePlugin,
  findConflicts,
  HOST_API_VERSION,
  isValidPluginId,
  parseSemver,
  RESERVED_PLUGIN_IDS,
  type Plugin,
  type PluginManifest,
} from "./plugin.ts";
import { ADMIN_CLIENTS_BASE, ADMIN_GROUPS_BASE, ADMIN_ROLES_BASE, ADMIN_USERS_BASE } from "../admin/admin-nav.ts";
import { AUTH_FLOWS } from "../auth/flow-view.ts";

// A representative manifest exercising every field — its existence type-checks the contract.
// `apiVersion` is a literal: a plugin pins the version it was built against, so importing
// HOST_API_VERSION would always equal the host and defeat the check. No `id`/`basePath` — the
// host derives both from the plugin's folder name.
const scheduling: PluginManifest = definePlugin({
  apiVersion: "1.0.0",
  hooks: { onBoot: () => {} },
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

test("definePlugin returns the manifest unchanged — id/mount come from the folder, not the manifest", () => {
  const m: PluginManifest = { apiVersion: "1.0.0" };
  assert.equal(definePlugin(m), m); // identity, not a copy
  assert.equal(scheduling.routes?.length, 3);
});

test("isValidPluginId accepts lowercase/digits/dashes anywhere and rejects everything else", () => {
  for (const ok of ["scheduling", "people-directory", "people2", "v2", "people--dir", "-people", "people-", "a-1-b", "1"]) {
    assert.ok(isValidPluginId(ok), ok);
  }
  for (const bad of ["People", "people_dir", "a/b", "a.b", "a b", ""]) {
    assert.ok(!isValidPluginId(bad), bad);
  }
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

test("findConflicts: duplicate nav id is an error, a shared permission token only warns", () => {
  const navDup = findConflicts([
    p({ id: "a", nav: [{ id: "dup", label: "A" }] }),
    p({ id: "b", nav: [{ id: "dup", label: "B" }] }),
  ]);
  assert.ok(navDup.some((c) => c.kind === "nav-id" && c.level === "error" && c.plugins.includes("a") && c.plugins.includes("b")));

  // Sharing a permission across plugins is legitimate (shared role) → warn, not error.
  const permDup = findConflicts([
    p({ id: "a", permissions: [{ token: "shared:read" }] }),
    p({ id: "b", permissions: [{ token: "shared:read" }] }),
  ]);
  assert.ok(permDup.some((c) => c.kind === "permission" && c.level === "warn"));
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

// Drift guard: RESERVED_PLUGIN_IDS is a hand-maintained mirror of the host's own top-level mounts —
// a folder claiming one would silently shadow a built-in route. Derive the segments from the real
// route constants so adding a new auth flow or admin screen without reserving its id fails here.
test("RESERVED_PLUGIN_IDS covers every built-in top-level mount; `home` (the / field) is NOT reserved", () => {
  const seg = (path: string): string => path.split("/")[1] ?? ""; // first segment of "/x/y"
  const builtins = new Set<string>([
    ...Object.keys(AUTH_FLOWS).map(seg), // /login, /recovery, /registration, /settings, /verification
    seg(ADMIN_USERS_BASE), seg(ADMIN_GROUPS_BASE), seg(ADMIN_ROLES_BASE), seg(ADMIN_CLIENTS_BASE), // → admin
    "auth", // /auth/complete (login completion)
    "logout", // POST /logout
    "oauth2", // /oauth2/login · /consent · /logout (Hydra provider)
    "dashboard", // the gated app home
    "public", // static assets
  ]);
  for (const id of builtins) assert.ok(RESERVED_PLUGIN_IDS.has(id), `built-in mount "${id}" must be a reserved plugin id`);
  // "/" is owned by the `home` manifest field (not a /<id> route), so it cannot be shadowed and is
  // deliberately not reserved — a plugin folder named "home" is legal.
  assert.equal(RESERVED_PLUGIN_IDS.has("home"), false);
});
