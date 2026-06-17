// Guards the Ory Kratos config (§3): migrations run before the server (kratos-migrate →
// kratos), the DSN targets the kratos database, and the identity schema carries email
// (password identifier) + name traits. Version pinning is in compose.test.ts. Real boot
// is verified by running the stack; this catches edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const compose = read("compose.yml");
const kratosYml = read("ory/kratos/kratos.yml");
const schema = JSON.parse(read("ory/kratos/identity.schema.json"));

test("migrations run once before the server starts", () => {
  assert.match(compose, /migrate sql -e --yes/, "kratos-migrate runs SQL migrations");
  assert.match(compose, /condition:\s*service_completed_successfully/,
    "kratos waits for kratos-migrate to finish");
});

test("kratos DSN targets the per-service kratos database", () => {
  const dsns = [...compose.matchAll(/DSN:\s*(\S+)/g)].map((m) => m[1]).filter((d) => /\/kratos\b/.test(d!));
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

test("session settings: branded cookie, bounded lifespan, sliding refresh", () => {
  assert.match(kratosYml, /name:\s*plainpages_session/, "branded session cookie name");
  assert.match(kratosYml, /lifespan:\s*720h/, "session has a bounded lifespan");
  assert.match(kratosYml, /earliest_possible_extend:\s*24h/, "sliding-refresh window is set");
});

test("session tokenizer template 'plainpages' mints a short-lived signed JWT", () => {
  // whoami(tokenize_as: plainpages) → a locally-verifiable JWT, so the hot path never
  // calls Ory (§4). Signed with the committed tokenizer/jwks.json (gen-jwks.ts).
  assert.match(kratosYml, /tokenizer:\s*\n\s*templates:\s*\n\s*plainpages:/, "plainpages template defined");
  assert.match(kratosYml, /ttl:\s*10m/, "~10m TTL — re-minted on refresh");
  assert.match(kratosYml, /subject_source:\s*id/, "sub = the Kratos identity id");
  assert.match(kratosYml, /jwks_url:\s*file:\/\/\/etc\/config\/kratos\/tokenizer\/jwks\.json/, "signs with the mounted JWKS");
  assert.match(kratosYml, /claims_mapper_url:\s*file:\/\/\/etc\/config\/kratos\/tokenizer\/plainpages\.jsonnet/,
    "claims via the committed mapper");
});

test("the tokenizer claims mapper emits email + roles from the metadata_admin projection", () => {
  const mapper = read("ory/kratos/tokenizer/plainpages.jsonnet");
  assert.match(mapper, /email:\s*session\.identity\.traits\.email/, "email ← identity trait");
  assert.match(mapper, /metadata_admin/, "roles ← metadata_admin (the per-login Keto projection, §4)");
});

test("social sign-in is off by default — a clean clone stays password-only", () => {
  // The oidc method ships present-but-disabled with no providers; operators activate it
  // purely via env (SELFSERVICE_METHODS_OIDC_*) — no code change, no baked-in creds.
  assert.match(kratosYml, /oidc:\s*\n\s*enabled:\s*false/, "oidc method is disabled by default");
  assert.match(kratosYml, /providers:\s*\[\]/, "no providers baked in");
});

test("the committed OIDC claims mapper maps email + name", () => {
  const mapper = read("ory/kratos/oidc/claims.jsonnet");
  assert.match(mapper, /email:\s*claims\.email/, "provider email → email trait");
  assert.match(mapper, /given_name/, "given name → name.first");
  assert.match(mapper, /family_name/, "family name → name.last");
});
