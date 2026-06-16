// Guards the Ory Postgres config (§3): image stays pinned to an exact version
// (AGENTS.md rule) and each Ory service keeps its own database. Real container
// behaviour is verified by booting postgres in CI/e2e; this catches edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ORY_DATABASES = ["hydra", "keto", "kratos"]; // one DB per Ory service

test("compose pins the postgres image to an exact version", () => {
  const tag = read("compose.yml").match(/image:\s*postgres:(\S+)/)?.[1];
  assert.ok(tag, "compose.yml pins a postgres image");
  assert.match(tag, /^\d+\.\d+/, `${tag} pins major.minor`);
  assert.doesNotMatch(tag, /latest|[\^~*]/, `${tag} is exact, not floating`);
});

test("init SQL gives each Ory service its own database", () => {
  const sql = read("ory/postgres/init/init.sql");
  for (const db of ORY_DATABASES) {
    assert.match(sql, new RegExp(`CREATE DATABASE ${db}\\b`, "i"), `creates ${db}`);
  }
});
