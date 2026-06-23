// Guards the session-tokenizer signing key: generateJwks() emits a fresh ES256
// EC private signing key, the committed dev JWKS is a valid such key, and a token signed
// with it verifies through our own verifier (src/jwt.ts) — so what Kratos signs, reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPrivateKey, sign, type JsonWebKey } from "node:crypto";
import { generateJwks, rotateJwks } from "./gen-jwks.ts";
import { verifyJws } from "./jwt.ts";

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const committed = JSON.parse(readFileSync(new URL("../ory/kratos/tokenizer/jwks.json", import.meta.url), "utf8"));

test("generateJwks emits one ES256 EC private signing key with a fresh kid", () => {
  const a = generateJwks();
  const b = generateJwks();
  assert.equal(a.keys.length, 1);
  const k = a.keys[0]!;
  assert.deepEqual({ alg: k.alg, crv: k.crv, kty: k.kty, use: k.use }, { alg: "ES256", crv: "P-256", kty: "EC", use: "sig" });
  assert.ok(k.d && k.x && k.y, "carries the private scalar d (a signing key) + public point");
  assert.match(k.kid, /^[0-9a-f-]{36}$/, "kid is a uuid");
  assert.notEqual(k.kid, b.keys[0]!.kid, "each call mints a unique kid (so rotation differs)");
});

test("the committed dev JWKS is a valid ES256 signing key importable by node:crypto", () => {
  const k = committed.keys[0];
  assert.equal(committed.keys.length, 1);
  assert.deepEqual({ alg: k.alg, kty: k.kty, use: k.use }, { alg: "ES256", kty: "EC", use: "sig" });
  assert.ok(k.kid && k.d, "has a kid and the private signing scalar");
  assert.doesNotThrow(() => createPrivateKey({ key: k, format: "jwk" }), "Kratos can load it to sign");
});

test("rotateJwks prepends a fresh signing key, keeping the old ones for in-flight verification", () => {
  const old = generateJwks(); // a one-key set, as Kratos signs with the first
  const rotated = rotateJwks(old);
  assert.equal(rotated.keys.length, old.keys.length + 1);
  assert.notEqual(rotated.keys[0]!.kid, old.keys[0]!.kid, "the new key is first (Kratos signs with it) with a fresh kid");
  assert.deepEqual(rotated.keys.slice(1), old.keys, "old keys are preserved in order so unexpired JWTs still verify");
  assert.equal(rotated.keys[0]!.alg, "ES256");
});

test("rotateJwks --prune keeps only the newest (first) key, dropping superseded ones", () => {
  const twoKeys = rotateJwks(generateJwks()); // prepend → 2 keys
  const pruned = rotateJwks(twoKeys, { prune: true });
  assert.deepEqual(pruned.keys, [twoKeys.keys[0]], "only the active signing key remains");
});

test("a JWS signed with a generated key verifies via our own verifier (reads what Kratos signs)", () => {
  const key = generateJwks().keys[0]!;
  const head = b64url(JSON.stringify({ alg: "ES256", kid: key.kid }));
  const body = b64url(JSON.stringify({ email: "a@b.c", roles: [], sub: key.kid }));
  const sig = sign("SHA256", Buffer.from(`${head}.${body}`), { dsaEncoding: "ieee-p1363", key: createPrivateKey({ key: key as unknown as JsonWebKey, format: "jwk" }) });
  const token = `${head}.${body}.${sig.toString("base64url")}`;

  const { d: _d, ...pub } = key; // verify against the public half only
  const decoded = verifyJws(token, pub);
  assert.equal(decoded.payload.email, "a@b.c");
  assert.equal(decoded.header.kid, key.kid);
});
