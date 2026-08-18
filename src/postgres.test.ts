// Guards the Ory Postgres config: each Ory service keeps its own database (the
// image pin is covered by compose.test.ts's global scan). Real container behaviour is
// verified by booting postgres in CI/e2e; this catches edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ORY_DATABASES = ["hydra", "keto", "kratos"]; // one DB per Ory service

function sourceFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...sourceFiles(`${dir}/${entry.name}`));
    else if (entry.name.endsWith(".ts")) out.push(`${dir}/${entry.name}`);
  }
  return out.sort();
}

test("init SQL gives each Ory service its own database, and leaves plugin databases to bootstrap", () => {
  const sql = read("ory/postgres/init/init.sql");
  for (const db of ORY_DATABASES) {
    assert.match(sql, new RegExp(`CREATE DATABASE ${db}\\b`, "i"), `creates ${db}`);
  }
  // This file runs once, on an empty data dir — a plugin database added here would never appear for
  // a plugin dropped in later. bootstrap provisions them on every boot instead.
  assert.doesNotMatch(sql, /plugin_/i, "no plugin database is seeded here");
  // PUBLIC keeps CONNECT unless it is revoked, which would put every plugin role on the auth plane.
  for (const db of ORY_DATABASES) {
    assert.match(sql, new RegExp(`REVOKE CONNECT ON DATABASE ${db} FROM PUBLIC`, "i"), `${db} is closed to PUBLIC`);
  }
});

// AGENTS.md records that the driver runs the provisioning DDL in bootstrap and nothing else. A
// single value imported from the wrong module puts it in web's graph without changing behaviour,
// so nothing but this would notice.
test("the Postgres driver reaches bootstrap only, never web's import graph", () => {
  const files = sourceFiles();
  assert.ok(files.length > 40, "walks the source tree");
  assert.deepEqual(
    files.filter((f) => /^import .*"postgres"/m.test(read(f))), // an import line, not a mention of one
    ["src/plugin-host/storage-provisioning.ts", "src/plugin-host/storage.test.ts"],
  );
  assert.deepEqual(
    files.filter((f) => !f.endsWith(".test.ts") && /from "[^"]*storage-provisioning\.ts"/.test(read(f))),
    ["src/auth/bootstrap.ts"],
  );
});
