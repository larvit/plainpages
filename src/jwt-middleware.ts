// JWT session middleware (todo §4): verify our session cookie in-process on every request —
// the hot path that never calls Ory. Select the verify key by `kid` from the cached JWKS,
// check the signature (src/jwt.ts), validate the time/issuer/audience claims, project the
// User onto the request context. `authenticate` fails closed: any bad/expired token ⇒ null
// (anonymous), so the route renders signed-out and the permission gate denies.
import type { User } from "./context.ts";
import { parseCookies } from "./cookie.ts";
import { decodeJws, verifyJws } from "./jwt.ts";
import type { JwksProvider } from "./jwks.ts";
import { SESSION_COOKIE } from "./login.ts";

// Leeway on exp/nbf for small clock drift between Kratos and web.
const DEFAULT_CLOCK_SKEW_SEC = 60;

export interface VerifyOptions {
  audience?: string | undefined; // if set, the token `aud` must include it (else skipped)
  clockSkewSec?: number | undefined;
  issuer?: string | undefined; // if set, the token `iss` must equal it (else skipped)
  now?: number | undefined; // unix seconds; injectable for tests
}

// A rejected token (bad signature, expired, wrong iss/aud, malformed claims). `authenticate`
// swallows it to anonymous; a caller wanting the reason can catch it.
export class TokenError extends Error {}

function num(payload: Record<string, unknown>, claim: string): number | undefined {
  const v = payload[claim];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// Validate the time/issuer/audience claims of an already signature-verified payload.
export function validateClaims(payload: Record<string, unknown>, options: VerifyOptions = {}): void {
  const skew = options.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;
  const now = options.now ?? Math.floor(Date.now() / 1000);

  const exp = num(payload, "exp");
  if (exp === undefined) throw new TokenError("token missing exp");
  if (now > exp + skew) throw new TokenError("token expired");

  const nbf = num(payload, "nbf");
  if (nbf !== undefined && now < nbf - skew) throw new TokenError("token not yet valid");

  if (options.issuer !== undefined && payload["iss"] !== options.issuer) throw new TokenError("token issuer mismatch");

  if (options.audience !== undefined) {
    const aud = payload["aud"];
    const ok = typeof aud === "string" ? aud === options.audience : Array.isArray(aud) && aud.includes(options.audience);
    if (!ok) throw new TokenError("token audience mismatch");
  }
}

// Map verified claims → the request User. sub/email are required (the tokenizer always sets
// them); roles defaults to [] and keeps only string entries (defensive).
export function claimsToUser(payload: Record<string, unknown>): User {
  const sub = payload["sub"];
  if (typeof sub !== "string" || sub === "") throw new TokenError("token missing sub");
  const email = payload["email"];
  if (typeof email !== "string") throw new TokenError("token missing email");
  const roles = payload["roles"];
  return { email, id: sub, roles: Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [] };
}

// Verify a session JWT end-to-end: select the key by `kid`, check the signature, validate
// claims, project the User. Throws TokenError / the underlying verify error on any failure.
export async function verifyToken(token: string, jwks: JwksProvider, options: VerifyOptions = {}): Promise<User> {
  const { header } = decodeJws(token); // unverified — only to read `kid` for key selection
  const jwk = await jwks.getKey(header.kid);
  if (!jwk) throw new TokenError(`no JWKS key for kid ${header.kid ?? "(none)"}`);
  const verified = verifyJws(token, jwk); // throws on a bad signature / disallowed alg
  validateClaims(verified.payload, options);
  return claimsToUser(verified.payload);
}

// The request middleware: read our session cookie, verify it → the User, or null for no
// cookie / any invalid token (fail-closed; the route then renders anonymous and gates deny).
export async function authenticate(cookieHeader: string | undefined, jwks: JwksProvider, options: VerifyOptions = {}): Promise<User | null> {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  try {
    return await verifyToken(token, jwks, options);
  } catch {
    return null;
  }
}
