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

test("rejects a tampered payload", () => {
  const token = makeJws("RS256", rsa.privateKey, { roles: ["user"], sub: "u" });
  const [header, , signature] = token.split(".");
  const forged = `${header}.${b64url(JSON.stringify({ roles: ["admin"], sub: "u" }))}.${signature}`;
  assert.throws(() => verifyJws(forged, rsaJwk), /invalid signature/);
});

test("rejects a signature from a different key", () => {
  const token = makeJws("RS256", rsa.privateKey, { sub: "u" });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() => verifyJws(token, other.publicKey.export({ format: "jwk" }) as JsonWebKey), /invalid signature/);
});

test("rejects an empty signature segment", () => {
  const [header, payload] = makeJws("RS256", rsa.privateKey, { sub: "u" }).split(".");
  assert.throws(() => verifyJws(`${header}.${payload}.`, rsaJwk), /invalid signature/);
});

test("rejects alg:none", () => {
  const token = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify({ sub: "u" }))}.`;
  assert.throws(() => verifyJws(token, rsaJwk), /unsupported alg/);
});

test("rejects symmetric alg HS256", () => {
  const token = `${b64url(JSON.stringify({ alg: "HS256" }))}.${b64url(JSON.stringify({ sub: "u" }))}.${b64url("x")}`;
  assert.throws(() => verifyJws(token, rsaJwk), /unsupported alg/);
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

test("rejects a token without three segments", () => {
  assert.throws(() => verifyJws("only.two", rsaJwk), /expected 3 segments/);
});

test("rejects a non-object (array) payload", () => {
  const token = `${b64url(JSON.stringify({ alg: "RS256" }))}.${b64url(JSON.stringify([1, 2, 3]))}.${b64url("x")}`;
  assert.throws(() => verifyJws(token, rsaJwk), /payload not an object/);
});

test("rejects a non-canonical base64url segment before any crypto", () => {
  assert.throws(() => verifyJws(`ab*c.${b64url(JSON.stringify({ sub: "u" }))}.${b64url("x")}`, rsaJwk), /base64url/);
});

test("rejects a non-string kid in the header", () => {
  const token = `${b64url(JSON.stringify({ alg: "RS256", kid: 123 }))}.${b64url(JSON.stringify({ sub: "u" }))}.${b64url("x")}`;
  assert.throws(() => verifyJws(token, rsaJwk), /kid/);
});

test("decodeJws exposes header and payload without verifying", () => {
  const token = makeJws("RS256", rsa.privateKey, { sub: "u" });
  const decoded = decodeJws(token);
  assert.equal(decoded.header.alg, "RS256");
  assert.deepEqual(decoded.payload, { sub: "u" });
});
