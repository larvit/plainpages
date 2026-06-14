import { createPublicKey, verify } from "node:crypto";
import type { JsonWebKey, KeyObject } from "node:crypto";

// JWS signature verification with the Node stdlib — no `jose`/JWT dep (todo §0):
// `createPublicKey({format:"jwk"})` imports a JWK and verifies the RS*/ES* signatures the
// Kratos tokenizer produces — all we need, no supply-chain surface (see AGENTS.md).
//
// Signature only. §4 builds the rest on top: claim checks (exp/iss/aud, clock skew),
// JWKS-by-`kid` fetch/cache/rotation, and bounding `token` type/length at the boundary.

// JOSE `alg` → Node verify parameters. ES* signatures are raw r‖s (IEEE P1363), not DER.
// Widen support by extending this map. Security invariant: never add an `HS*` (symmetric)
// entry — this map is the allowlist, and one would let an attacker-supplied HMAC key verify.
// `none` is absent for the same reason.
const algParams: Record<string, { hash: string; keyType: "ec" | "rsa"; dsaEncoding?: "ieee-p1363" }> = {
  ES256: { dsaEncoding: "ieee-p1363", hash: "SHA256", keyType: "ec" },
  RS256: { hash: "RSA-SHA256", keyType: "rsa" },
};

export interface JwsHeader {
  alg: string;
  kid?: string;
}

export interface DecodedJws {
  header: JwsHeader;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

// Unpadded base64url alphabet — `Buffer.from(_, "base64url")` is lax (drops junk, tolerates
// non-canonical padding), so reject non-canonical segments up front. §4 reads `kid` from the
// still-unverified header, so this stops laundered bytes reaching key selection.
const base64url = /^[A-Za-z0-9_-]+$/;

function decodeSegment(segment: string): unknown {
  if (!base64url.test(segment)) throw new Error("malformed JWS: invalid base64url segment");
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Split a compact JWS and base64url-decode its header/payload. No signature check.
export function decodeJws(token: string): DecodedJws {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed JWS: expected 3 segments");
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const rawHeader = decodeSegment(headerB64);
  const payload = decodeSegment(payloadB64);
  if (!isPlainObject(rawHeader)) throw new Error("malformed JWS: header not an object");
  if (!isPlainObject(payload)) throw new Error("malformed JWS: payload not an object");

  const { alg, kid } = rawHeader;
  if (typeof alg !== "string") throw new Error("malformed JWS: header missing `alg`");
  if (kid !== undefined && typeof kid !== "string") throw new Error("malformed JWS: `kid` must be a string");

  return {
    header: kid === undefined ? { alg } : { alg, kid },
    payload,
    // Verify over the original encoded strings — never re-encode the decoded JSON.
    signingInput: `${headerB64}.${payloadB64}`,
    signature: Buffer.from(signatureB64, "base64url"),
  };
}

// Verify a compact JWS against one JWK public key; returns the decoded JWS or throws.
// Signature only — the caller validates claims. The returned header is post-verification,
// so §4 can trust its `alg`/`kid` when logging.
export function verifyJws(token: string, jwk: JsonWebKey): DecodedJws {
  const decoded = decodeJws(token);
  const { header, signingInput, signature } = decoded;

  const params = algParams[header.alg];
  if (!params) throw new Error(`unsupported alg: ${header.alg}`);
  // Block alg confusion: a key may pin its own `alg`, and its type must match the family.
  if (typeof jwk.alg === "string" && jwk.alg !== header.alg) throw new Error("alg mismatch between JWS header and JWK");

  let key: KeyObject;
  try {
    key = createPublicKey({ format: "jwk", key: jwk });
  } catch {
    throw new Error("invalid JWK");
  }
  if (key.asymmetricKeyType !== params.keyType) {
    throw new Error(`JWK type ${key.asymmetricKeyType} does not match alg ${header.alg}`);
  }

  const data = Buffer.from(signingInput);
  const ok = params.dsaEncoding
    ? verify(params.hash, data, { dsaEncoding: params.dsaEncoding, key }, signature)
    : verify(params.hash, data, key, signature);
  if (!ok) throw new Error("invalid signature");

  return decoded;
}
