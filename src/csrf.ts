// CSRF protection for our own POST forms (todo §4). Stateless signed double-submit token:
// the token is `<nonce>.<HMAC(secret, nonce)>`, set as a cookie *and* echoed in a hidden form
// field. A request passes iff the cookie is a genuine signature (can't be forged without the
// secret) and the submitted field equals it. SameSite=Lax already blocks the cross-site POST
// from sending the cookie; the signature + double-submit defend the rest. Kratos' own flows
// carry Kratos' CSRF token — this guards only the routes we handle.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseCookies, serializeCookie } from "./cookie.ts";

export const CSRF_COOKIE = "plainpages_csrf";
export const CSRF_FIELD = "_csrf"; // hidden input name forms submit the token under

const MAX_AGE = 60 * 60 * 24 * 30; // 30d, mirrors the session cookie so the token survives restarts
const NONCE_BYTES = 18;

function sign(secret: string, nonce: string): string {
  return createHmac("sha256", secret).update(nonce).digest("base64url");
}

function timingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function issueCsrfToken(secret: string): string {
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  return `${nonce}.${sign(secret, nonce)}`;
}

// True iff `token` is a `<nonce>.<hmac>` we signed (self-validating — no server state).
export function verifyCsrfToken(secret: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  return timingEqual(token.slice(dot + 1), sign(secret, token.slice(0, dot)));
}

// The token to embed in this request's forms: reuse a genuine cookie token, else mint one
// (`fresh` ⇒ the caller must Set-Cookie it). Reusing keeps every open tab/form on one token.
export function ensureCsrfToken(cookieHeader: string | undefined, secret: string): { fresh: boolean; token: string } {
  const existing = parseCookies(cookieHeader)[CSRF_COOKIE];
  if (existing && verifyCsrfToken(secret, existing)) return { fresh: false, token: existing };
  return { fresh: true, token: issueCsrfToken(secret) };
}

export function csrfCookie(token: string, options: { secure?: boolean } = {}): string {
  return serializeCookie(CSRF_COOKIE, token, { httpOnly: true, maxAge: MAX_AGE, path: "/", sameSite: "Lax", ...(options.secure ? { secure: true } : {}) });
}

// Gate a state-changing request: the cookie must be a genuine signed token and the submitted
// field must equal it. Fail-closed on any missing/forged/mismatched part.
export function verifyCsrfRequest(args: { cookieHeader: string | undefined; secret: string; submitted: string | null | undefined }): boolean {
  const cookieToken = parseCookies(args.cookieHeader)[CSRF_COOKIE];
  if (!cookieToken || !args.submitted) return false;
  if (!verifyCsrfToken(args.secret, cookieToken)) return false;
  return timingEqual(cookieToken, args.submitted);
}
