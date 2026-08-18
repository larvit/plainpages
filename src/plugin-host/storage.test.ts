// Guards the per-plugin storage rules: the shared database/role name, the derived password, the DSN
// a plugin receives and the provisioning statements. The integration test runs only when a superuser
// DSN is supplied, so the unit suite needs no Postgres.
import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { provisionStorage } from "./storage-provisioning.ts";
import {
  buildCredentials,
  derivePassword,
  isValidStoragePluginId,
  MAX_STORAGE_PLUGIN_ID_LENGTH,
  orphanNames,
  provisionSql,
  quoteIdentifier,
  quoteLiteral,
  storageName,
  storagePluginIds,
} from "./storage.ts";

const SECRET = "a-test-secret";

test("the database and the role share one plugin_-prefixed name", () => {
  assert.equal(storageName("things"), "plugin_things");
  assert.equal(storageName("my-plugin"), "plugin_my-plugin");
});

test("a storage plugin's id must leave the identifier under Postgres' 63 bytes", () => {
  assert.equal(MAX_STORAGE_PLUGIN_ID_LENGTH, 56); // 63 - "plugin_"
  assert.ok(isValidStoragePluginId("a".repeat(MAX_STORAGE_PLUGIN_ID_LENGTH)));
  assert.ok(!isValidStoragePluginId("a".repeat(MAX_STORAGE_PLUGIN_ID_LENGTH + 1)));
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

// No NOSUPERUSER: naming it in an ALTER is superuser-only, so re-asserting it would break every
// boot after the first under the least-privilege account the README recommends.
const ATTRIBUTES = "LOGIN NOCREATEDB NOCREATEROLE CONNECTION LIMIT 10";

test("only the plugins that asked for storage are provisioned", () => {
  assert.deepEqual(
    storagePluginIds([{ apiVersion: "1.0.0", id: "a", storage: true }, { apiVersion: "1.0.0", id: "b" }, { apiVersion: "1.0.0", id: "c", storage: true }]),
    ["a", "c"],
  );
});

test("an orphan is a plugin_ database no installed plugin claims", () => {
  const existing = ["plugin_gone", "plugin_here", "kratos", "ory"];
  assert.deepEqual(orphanNames(existing, ["plugin_here"]), ["plugin_gone"]); // Ory's are not ours to report
  assert.deepEqual(orphanNames(existing, ["plugin_here", "plugin_gone"]), []);
});

test("provisioning creates the role and the database when neither exists", () => {
  const plan = { connectionLimit: 10, databaseExists: false, name: "plugin_things", password: "pw", roleExists: false };
  assert.deepEqual(provisionSql(plan), [
    `CREATE ROLE "plugin_things" ${ATTRIBUTES} PASSWORD 'pw'`,
    `GRANT "plugin_things" TO CURRENT_USER`, // else a CREATEROLE (non-superuser) account cannot own it
    `CREATE DATABASE "plugin_things" OWNER "plugin_things"`,
    `REVOKE ALL ON DATABASE "plugin_things" FROM PUBLIC`,
    `GRANT ALL PRIVILEGES ON DATABASE "plugin_things" TO "plugin_things"`,
  ]);
});

// Re-asserting the attributes, not just the password, is what makes "idempotent" mean the role
// cannot drift — a CREATEDB granted by hand out of band is taken back on the next boot.
test("re-provisioning re-asserts every attribute and creates nothing twice", () => {
  const plan = { connectionLimit: 10, databaseExists: true, name: "plugin_things", password: "rotated", roleExists: true };
  assert.deepEqual(provisionSql(plan), [
    `ALTER ROLE "plugin_things" WITH ${ATTRIBUTES} PASSWORD 'rotated'`,
    `REVOKE ALL ON DATABASE "plugin_things" FROM PUBLIC`,
    `GRANT ALL PRIVILEGES ON DATABASE "plugin_things" TO "plugin_things"`,
  ]);
});

// The limit is interpolated unquoted, and Postgres reads a negative one as "unlimited".
test("a connection limit that is not a positive integer is refused, not interpolated", () => {
  const plan = { databaseExists: false, name: "plugin_things", password: "pw", roleExists: false };
  for (const connectionLimit of [1.5, 0, -1, Number.NaN]) {
    assert.throws(() => provisionSql({ ...plan, connectionLimit }), /positive integer/, `for ${connectionLimit}`);
  }
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

// Drops what a previous run may have left behind: `finally` does not survive a SIGKILL or a
// cancelled CI job, and the leftovers would otherwise fail every later run on the same server.
async function dropStorage(admin: postgres.Sql, ids: string[]): Promise<void> {
  for (const id of ids) {
    const name = quoteIdentifier(storageName(id));
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.unsafe(`DROP ROLE IF EXISTS ${name}`);
  }
}

test("provisions a database its plugin can use and a peer plugin cannot reach", integration, async () => {
  const ids = ["storage-itest-a", "storage-itest-b"];
  const base = baseUrlOf(ADMIN_URL);
  const admin = postgres(ADMIN_URL, { connect_timeout: 10, max: 1, onnotice: () => {} });
  try {
    await dropStorage(admin, ids);
    await provisionStorage({ adminUrl: ADMIN_URL, connectionLimit: 10, pluginIds: ids, secret: SECRET });

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
    const rerun = await provisionStorage({ adminUrl: ADMIN_URL, connectionLimit: 10, pluginIds: ids, secret: "a-rotated-secret" });
    // Scoped to this test's own ids: another plugin's database on the same server is not this
    // test's business, and asserting otherwise would make the suite order-dependent.
    for (const id of ids) assert.ok(!rerun.orphans.includes(storageName(id)), `${id} is still installed`);
    const rotated = buildCredentials(base, "storage-itest-a", "a-rotated-secret");
    const kept = (await queryAs(rotated.url, "SELECT body FROM notes")) as { body: string }[];
    assert.deepEqual(kept.map((row) => row.body), ["persisted"]); // rotating the secret keeps the data
    await assert.rejects(queryAs(owner.url, "SELECT 1"), /password authentication failed/i);

    // Uninstalling drops nothing, so what is left behind must be named — including when the LAST
    // storage plugin goes and there is nothing left to provision.
    const uninstalled = await provisionStorage({ adminUrl: ADMIN_URL, connectionLimit: 10, pluginIds: [], secret: "a-rotated-secret" });
    for (const id of ids) assert.ok(uninstalled.orphans.includes(storageName(id)), `${id}'s database is reported`);
  } finally {
    try {
      await dropStorage(admin, ids);
    } finally {
      await admin.end({ timeout: 5 }); // its own finally, or a failed DROP leaks the connection
    }
  }
});

// README tells an operator CREATEDB + CREATEROLE is enough and superuser is more than it needs.
// That is a promise about their production credentials, so prove it rather than assert it.
test("provisions through a CREATEDB + CREATEROLE account, without superuser", integration, async () => {
  const pluginId = "storage-itest-lowpriv";
  const provisioner = "storage-itest-provisioner";
  const admin = postgres(ADMIN_URL, { connect_timeout: 10, max: 1, onnotice: () => {} });
  try {
    // The fresh provisioner below holds no ADMIN option on a role an earlier run left behind, so a
    // leftover would fail the ALTER branch rather than the code being wrong.
    await dropStorage(admin, [pluginId]);
    await admin.unsafe(`DROP ROLE IF EXISTS ${quoteIdentifier(provisioner)}`);
    await admin.unsafe(`CREATE ROLE ${quoteIdentifier(provisioner)} LOGIN CREATEDB CREATEROLE PASSWORD 'itest-provisioner'`);
    const asProvisioner = new URL(ADMIN_URL);
    asProvisioner.username = provisioner;
    asProvisioner.password = "itest-provisioner";
    const provision = () => provisionStorage({ adminUrl: asProvisioner.href, connectionLimit: 10, pluginIds: [pluginId], secret: SECRET });
    await provision();
    // Twice: the second run takes the ALTER branch, where naming a superuser-only attribute would
    // fail — i.e. every redeploy after the one that worked.
    await provision();

    const owner = buildCredentials(baseUrlOf(ADMIN_URL), pluginId, SECRET);
    await queryAs(owner.url, "CREATE TABLE IF NOT EXISTS notes (body text)");
    const rows = (await queryAs(owner.url, "SELECT 1 AS ok")) as { ok: number }[];
    assert.deepEqual(rows.map((row) => row.ok), [1]); // the plugin owns and can use what it was given
  } finally {
    try {
      await dropStorage(admin, [pluginId]);
      await admin.unsafe(`DROP ROLE IF EXISTS ${quoteIdentifier(provisioner)}`);
    } finally {
      await admin.end({ timeout: 5 });
    }
  }
});
