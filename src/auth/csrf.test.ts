import assert from "node:assert/strict";
import { test } from "node:test";
import { csrfCookie, ensureCsrfToken, issueCsrfToken, verifyCsrfRequest, verifyCsrfToken } from "./csrf.ts";

const SECRET = "test-csrf-secret";

test("issued tokens are signed: round-trip verifies; tamper/wrong-secret/garbage fail", () => {
  const token = issueCsrfToken(SECRET);
  assert.match(token, /^[\w-]+\.[\w-]+$/); // <nonce>.<hmac>, base64url
  assert.ok(verifyCsrfToken(SECRET, token));

  assert.equal(verifyCsrfToken(SECRET, token.replace(/.$/, (c) => (c === "a" ? "b" : "a"))), false); // tampered mac
  assert.equal(verifyCsrfToken("other-secret", token), false);
  assert.equal(verifyCsrfToken(SECRET, undefined), false);
  assert.equal(verifyCsrfToken(SECRET, "nodot"), false);
  assert.notEqual(issueCsrfToken(SECRET), issueCsrfToken(SECRET)); // random nonce each time
});

test("ensureCsrfToken reuses a valid cookie token, mints a fresh one when absent/invalid", () => {
  const token = issueCsrfToken(SECRET);
  const reused = ensureCsrfToken(`plainpages_csrf=${token}; other=x`, SECRET);
  assert.deepEqual(reused, { fresh: false, token });

  const minted = ensureCsrfToken(undefined, SECRET);
  assert.equal(minted.fresh, true);
  assert.ok(verifyCsrfToken(SECRET, minted.token));

  const bad = ensureCsrfToken("plainpages_csrf=forged.value", SECRET);
  assert.equal(bad.fresh, true); // a forged cookie is replaced, not trusted
});

test("csrfCookie builds the HttpOnly/Lax cookie; Secure is opt-in", () => {
  assert.match(csrfCookie("tok"), /^plainpages_csrf=tok;.*HttpOnly; SameSite=Lax$/);
  assert.match(csrfCookie("tok", { secure: true }), /; SameSite=Lax; Secure$/);
});

test("verifyCsrfRequest requires a genuine cookie that the submitted field echoes (double-submit)", () => {
  const token = issueCsrfToken(SECRET);
  const cookieHeader = `plainpages_csrf=${token}`;
  assert.ok(verifyCsrfRequest({ cookieHeader, secret: SECRET, submitted: token }));

  assert.equal(verifyCsrfRequest({ cookieHeader: undefined, secret: SECRET, submitted: token }), false); // no cookie
  assert.equal(verifyCsrfRequest({ cookieHeader, secret: SECRET, submitted: null }), false); // no field
  assert.equal(verifyCsrfRequest({ cookieHeader, secret: SECRET, submitted: issueCsrfToken(SECRET) }), false); // field ≠ cookie
  assert.equal(verifyCsrfRequest({ cookieHeader: "plainpages_csrf=forged.v", secret: SECRET, submitted: "forged.v" }), false); // matching but unsigned
});
