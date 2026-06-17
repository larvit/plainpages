// Guards the Ory Hydra config (§3): migrations run before the server (hydra-migrate →
// hydra), the DSN targets the hydra database, the server listens on the public/admin
// ports, and the issuer + login/consent/logout URLs point at our app. Version pinning is
// in compose.test.ts. Real boot is verified by running the stack; this catches edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const compose = read("compose.yml");
const hydraYml = read("ory/hydra/hydra.yml");

test("hydra migrations run once before the server starts", () => {
  assert.ok((compose.match(/migrate sql -e --yes/g) ?? []).length >= 2,
    "hydra-migrate runs SQL migrations (alongside kratos)");
  assert.ok((compose.match(/condition:\s*service_completed_successfully/g) ?? []).length >= 3,
    "hydra waits for hydra-migrate (alongside kratos's + keto's gates)");
});

test("hydra DSN targets the per-service hydra database", () => {
  const dsns = [...compose.matchAll(/DSN:\s*(\S+)/g)].map((m) => m[1]).filter((d) => /\/hydra\b/.test(d!));
  assert.ok(dsns.length >= 2, "both hydra services point DSN at the hydra DB");
  for (const dsn of dsns) assert.match(dsn!, /@postgres:5432\/hydra\b/, `${dsn} hits the hydra DB`);
});

test("hydra serves OAuth2 on the public + admin ports", () => {
  assert.match(hydraYml, /public:\s*\n\s*port:\s*4444/, "public API on 4444");
  assert.match(hydraYml, /admin:\s*\n\s*port:\s*4445/, "admin API on 4445");
});

test("hydra issuer + login/consent/logout URLs point at our app", () => {
  assert.match(hydraYml, /issuer:\s*http:\/\/127\.0\.0\.1:4444\//, "issuer is the public OAuth2 URL");
  assert.match(hydraYml, /login:\s*http:\/\/127\.0\.0\.1:3000\/oauth2\/login\b/, "login challenge → our /oauth2/login");
  assert.match(hydraYml, /consent:\s*http:\/\/127\.0\.0\.1:3000\/oauth2\/consent\b/, "consent challenge → our /oauth2/consent");
  assert.match(hydraYml, /logout:\s*http:\/\/127\.0\.0\.1:3000\/oauth2\/logout\b/, "logout → our /oauth2/logout");
});
