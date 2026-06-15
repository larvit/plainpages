import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.ts";

// Minimal valid production env: the secrets are the only thing prod must supply.
const prodEnv = { COOKIE_SECRET: "real-cookie-secret", CSRF_SECRET: "real-csrf-secret", NODE_ENV: "production" };

test("loads dev defaults when the environment is empty", () => {
  const c = loadConfig({});
  assert.equal(c.port, 3000);
  assert.equal(c.kratosPublicUrl, "http://kratos:4433");
  assert.equal(c.kratosAdminUrl, "http://kratos:4434");
  assert.equal(c.ketoReadUrl, "http://keto:4466");
  assert.equal(c.ketoWriteUrl, "http://keto:4467");
  assert.match(c.jwksUrl, /jwks/);
  assert.match(c.cookieSecret, /dev-insecure/);
  assert.match(c.csrfSecret, /dev-insecure/);
});

test("reads overrides from the environment", () => {
  const c = loadConfig({ COOKIE_SECRET: "x", KRATOS_PUBLIC_URL: "https://id.example.com", PORT: "8080" });
  assert.equal(c.port, 8080);
  assert.equal(c.kratosPublicUrl, "https://id.example.com");
  assert.equal(c.cookieSecret, "x");
});

test("rejects an invalid PORT", () => {
  for (const PORT of ["0", "70000", "abc", "3000.5"]) assert.throws(() => loadConfig({ PORT }), /PORT/);
});

test("rejects a malformed Ory URL", () => {
  assert.throws(() => loadConfig({ KETO_READ_URL: "not a url" }), /KETO_READ_URL/);
});

test("production rejects a missing or dev-throwaway secret", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /COOKIE_SECRET/);
  assert.throws(() => loadConfig({ COOKIE_SECRET: "real", NODE_ENV: "production" }), /CSRF_SECRET/);
  assert.throws(
    () => loadConfig({ COOKIE_SECRET: "dev-insecure-cookie-secret", CSRF_SECRET: "real", NODE_ENV: "production" }),
    /COOKIE_SECRET/,
  );
});

test("production succeeds with real secrets and still defaults the Ory URLs", () => {
  const c = loadConfig(prodEnv);
  assert.equal(c.cookieSecret, "real-cookie-secret");
  assert.equal(c.csrfSecret, "real-csrf-secret");
  assert.equal(c.kratosPublicUrl, "http://kratos:4433"); // only secrets are required in prod; URLs still default
});
