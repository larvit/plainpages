import assert from "node:assert/strict";
import { test } from "node:test";
import { securityHeaders } from "./security-headers.ts";

test("securityHeaders: strict zero-JS defaults; HSTS only over https", () => {
  const h = securityHeaders();
  // Always-on hardening, independent of scheme.
  assert.equal(h["x-content-type-options"], "nosniff");
  assert.equal(h["x-frame-options"], "DENY");
  assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(h["cross-origin-opener-policy"], "same-origin");

  const csp = h["content-security-policy"] ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/); // a plugin may ship its own JS; the core ships none
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/); // an injected <script> can't run
  assert.match(csp, /style-src 'self' 'unsafe-inline'/); // a few partials use inline style= attrs
  assert.match(csp, /frame-ancestors 'none'/); // clickjacking guard (modern X-Frame-Options)
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /form-action/); // omitted: the themed login posts to Kratos' (cross-origin) action

  // No HSTS on the dev http origin…
  assert.equal(h["strict-transport-security"], undefined);
  // …but present once the deployment is https.
  assert.match(securityHeaders({ secure: true })["strict-transport-security"] ?? "", /max-age=\d+; includeSubDomains/);
});
