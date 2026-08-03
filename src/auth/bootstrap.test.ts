// One-command bootstrap: idempotent first-boot seeding. Guards the pure payload
// builders (Kratos create-identity body + Keto permission tuple), the idempotent seedAdmin
// orchestration (fresh 201 vs existing 409 → reuse id), and the JWKS generate-if-absent
// safety net. Live boot is verified by running the stack; these catch contract drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ensureJwks, firstRunBanner, identityPayload, permissionTuple, seedAdmin, seedPermissions } from "./bootstrap.ts";

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

test("permissionTuple grants a permission to identity:<id> in the Permission namespace", () => {
  const id = randomUUID();
  assert.deepEqual(permissionTuple(id, "admin"), {
    namespace: "Permission",
    object: "admin",
    relation: "granted",
    subject_id: `identity:${id}`,
  });
});

test("seedPermissions unions ADMIN_PERMISSIONS (default 'admin') with the discovered plugins' declared permissions", () => {
  // Clean clone: no ADMIN_PERMISSIONS, the scheduling plugin declares its two tokens → the demo admin
  // gets exactly today's behaviour, but derived from discovery, not hardcoded in the host.
  assert.deepEqual(seedPermissions(undefined, ["scheduling:read", "scheduling:write"]), ["admin", "scheduling:read", "scheduling:write"]);
  assert.deepEqual(seedPermissions(undefined, []), ["admin"]); // no plugins → just the base admin permission
  assert.deepEqual(seedPermissions("admin, ops ", ["inventory:read"]), ["admin", "ops", "inventory:read"]); // env trimmed + extended
  assert.deepEqual(seedPermissions("admin,scheduling:read", ["scheduling:read"]), ["admin", "scheduling:read"]); // dedup, no double grant
  assert.deepEqual(seedPermissions("admin,, ", [" scheduling:read ", ""]), ["admin", "scheduling:read"]); // blanks dropped, tokens trimmed (both sides)
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
    { namespace: "Permission", object: "admin", relation: "granted", subject_id: `identity:${id}` },
    { namespace: "Permission", object: "scheduling:read", relation: "granted", subject_id: `identity:${id}` },
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
  assert.deepEqual(granted, { namespace: "Permission", object: "admin", relation: "granted", subject_id: `identity:${id}` });
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
