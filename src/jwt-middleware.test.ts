import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from "node:crypto";
import { test } from "node:test";
import { staticJwks } from "./jwks.ts";
import { authenticate, claimsToUser, resolveSession, verifyToken } from "./jwt-middleware.ts";
import { SESSION_COOKIE } from "./login.ts";

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

// Mint an ES256 session JWT the way the Kratos tokenizer would (kid in the header).
function mint(privateKey: KeyObject, kid: string, payload: Record<string, unknown>): string {
  const head = b64url(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = sign("SHA256", Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
}

const k1 = generateKeyPairSync("ec", { namedCurve: "P-256" });
const k2 = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk1: JsonWebKey = { ...(k1.publicKey.export({ format: "jwk" }) as JsonWebKey), alg: "ES256", kid: "k1" };
const jwk2: JsonWebKey = { ...(k2.publicKey.export({ format: "jwk" }) as JsonWebKey), alg: "ES256", kid: "k2" };
const jwks = staticJwks([jwk1, jwk2]); // rotated set: two live keys

const NOW = 1_700_000_000; // fixed clock for deterministic exp/nbf checks
const valid = { email: "a@b.c", exp: NOW + 600, roles: ["admin"], sub: "u1" };

test("verifyToken: a valid token → User, selecting the verify key by kid across a rotated set", async () => {
  const user = await verifyToken(mint(k2.privateKey, "k2", valid), jwks, { now: NOW });
  assert.deepEqual(user, { email: "a@b.c", id: "u1", roles: ["admin"] });
});

test("verifyToken rejects expiry and future nbf, with clock-skew leeway", async () => {
  const opts = { clockSkewSec: 60, now: NOW };
  await assert.rejects(verifyToken(mint(k1.privateKey, "k1", { ...valid, exp: NOW - 120 }), jwks, opts), /expired/);
  // exp 30s in the past but inside the 60s skew → still accepted.
  await verifyToken(mint(k1.privateKey, "k1", { ...valid, exp: NOW - 30 }), jwks, opts);
  await assert.rejects(verifyToken(mint(k1.privateKey, "k1", { ...valid, nbf: NOW + 120 }), jwks, opts), /not yet valid/);
});

test("verifyToken checks issuer/audience only when configured", async () => {
  const tok = (extra: Record<string, unknown>) => mint(k1.privateKey, "k1", { ...valid, ...extra });
  // No iss/aud in the token and none expected (the dev tokenizer sets neither) → fine.
  await verifyToken(tok({}), jwks, { now: NOW });
  // Issuer pinned: must match; absent or wrong → reject.
  await verifyToken(tok({ iss: "https://id" }), jwks, { issuer: "https://id", now: NOW });
  await assert.rejects(verifyToken(tok({}), jwks, { issuer: "https://id", now: NOW }), /issuer/);
  await assert.rejects(verifyToken(tok({ iss: "other" }), jwks, { issuer: "https://id", now: NOW }), /issuer/);
  // Audience pinned: matches a string or an array membership; mismatch → reject.
  await verifyToken(tok({ aud: "pp" }), jwks, { audience: "pp", now: NOW });
  await verifyToken(tok({ aud: ["x", "pp"] }), jwks, { audience: "pp", now: NOW });
  await assert.rejects(verifyToken(tok({ aud: "x" }), jwks, { audience: "pp", now: NOW }), /audience/);
});

test("verifyToken rejects a bad signature and an unknown kid", async () => {
  // Signed with k1 but the header claims kid k2 → wrong verify key → bad signature.
  await assert.rejects(verifyToken(mint(k1.privateKey, "k2", valid), jwks, { now: NOW }), /invalid signature/);
  await assert.rejects(verifyToken(mint(k1.privateKey, "nope", valid), jwks, { now: NOW }), /no JWKS key/);
});

test("claimsToUser requires sub + email, defaults roles to [], keeps only string roles", () => {
  assert.throws(() => claimsToUser({ email: "a@b.c", exp: NOW }), /sub/);
  assert.throws(() => claimsToUser({ email: "a@b.c", exp: NOW, sub: "" }), /sub/); // empty sub rejected too
  assert.throws(() => claimsToUser({ exp: NOW, sub: "u" }), /email/);
  assert.throws(() => claimsToUser({ email: "", exp: NOW, sub: "u" }), /email/); // empty email rejected (the shell keys signed-in vs anonymous off it)
  assert.deepEqual(claimsToUser({ email: "a@b.c", sub: "u" }).roles, []); // roles absent
  assert.deepEqual(claimsToUser({ email: "a@b.c", roles: ["a", 1, "b"], sub: "u" }).roles, ["a", "b"]);
});

test("resolveSession classifies the cookie; authenticate is its fail-closed user projection", async () => {
  const cookie = (extra: Record<string, unknown> = {}, kid = "k1") => `${SESSION_COOKIE}=${mint(k1.privateKey, kid, { ...valid, ...extra })}`;
  const user = { email: "a@b.c", id: "u1", roles: ["admin"] };

  // A valid token → the user, not expired.
  assert.deepEqual(await resolveSession(cookie(), jwks, { now: NOW }), { expired: false, user });
  // Present but past exp → the re-mint trigger (expired flagged, no user).
  assert.deepEqual(await resolveSession(cookie({ exp: NOW - 999 }), jwks, { now: NOW }), { expired: true, user: null });
  // No cookie / non-ours / garbage / bad-signature are NOT re-mint candidates (no Ory round-trip).
  assert.deepEqual(await resolveSession(undefined, jwks, { now: NOW }), { expired: false, user: null });
  assert.deepEqual(await resolveSession("other=1", jwks, { now: NOW }), { expired: false, user: null });
  assert.deepEqual(await resolveSession(`${SESSION_COOKIE}=not.a.jwt`, jwks, { now: NOW }), { expired: false, user: null });
  assert.deepEqual(await resolveSession(cookie({}, "nope"), jwks, { now: NOW }), { expired: false, user: null });

  // authenticate() is the convenience wrapper — resolveSession(...).user, dropping the flag.
  assert.deepEqual(await authenticate(cookie(), jwks, { now: NOW }), user);
  assert.equal(await authenticate(cookie({ exp: NOW - 999 }), jwks, { now: NOW }), null); // expired ⇒ null
  assert.equal(await authenticate(undefined, jwks, { now: NOW }), null);
});

test("verifyToken honours an optional denylist: a revoked subject's token rejects like an expiry → re-mint", async () => {
  // Deny u1's tokens minted at/before NOW; a token minted after passes (a fresh re-login).
  const denylist = { isRevoked: (sub: string, iat: number | undefined) => sub === "u1" && (iat === undefined || iat <= NOW) };

  // Revoked: thrown as *expired* so resolveSession flags it for the re-mint (re-read Keto / clear).
  await assert.rejects(verifyToken(mint(k1.privateKey, "k1", { ...valid, iat: NOW - 5 }), jwks, { denylist, now: NOW }), /revoked/);
  assert.deepEqual(await resolveSession(`${SESSION_COOKIE}=${mint(k1.privateKey, "k1", { ...valid, iat: NOW - 5 })}`, jwks, { denylist, now: NOW }), { expired: true, user: null });
  // A token minted after the revoke (fresh login) is accepted; a different subject is untouched.
  assert.deepEqual(await verifyToken(mint(k1.privateKey, "k1", { ...valid, iat: NOW + 5 }), jwks, { denylist, now: NOW }), { email: "a@b.c", id: "u1", roles: ["admin"] });
  await verifyToken(mint(k1.privateKey, "k1", { ...valid, iat: NOW - 5, sub: "u2" }), jwks, { denylist, now: NOW });
});
