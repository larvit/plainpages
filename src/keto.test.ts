// Guards the Ory Keto config: migrations run before the server (keto-migrate →
// keto), the DSN targets the keto database, read/write APIs serve on the ports config.ts
// points at, and the OPL declares the role/group/resource namespaces. Version pinning is
// in compose.test.ts. Real boot is verified by running the stack; this catches edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const compose = read("compose.yml");
const ketoYml = read("ory/keto/keto.yml");
const opl = read("ory/keto/namespaces.keto.ts");

test("keto migrations run once before the server starts", () => {
  assert.match(compose, /migrate\s+up\s+-y/, "keto-migrate runs migrations");
  assert.ok((compose.match(/condition:\s*service_completed_successfully/g) ?? []).length >= 2,
    "keto waits for keto-migrate (alongside kratos's gate)");
});

test("keto DSN targets the per-service keto database", () => {
  const dsns = [...compose.matchAll(/DSN:\s*(\S+)/g)].map((m) => m[1]);
  const ketoDsns = dsns.filter((d) => /\/keto\b/.test(d!));
  assert.ok(ketoDsns.length >= 2, "both keto services point DSN at the keto DB");
  for (const dsn of ketoDsns) assert.match(dsn!, /@postgres:5432\/keto\b/, `${dsn} hits the keto DB`);
});

test("keto serves read/write on the ports config.ts targets", () => {
  // config.ts defaults: ketoReadUrl=http://keto:4466, ketoWriteUrl=http://keto:4467.
  assert.match(ketoYml, /read:\s*\n\s*host:[^\n]*\n\s*port:\s*4466/, "read API on 4466");
  assert.match(ketoYml, /write:\s*\n\s*host:[^\n]*\n\s*port:\s*4467/, "write API on 4467");
});

test("keto loads the OPL namespaces from the mounted file", () => {
  assert.match(ketoYml, /location:\s*file:\/\/\/etc\/config\/keto\/namespaces\.keto\.ts/,
    "namespaces come from the committed OPL");
});

test("the OPL declares role, group and a resource namespace over user subjects", () => {
  for (const ns of ["User", "Group", "Role", "Resource"])
    assert.match(opl, new RegExp(`class ${ns} implements Namespace`), `defines ${ns}`);
  // role + group are subject sets read at login → JWT roles claim (README).
  assert.match(opl, /class Role implements Namespace\s*{\s*related:\s*{\s*members:/,
    "Role has a members relation");
  assert.match(opl, /class Group implements Namespace\s*{\s*related:\s*{\s*members:/,
    "Group has a members relation");
});

test("the resource namespace exposes fine-grained permissions (permits)", () => {
  // README's third tier: the rare live Keto check. owners ⊇ editors ⊇ viewers.
  assert.match(opl, /class Resource[\s\S]*permits\s*=\s*{[\s\S]*view:[\s\S]*edit:[\s\S]*delete:/,
    "Resource permits view/edit/delete");
});
