// Guards the per-plugin storage rules: the shared database/role name, the derived password, the DSN
// a plugin receives and the provisioning statements. The integration test runs only when a superuser
// DSN is supplied, so the unit suite needs no Postgres.
import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import {
  buildCredentials,
  derivePassword,
  isValidStoragePluginId,
  MAX_STORAGE_PLUGIN_ID,
  provisionSql,
  provisionStorage,
  quoteIdentifier,
  quoteLiteral,
  storageName,
} from "./storage.ts";

const SECRET = "a-test-secret";

test("the database and the role share one plugin_-prefixed name", () => {
  assert.equal(storageName("things"), "plugin_things");
  assert.equal(storageName("my-plugin"), "plugin_my-plugin");
});

test("a storage plugin's id must leave the identifier under Postgres' 63 bytes", () => {
  assert.equal(MAX_STORAGE_PLUGIN_ID, 56); // 63 - "plugin_"
  assert.ok(isValidStoragePluginId("a".repeat(MAX_STORAGE_PLUGIN_ID)));
  assert.ok(!isValidStoragePluginId("a".repeat(MAX_STORAGE_PLUGIN_ID + 1)));
});

test("the password is derived, so the same one is reachable without storing it", () => {
  const derived = derivePassword(SECRET, "things");
  assert.equal(derived, derivePassword(SECRET, "things"));
  assert.notEqual(derived, derivePassword(SECRET, "other"));
  assert.notEqual(derived, derivePassword("a-rotated-secret", "things"));
  assert.match(derived, /^[A-Za-z0-9_-]{43}$/); // base64url of 32 bytes — needs no escaping in a DSN
});

test("credentials name the plugin's own database, user and password", () => {
  const credentials = buildCredentials("postgres://postgres:5432", "things", SECRET);
  assert.deepEqual(credentials, {
    database: "plugin_things",
    host: "postgres",
    password: derivePassword(SECRET, "things"),
    port: 5432,
    url: `postgres://plugin_things:${derivePassword(SECRET, "things")}@postgres:5432/plugin_things`,
    user: "plugin_things",
  });
});

test("the base URL's connection parameters survive into the DSN", () => {
  const credentials = buildCredentials("postgres://db.example?sslmode=require", "things", SECRET);
  assert.equal(credentials.port, 5432); // absent ⇒ Postgres' default, never NaN
  assert.equal(credentials.host, "db.example");
  assert.match(credentials.url, /@db\.example\/plugin_things\?sslmode=require$/);
});

test("quoting doubles an embedded quote", () => {
  assert.equal(quoteIdentifier('we"ird'), '"we""ird"');
  assert.equal(quoteLiteral("we'ird"), "'we''ird'");
});

test("provisioning creates the role and the database when neither exists", () => {
  assert.deepEqual(provisionSql("plugin_things", "pw", { databaseExists: false, roleExists: false }), [
    `CREATE ROLE "plugin_things" LOGIN PASSWORD 'pw'`,
    `CREATE DATABASE "plugin_things" OWNER "plugin_things"`,
    `REVOKE ALL ON DATABASE "plugin_things" FROM PUBLIC`,
    `GRANT ALL PRIVILEGES ON DATABASE "plugin_things" TO "plugin_things"`,
  ]);
});

test("re-provisioning re-sets the password and creates nothing twice", () => {
  assert.deepEqual(provisionSql("plugin_things", "rotated", { databaseExists: true, roleExists: true }), [
    `ALTER ROLE "plugin_things" WITH LOGIN PASSWORD 'rotated'`,
    `REVOKE ALL ON DATABASE "plugin_things" FROM PUBLIC`,
    `GRANT ALL PRIVILEGES ON DATABASE "plugin_things" TO "plugin_things"`,
  ]);
});

// --- Integration: the statements above, against a real Postgres -----------------------
// Opt-in via PLUGIN_DB_ADMIN_URL (a superuser DSN); the unit gate runs no Postgres. What the unit
// tests cannot prove lives here: the owner may create tables, and a peer role is locked out.

const ADMIN_URL = process.env["PLUGIN_DB_ADMIN_URL"] ?? "";
const integration = ADMIN_URL ? {} : { skip: "set PLUGIN_DB_ADMIN_URL to a superuser DSN to run" };

function baseUrlOf(adminUrl: string): string {
  const url = new URL(adminUrl);
  url.username = "";
  url.password = "";
  url.pathname = "";
  return url.href;
}

async function queryAs(url: string, statement: string): Promise<unknown> {
  const sql = postgres(url, { connect_timeout: 10, max: 1, onnotice: () => {} });
  try {
    return await sql.unsafe(statement);
  } finally {
    await sql.end();
  }
}

test("provisions a database its plugin can use and a peer plugin cannot reach", integration, async () => {
  const ids = ["storage-itest-a", "storage-itest-b"];
  const base = baseUrlOf(ADMIN_URL);
  const admin = postgres(ADMIN_URL, { connect_timeout: 10, max: 1, onnotice: () => {} });
  try {
    await provisionStorage({ adminUrl: ADMIN_URL, pluginIds: ids, secret: SECRET });

    const owner = buildCredentials(base, "storage-itest-a", SECRET);
    await queryAs(owner.url, "CREATE TABLE IF NOT EXISTS notes (body text)");
    await queryAs(owner.url, "INSERT INTO notes (body) VALUES ('persisted')");
    const rows = (await queryAs(owner.url, "SELECT body FROM notes")) as { body: string }[];
    assert.deepEqual(rows.map((row) => row.body), ["persisted"]);

    // A peer holds valid credentials for its OWN database and still cannot reach this one.
    const peer = new URL(buildCredentials(base, "storage-itest-b", SECRET).url);
    peer.pathname = `/${storageName("storage-itest-a")}`;
    await assert.rejects(queryAs(peer.href, "SELECT 1"), /permission denied|not permitted/i);

    // Re-running is idempotent, and a rotated secret lands on the existing role.
    await provisionStorage({ adminUrl: ADMIN_URL, pluginIds: ids, secret: "a-rotated-secret" });
    const rotated = buildCredentials(base, "storage-itest-a", "a-rotated-secret");
    const kept = (await queryAs(rotated.url, "SELECT body FROM notes")) as { body: string }[];
    assert.deepEqual(kept.map((row) => row.body), ["persisted"]); // rotating the secret keeps the data
    await assert.rejects(queryAs(owner.url, "SELECT 1"), /password authentication failed/i);
  } finally {
    for (const id of ids) {
      const name = quoteIdentifier(storageName(id));
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.unsafe(`DROP ROLE IF EXISTS ${name}`);
    }
    await admin.end();
  }
});
