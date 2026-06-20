import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.ts";

// Explicit secure-secret enforcement (no environment sniffing): secrets are the only
// thing a hardened deploy must supply.
const secureEnv = {
  CSRF_SECRET: "real-csrf-secret",
  REQUIRE_SECURE_SECRETS: "true",
};

test("loads dev defaults when the environment is empty", () => {
  const c = loadConfig({});
  assert.equal(c.port, 3000);
  assert.equal(c.cacheTemplates, false);
  assert.equal(c.secureCookies, false); // dev runs http; prod sets SECURE_COOKIES=true
  assert.equal(c.kratosPublicUrl, "http://kratos:4433");
  assert.equal(c.kratosAdminUrl, "http://kratos:4434");
  assert.equal(c.ketoReadUrl, "http://keto:4466");
  assert.equal(c.ketoWriteUrl, "http://keto:4467");
  assert.equal(c.hydraAdminUrl, "http://hydra:4445");
  assert.match(c.csrfSecret, /dev-insecure/);
  assert.equal(c.jwtClockSkewSec, 60); // default exp/nbf leeway for Kratos↔web clock drift
  assert.equal(c.revocationDenylist, false); // instant-revoke is opt-in (§9)
  assert.equal(c.revocationTtlSec, 900); // ≥ tokenizer TTL (10m) + skew
  assert.equal(c.logLevel, "info"); // §9 observability defaults
  assert.equal(c.logFormat, "text"); // human-readable in dev; prod compose sets json
  assert.equal(c.otlpEndpoint, undefined); // OTLP export opt-in; console-only by default
  assert.equal(c.otlpProtocol, "http/json");
  assert.equal(c.serviceName, "plainpages"); // OTLP service.name default; implementer-overridable
});

test("SERVICE_NAME is overridable so an implementer brands their own logs/traces (§9)", () => {
  assert.equal(loadConfig({ SERVICE_NAME: "acme-ops" }).serviceName, "acme-ops");
  assert.equal(loadConfig({ SERVICE_NAME: "" }).serviceName, "plainpages"); // empty ⇒ default
});

test("LOG_LEVEL/LOG_FORMAT/OTLP_PROTOCOL are validated enums; OTLP_ENDPOINT an optional URL (§9)", () => {
  assert.equal(loadConfig({ LOG_LEVEL: "debug" }).logLevel, "debug");
  assert.equal(loadConfig({ LOG_LEVEL: "none" }).logLevel, "none");
  assert.throws(() => loadConfig({ LOG_LEVEL: "trace" }), /LOG_LEVEL/);
  assert.equal(loadConfig({ LOG_FORMAT: "json" }).logFormat, "json");
  assert.throws(() => loadConfig({ LOG_FORMAT: "yaml" }), /LOG_FORMAT/);
  assert.equal(loadConfig({ OTLP_PROTOCOL: "http/protobuf" }).otlpProtocol, "http/protobuf");
  assert.throws(() => loadConfig({ OTLP_PROTOCOL: "grpc" }), /OTLP_PROTOCOL/);
  assert.equal(loadConfig({ OTLP_ENDPOINT: "http://collector:4318" }).otlpEndpoint, "http://collector:4318");
  assert.throws(() => loadConfig({ OTLP_ENDPOINT: "not a url" }), /OTLP_ENDPOINT/);
});

test("REVOCATION_DENYLIST: opt-in toggle (off by default) + REVOCATION_TTL_SEC must be a positive integer", () => {
  assert.equal(loadConfig({ REVOCATION_DENYLIST: "true" }).revocationDenylist, true);
  assert.throws(() => loadConfig({ REVOCATION_DENYLIST: "on" }), /REVOCATION_DENYLIST/);
  assert.equal(loadConfig({ REVOCATION_TTL_SEC: "1200" }).revocationTtlSec, 1200);
  for (const v of ["0", "-1", "1.5", "abc"]) assert.throws(() => loadConfig({ REVOCATION_TTL_SEC: v }), /REVOCATION_TTL_SEC/);
});

