// One-command bootstrap (§3): idempotent first-boot seeding. Guards the pure payload
// builders (Kratos create-identity body + Keto role tuple), the idempotent seedAdmin
// orchestration (fresh 201 vs existing 409 → reuse id), and the JWKS generate-if-absent
// safety net. Live boot is verified by running the stack; these catch contract drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ensureJwks, firstRunBanner, identityPayload, roleTuple, seedAdmin } from "./bootstrap.ts";

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

test("roleTuple grants a role to user:<id> in the Role namespace", () => {
  const id = randomUUID();
  assert.deepEqual(roleTuple(id, "admin"), {
    namespace: "Role",
    object: "admin",
    relation: "members",
    subject_id: `user:${id}`,
  });
});

test("seedAdmin on a fresh stack creates the identity and grants the role", async () => {
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
    role: "admin",
  });

  assert.deepEqual(result, { created: true, id, role: "admin" });
  const put = calls.find((c) => c.url.includes("relation-tuples"))!;
  assert.equal(put.method, "PUT");
  assert.deepEqual(put.body, { namespace: "Role", object: "admin", relation: "members", subject_id: `user:${id}` });
});

test("seedAdmin is idempotent: a 409 reuses the existing identity and re-grants the role", async () => {
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
    role: "admin",
  });

  assert.deepEqual(result, { created: false, id, role: "admin" });
  assert.deepEqual(granted, { namespace: "Role", object: "admin", relation: "members", subject_id: `user:${id}` });
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
      role: "admin",
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
