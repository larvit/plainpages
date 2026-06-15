import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import type { JsonWebKey, KeyObject } from "node:crypto";
import { test } from "node:test";
import { decodeJws, verifyJws } from "./jwt.ts";

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

// Sign a compact JWS the way a JOSE signer (Kratos tokenizer) would, via node:crypto.
function makeJws(alg: "ES256" | "RS256", privateKey: KeyObject, payload: unknown): string {
  const signingInput = `${b64url(JSON.stringify({ alg, typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
  const signature =
    alg === "ES256"
      ? sign("SHA256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" })
      : sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rsaJwk = rsa.publicKey.export({ format: "jwk" }) as JsonWebKey;
const ecJwk = ec.publicKey.export({ format: "jwk" }) as JsonWebKey;

test("verifies an RS256 token, returning the decoded header + payload", () => {
  const token = makeJws("RS256", rsa.privateKey, { roles: ["admin"], sub: "u" });
  const verified = verifyJws(token, rsaJwk);
  assert.equal(verified.header.alg, "RS256");
  assert.deepEqual(verified.payload, { roles: ["admin"], sub: "u" });
});

test("verifies an ES256 token (raw r‖s signature)", () => {
  const token = makeJws("ES256", ec.privateKey, { sub: "u" });
  assert.deepEqual(verifyJws(token, ecJwk).payload, { sub: "u" });
});

// All three reach and fail the signature check itself, not an earlier structural guard.
test("rejects a signature that fails verification (tampered payload, wrong key, empty)", () => {
  const token = makeJws("RS256", rsa.privateKey, { roles: ["user"], sub: "u" });
  const [header, payload, signature] = token.split(".");

  const forged = `${header}.${b64url(JSON.stringify({ roles: ["admin"], sub: "u" }))}.${signature}`;
  assert.throws(() => verifyJws(forged, rsaJwk), /invalid signature/);

  const otherJwk = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" }) as JsonWebKey;
  assert.throws(() => verifyJws(token, otherJwk), /invalid signature/);

  assert.throws(() => verifyJws(`${header}.${payload}.`, rsaJwk), /invalid signature/);
});

// The algParams allowlist is the alg-confusion defense: anything outside RS*/ES* is refused
// (`HS*` symmetric and `none` would otherwise let an attacker forge tokens).
test("rejects an alg outside the allowlist (none, HS256)", () => {
  const none = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify({ sub: "u" }))}.`;
  assert.throws(() => verifyJws(none, rsaJwk), /unsupported alg/);

  const hs256 = `${b64url(JSON.stringify({ alg: "HS256" }))}.${b64url(JSON.stringify({ sub: "u" }))}.${b64url("x")}`;
  assert.throws(() => verifyJws(hs256, rsaJwk), /unsupported alg/);
});

test("rejects when key type does not match the alg family", () => {
  const token = makeJws("ES256", ec.privateKey, { sub: "u" });
  assert.throws(() => verifyJws(token, rsaJwk), /does not match alg/);
});

test("rejects when the JWK pins a different alg", () => {
  const token = makeJws("RS256", rsa.privateKey, { sub: "u" });
  assert.throws(() => verifyJws(token, { ...rsaJwk, alg: "RS512" }), /alg mismatch/);
});

test("rejects a symmetric JWK (kty:oct) for an asymmetric alg — second defense after the allowlist", () => {
  const token = makeJws("RS256", rsa.privateKey, { sub: "u" });
  assert.throws(() => verifyJws(token, { k: b64url("secret"), kty: "oct" }), /invalid JWK/);
});

// decodeJws structural guards, all rejected before any crypto runs.
test("rejects malformed tokens before crypto (segment count, payload type, base64url, kid)", () => {
  const p = b64url(JSON.stringify({ sub: "u" }));
  assert.throws(() => verifyJws("only.two", rsaJwk), /expected 3 segments/);

  const arrayPayload = `${b64url(JSON.stringify({ alg: "RS256" }))}.${b64url(JSON.stringify([1, 2, 3]))}.${b64url("x")}`;
  assert.throws(() => verifyJws(arrayPayload, rsaJwk), /payload not an object/);

  assert.throws(() => verifyJws(`ab*c.${p}.${b64url("x")}`, rsaJwk), /base64url/);

  const badKid = `${b64url(JSON.stringify({ alg: "RS256", kid: 123 }))}.${p}.${b64url("x")}`;
  assert.throws(() => verifyJws(badKid, rsaJwk), /kid/);
});

test("decodeJws exposes header and payload without verifying", () => {
  const token = makeJws("RS256", rsa.privateKey, { sub: "u" });
  const decoded = decodeJws(token);
  assert.equal(decoded.header.alg, "RS256");
  assert.deepEqual(decoded.payload, { sub: "u" });
});