test("JWKS_URL defaults to the committed Kratos tokenizer signing key, not an http endpoint", () => {
  // The session JWT is signed by the tokenizer key (kratos.yml jwks_url); Kratos does NOT
  // republish it at /.well-known/jwks.json, so the §4 verifier reads that same file://.
  // gen-jwks.test.ts owns that the file is a valid ES256 signing key with a kid.
  const url = new URL(loadConfig({}).jwksUrl);
  assert.equal(url.protocol, "file:");
  assert.match(url.pathname, /tokenizer\/jwks\.json$/);
});

test("JWT issuer/audience are optional: unset by default, pinned from the env", () => {
  const def = loadConfig({});
  assert.equal(def.jwtIssuer, undefined);
  assert.equal(def.jwtAudience, undefined);
  const c = loadConfig({ JWT_AUDIENCE: "plainpages", JWT_ISSUER: "https://id.example.com" });
  assert.equal(c.jwtIssuer, "https://id.example.com");
  assert.equal(c.jwtAudience, "plainpages");
});

test("parses explicit boolean toggles and rejects non-boolean values", () => {
  assert.equal(loadConfig({ CACHE_TEMPLATES: "true" }).cacheTemplates, true);
  assert.equal(loadConfig({ CACHE_TEMPLATES: "false" }).cacheTemplates, false);
  assert.equal(loadConfig({ SECURE_COOKIES: "true" }).secureCookies, true);
  assert.throws(() => loadConfig({ CACHE_TEMPLATES: "yes" }), /CACHE_TEMPLATES/);
});

test("reads overrides from the environment", () => {
  const c = loadConfig({ CSRF_SECRET: "x", KRATOS_PUBLIC_URL: "https://id.example.com", PORT: "8080" });
  assert.equal(c.port, 8080);
  assert.equal(c.kratosPublicUrl, "https://id.example.com");
  assert.equal(c.csrfSecret, "x");
});

test("rejects an invalid PORT", () => {
  for (const PORT of ["0", "70000", "abc", "3000.5"]) assert.throws(() => loadConfig({ PORT }), /PORT/);
});

test("JWT_CLOCK_SKEW_SEC: parses a non-negative integer, rejects junk (E2E shortens it to 0)", () => {
  assert.equal(loadConfig({ JWT_CLOCK_SKEW_SEC: "0" }).jwtClockSkewSec, 0);
  assert.equal(loadConfig({ JWT_CLOCK_SKEW_SEC: "120" }).jwtClockSkewSec, 120);
  for (const v of ["-1", "1.5", "abc"]) assert.throws(() => loadConfig({ JWT_CLOCK_SKEW_SEC: v }), /JWT_CLOCK_SKEW_SEC/);
});

test("ORY_TIMEOUT_SEC: defaults to 5 and must be a positive integer (0 would abort every Ory call)", () => {
  assert.equal(loadConfig({}).oryTimeoutSec, 5);
  assert.equal(loadConfig({ ORY_TIMEOUT_SEC: "10" }).oryTimeoutSec, 10);
  for (const v of ["0", "-1", "1.5", "abc"]) assert.throws(() => loadConfig({ ORY_TIMEOUT_SEC: v }), /ORY_TIMEOUT_SEC/);
});

test("rejects a malformed Ory URL", () => {
  assert.throws(() => loadConfig({ KETO_READ_URL: "not a url" }), /KETO_READ_URL/);
});

test("REQUIRE_SECURE_SECRETS rejects a missing or dev-throwaway secret", () => {
  assert.throws(() => loadConfig({ REQUIRE_SECURE_SECRETS: "true" }), /CSRF_SECRET/);
  assert.throws(
    () => loadConfig({ CSRF_SECRET: "dev-insecure-csrf-secret", REQUIRE_SECURE_SECRETS: "true" }),
    /CSRF_SECRET/,
  );
});

test("REQUIRE_SECURE_SECRETS succeeds with real secrets and still defaults the Ory URLs", () => {
  const c = loadConfig(secureEnv);
  assert.equal(c.csrfSecret, "real-csrf-secret");
  assert.equal(c.kratosPublicUrl, "http://kratos:4433"); // only secrets are enforced; URLs still default
});
