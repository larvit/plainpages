// Guards the Ory Kratos config (§3): image pinned to an exact version (AGENTS.md),
// migrations run before the server (kratos-migrate → kratos), the DSN targets the
// kratos database, and the identity schema carries email (password identifier) +
// name traits. Real boot is verified by running the stack; this catches edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const compose = read("compose.yml");
const kratosYml = read("ory/kratos/kratos.yml");
const schema = JSON.parse(read("ory/kratos/identity.schema.json"));

test("compose pins both kratos services to one exact version", () => {
  const tags = [...compose.matchAll(/image:\s*oryd\/kratos:(\S+)/g)].map((m) => m[1]);
  assert.equal(tags.length, 2, "kratos + kratos-migrate both present");
  assert.equal(tags[0], tags[1], "both pinned to the same version");
  const tag = tags[0]!;
  assert.match(tag, /^v\d+\.\d+\.\d+$/, `${tag} is an exact vMAJOR.MINOR.PATCH`);
  assert.doesNotMatch(tag, /latest|[\^~*]/, `${tag} is exact, not floating`);
});

test("migrations run once before the server starts", () => {
  assert.match(compose, /migrate sql -e --yes/, "kratos-migrate runs SQL migrations");
  assert.match(compose, /condition:\s*service_completed_successfully/,
    "kratos waits for kratos-migrate to finish");
});

test("kratos DSN targets the per-service kratos database", () => {
  const dsns = [...compose.matchAll(/DSN:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(dsns.length >= 2, "both kratos services set DSN");
  for (const dsn of dsns) assert.match(dsn!, /@postgres:5432\/kratos\b/, `${dsn} hits the kratos DB`);
});

test("identity schema requires email (password identifier) + name traits", () => {
  const t = schema.properties.traits.properties;
  assert.equal(t.email.format, "email");
  assert.equal(t.email["ory.sh/kratos"].credentials.password.identifier, true,
    "email is the password login identifier");
  assert.deepEqual(Object.keys(t.name.properties).sort(), ["first", "last"]);
  assert.ok(schema.properties.traits.required.includes("email"), "email is required");
});

test("kratos config wires the identity schema", () => {
  assert.match(kratosYml, /default_schema_id:\s*default/);
  assert.match(kratosYml, /identity\.schema\.json/);
});

// The five self-service flows return the browser to our own themed routes (§4 renders them).
const FLOW_PAGES = ["login", "registration", "recovery", "verification", "settings"];

test("self-service flows return to our themed pages", () => {
  for (const flow of FLOW_PAGES)
    assert.match(kratosYml, new RegExp(`ui_url:\\s*http://127\\.0\\.0\\.1:3000/${flow}\\b`),
      `${flow} flow points at our /${flow} page`);
});

test("recovery + verification run on email code, delivered by a courier", () => {
  assert.ok((kratosYml.match(/use:\s*code/g) ?? []).length >= 2,
    "recovery + verification both use the email-code method");
  assert.match(kratosYml, /connection_uri:\s*smtp:\/\/mailpit:1025/, "courier sends via the dev mail catcher");
  assert.match(compose, /--watch-courier/, "kratos dispatches queued mail (else codes never send)");
});

test("compose pins the dev mail catcher to an exact version", () => {
  const tag = read("compose.override.yml").match(/image:\s*axllent\/mailpit:(\S+)/)?.[1];
  assert.ok(tag, "compose.override.yml pins a mailpit image");
  assert.match(tag, /^v\d+\.\d+\.\d+$/, `${tag} is an exact version`);
  assert.doesNotMatch(tag, /latest|edge|[\^~*]/, `${tag} is exact, not floating`);
});
