// One-command bootstrap: idempotent first-boot seeding. Guards the pure payload
// builders (Kratos create-identity body + Keto permission tuple), the idempotent seedAdmin
// orchestration (fresh 201 vs existing 409 → reuse id), and the JWKS generate-if-absent
// safety net. Live boot is verified by running the stack; these catch contract drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { differentServer, ensureJwks, firstRunBanner, identityPayload, permissionTuple, provisionPluginStorage, seedAdmin, seedPermissions } from "./bootstrap.ts";
import { createLogger } from "../logger.ts";
import type { Plugin } from "../plugin-host/plugin.ts";
import type { ProvisionOptions, ProvisionResult } from "../plugin-host/storage-provisioning.ts";

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("identityPayload is a valid Kratos create-identity body with a password credential", () => {
  const body = identityPayload("admin@plainpages.local", "admin");
  assert.equal(body.schema_id, "default");
  assert.equal(body.traits.email, "admin@plainpages.local");
  assert.equal(body.credentials.password.config.password, "admin");
});

test("permissionTuple grants a permission to user:<id> in the Permission namespace", () => {
  const id = randomUUID();
  assert.deepEqual(permissionTuple(id, "admin"), {
    namespace: "Permission",
    object: "admin",
    relation: "granted",
    subject_id: `user:${id}`,
  });
});

test("seedPermissions unions ADMIN_PERMISSIONS (empty by default) with the discovered plugins' declared permissions", () => {
  // Clean clone: no ADMIN_PERMISSIONS, the scheduling plugin declares its two names → the demo admin
  // holds exactly what the installed plugins gate on, derived from discovery, not hardcoded here.
  const names = (env: string | undefined, declared: string[]): string[] => seedPermissions(env, declared).permissions;
  assert.deepEqual(names(undefined, ["scheduling:read", "scheduling:write"]), ["scheduling:read", "scheduling:write"]);
  // No plugins → nothing to grant. A host-invented base would be a permission that gates nothing.
  assert.deepEqual(names(undefined, []), []);
  assert.deepEqual(names("ops:read, ops:write ", ["inventory:read"]), ["ops:read", "ops:write", "inventory:read"]); // env trimmed + extended
  assert.deepEqual(names("scheduling:read", ["scheduling:read"]), ["scheduling:read"]); // dedup, no double grant
  assert.deepEqual(names(",, ", [" scheduling:read ", ""]), ["scheduling:read"]); // blanks dropped, names trimmed (both sides)
});

// Bootstrap gates `web`, so it must never refuse to start over operator env — a leftover
// ADMIN_PERMISSIONS would otherwise brick the whole stack. Drop what it can't use, report it, seed
// the rest.
test("seedPermissions drops an ADMIN_PERMISSIONS name that isn't <resource>:<action>, and never throws", () => {
  const legacy = seedPermissions("admin", ["users:read"]);
  assert.deepEqual(legacy, { ignored: ["admin"], permissions: ["users:read"] });

  const mixed = seedPermissions("admin, ops:read ,Bad Name", ["users:read"]);
  assert.deepEqual(mixed, { ignored: ["admin", "Bad Name"], permissions: ["ops:read", "users:read"] });

  // Whatever an operator puts there, the boot survives it — that is the property, not the parsing.
  for (const value of ["admin", "Bad Name", ":", "::", "a".repeat(200), ",,,", "ADMIN", "1"]) {
    assert.doesNotThrow(() => seedPermissions(value, ["users:read"]), value);
    assert.deepEqual(seedPermissions(value, ["users:read"]).permissions.includes("users:read"), true, value);
  }
});

