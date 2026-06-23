// Cookie helpers — parse the request `Cookie` header, build secure-by-default
// `Set-Cookie` headers. Stdlib only (no `cookie` dep); stores/clears the session
// JWT + CSRF token here. Values round-trip via percent-encoding; JWT `-_.` chars are
// URI-unreserved, so JWTs stay readable.

export interface CookieOptions {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number; // seconds; 0 / negative expire the cookie immediately
  path?: string;
  sameSite?: "Lax" | "None" | "Strict";
  secure?: boolean;
}

// RFC 6265 cookie-name token: no control chars, whitespace, or separators.
const cookieName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// Cookie Expires must be a 4-digit-year HTTP-date (RFC 1123); a Date outside this
// range makes toUTCString() emit a 6-digit/negative year browsers may reject.
const minExpires = Date.UTC(1601, 0, 1);
const maxExpires = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

function decode(value: string): string {
  if (!value.includes("%")) return value; // fast path: nothing to decode
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // malformed input is untrusted — keep raw rather than throw
  }
}

// Parse a `Cookie` header into a name→value map. First occurrence of a name wins.
// Null-prototype result, so a `__proto__`/`constructor` key can't pollute. Header
// length is bounded upstream by Node's `maxHeaderSize` (~16 KB).
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!header) return out;

  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = pair.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[name] = decode(value);
  }
  return out;
}

// Validate a Domain/Path attribute: non-empty (fail loud on a misconfig) and free of
// chars that could inject extra attributes or split the header (CRLF). Cheap insurance
// against Set-Cookie injection, even though these come from config.
function assertAttrSafe(label: string, value: string): void {
  if (value === "" || /[;\x00-\x1f\x7f]/.test(value)) throw new Error(`invalid cookie ${label}: ${JSON.stringify(value)}`);
}

// Build a `Set-Cookie` header value. Throws on inputs that would produce a
// malformed or injectable header.
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!cookieName.test(name)) throw new Error(`invalid cookie name: ${JSON.stringify(name)}`);

  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    if (!Number.isInteger(options.maxAge)) throw new Error("cookie maxAge must be an integer number of seconds");
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.domain !== undefined) {
    assertAttrSafe("domain", options.domain);
    parts.push(`Domain=${options.domain}`);
  }
  if (options.path !== undefined) {
    assertAttrSafe("path", options.path);
    parts.push(`Path=${options.path}`);
  }
  if (options.expires !== undefined) {
    const t = options.expires.getTime();
    if (Number.isNaN(t)) throw new Error("cookie Expires is an invalid Date");
    if (t < minExpires || t > maxExpires) throw new Error("cookie Expires year is out of the 4-digit RFC range");
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite !== undefined) {
    if (options.sameSite === "None" && !options.secure) throw new Error("SameSite=None requires Secure");
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) parts.push("Secure");

  return parts.join("; ");
}
