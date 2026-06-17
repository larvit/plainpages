// Guards the Ory Postgres config (§3): each Ory service keeps its own database (the
// image pin is covered by compose.test.ts's global scan). Real container behaviour is
// verified by booting postgres in CI/e2e; this catches edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ORY_DATABASES = ["hydra", "keto", "kratos"]; // one DB per Ory service

test("init SQL gives each Ory service its own database", () => {
  const sql = read("ory/postgres/init/init.sql");
  for (const db of ORY_DATABASES) {
    assert.match(sql, new RegExp(`CREATE DATABASE ${db}\\b`, "i"), `creates ${db}`);
  }
});