test("seedAdmin on a fresh stack creates the identity and grants every permission (one tuple each)", async () => {
  const id = randomUUID();
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchImpl = (async (url, init) => {
    const u = String(url);
    calls.push({ method: init?.method ?? "GET", url: u, body: init?.body && JSON.parse(String(init.body)) });
    if (u.endsWith("/admin/identities")) return json(201, { id });
    if (u.includes("/admin/relation-tuples")) return json(201, {});
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  const result = await seedAdmin({
    email: "admin@plainpages.local",
    fetchImpl,
    ketoWriteUrl: "http://keto:4467",
    kratosAdminUrl: "http://kratos:4434",
    password: "admin",
    permissions: ["admin", "scheduling:read"],
  });

  assert.deepEqual(result, { created: true, id, permissions: ["admin", "scheduling:read"] });
  const puts = calls.filter((c) => c.url.includes("relation-tuples"));
  assert.equal(puts.length, 2); // one grant per permission
  assert.ok(puts.every((p) => p.method === "PUT"));
  assert.deepEqual(puts.map((p) => p.body), [
    { namespace: "Permission", object: "admin", relation: "granted", subject_id: `user:${id}` },
    { namespace: "Permission", object: "scheduling:read", relation: "granted", subject_id: `user:${id}` },
  ]);
});

test("seedAdmin is idempotent: a 409 reuses the existing identity and re-grants the permission", async () => {
  const id = randomUUID();
  let granted: unknown;
  const fetchImpl = (async (url, init) => {
    const u = String(url);
    if (u.endsWith("/admin/identities") && init?.method === "POST") return json(409, { error: { code: 409 } });
    if (u.includes("/admin/identities?")) return json(200, [{ id, traits: { email: "admin@plainpages.local" } }]);
    if (u.includes("/admin/relation-tuples")) {
      granted = JSON.parse(String(init?.body));
      return json(201, {});
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  const result = await seedAdmin({
    email: "admin@plainpages.local",
    fetchImpl,
    ketoWriteUrl: "http://keto:4467",
    kratosAdminUrl: "http://kratos:4434",
    password: "admin",
    permissions: ["admin"],
  });

  assert.deepEqual(result, { created: false, id, permissions: ["admin"] });
  assert.deepEqual(granted, { namespace: "Permission", object: "admin", relation: "granted", subject_id: `user:${id}` });
});

test("seedAdmin fails loud on an unexpected Kratos error", async () => {
  const fetchImpl = (async () => json(500, { error: "boom" })) as typeof fetch;
  await assert.rejects(
    seedAdmin({
      email: "admin@plainpages.local",
      fetchImpl,
      ketoWriteUrl: "http://keto:4467",
      kratosAdminUrl: "http://kratos:4434",
      password: "admin",
      permissions: ["admin"],
    }),
    /Kratos/,
  );
});

test("firstRunBanner prints the login URL, seeded creds, and a change-before-production warning", () => {
  const banner = firstRunBanner({ appUrl: "http://localhost:3000", email: "admin@plainpages.local", password: "admin" });
  assert.match(banner, /http:\/\/localhost:3000/);
  assert.match(banner, /admin@plainpages\.local/);
  assert.match(banner, /admin/); // the password
  assert.match(banner, /before production/i);
});

test("ensureJwks generates a key only when the file is absent", () => {
  const writes: { content: string; path: string }[] = [];
  const write = (path: string, content: string) => writes.push({ content, path });
  const path = "/etc/config/kratos/tokenizer/jwks.json";

  assert.equal(ensureJwks(path, { exists: () => false, write }), true);
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0]!.content).keys.length, 1); // a real ES256 key landed

  assert.equal(ensureJwks(path, { exists: () => true, write }), false);
  assert.equal(writes.length, 1); // present → nothing written
});

// --- Plugin storage provisioning -----------------------------------------------------
// The provisioner is injected, so the branch decisions are testable without a Postgres.

const SILENT = createLogger({ level: "none" });
const storagePlugin = (id: string): Plugin => ({ apiVersion: "1.0.0", id, storage: true });
const EMPTY: ProvisionResult = { orphans: [], provisioned: [] };

function recordingProvisioner(result: ProvisionResult = EMPTY) {
  const calls: ProvisionOptions[] = [];
  return { calls, provision: async (options: ProvisionOptions) => { calls.push(options); return result; } };
}

test("provisioning is skipped entirely when nothing declares storage and none is configured", async () => {
  const { calls, provision } = recordingProvisioner();
  await provisionPluginStorage({}, [{ apiVersion: "1.0.0", id: "plain" }], SILENT, provision);
  assert.deepEqual(calls, []); // no connection attempted, so an unconfigured stack still boots
});

// Uninstalling the last storage plugin is exactly when a left-behind database needs naming.
test("provisioning still runs with nothing to provision, so orphans are reported", async () => {
  const { calls, provision } = recordingProvisioner({ orphans: ["plugin_gone"], provisioned: [] });
  await provisionPluginStorage({ PLUGIN_DB_ADMIN_URL: "postgres://ory:ory@db:5432/ory" }, [], SILENT, provision);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.pluginIds, []);
});

test("a plugin declaring storage without a provisioning DSN fails loud, naming the plugin", async () => {
  const { calls, provision } = recordingProvisioner();
  await assert.rejects(
    provisionPluginStorage({}, [storagePlugin("things")], SILENT, provision),
    /PLUGIN_DB_ADMIN_URL.*things/s,
  );
  assert.deepEqual(calls, []);
});

test("the connection limit and derived secret reach the provisioner", async () => {
  const { calls, provision } = recordingProvisioner();
  const env = { PLUGIN_DB_ADMIN_URL: "postgres://ory:ory@db:5432/ory", PLUGIN_DB_CONNECTION_LIMIT: "25", PLUGIN_DB_SECRET: "real" };
  await provisionPluginStorage(env, [storagePlugin("things")], SILENT, provision);
  assert.equal(calls[0]?.connectionLimit, 25);
  assert.equal(calls[0]?.secret, "real");
  assert.deepEqual(calls[0]?.pluginIds, ["things"]);
});

// bootstrap creates the role on one server; web tells the plugin to connect to another. Left
// unchecked it surfaces inside a plugin as "password authentication failed", naming neither.
test("provisioning refuses when the two storage URLs name different servers", async () => {
  const { calls, provision } = recordingProvisioner();
  const env = { PLUGIN_DB_ADMIN_URL: "postgres://ory:ory@db-a:5432/ory", PLUGIN_DB_URL: "postgres://db-b:5432" };
  await assert.rejects(provisionPluginStorage(env, [storagePlugin("things")], SILENT, provision), /one server.*db-a:5432 vs db-b:5432/s);
  assert.deepEqual(calls, []);
});

test("the same server spelled with an implicit port still agrees", () => {
  assert.equal(differentServer("postgres://ory:ory@db:5432/ory", "postgres://db"), null); // 5432 is the default
  assert.equal(differentServer("postgres://ory:ory@db:5432/ory", undefined), null); // web's own boot error to raise
  assert.equal(differentServer("postgres://ory:ory@db:5432/ory", "postgres://db:6543"), "db:5432 vs db:6543");
});
