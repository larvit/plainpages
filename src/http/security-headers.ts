// Set once per request in app.ts, so every response carries them (writeHead merges with setHeader).
// A plugin route may override any per-response via RouteResult.headers.

// The non-obvious parts of the CSP:
//  - script-src 'self' with no 'unsafe-inline' ⇒ an injected <script> can't run. A plugin may still
//    serve its own /public/<id>/*.js for opt-in progressive enhancement.
//  - style-src adds 'unsafe-inline': a few partials carry inline style= attributes.
//  - no form-action: the themed login form posts to Kratos' (often cross-origin) action URL.
const CSP = [
  "base-uri 'self'",
  "default-src 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

export interface SecurityHeaderOptions {
  secure?: boolean; // https deployment (mirrors SECURE_COOKIES) → also emit HSTS
}

export function securityHeaders(options: SecurityHeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "content-security-policy": CSP,
    "cross-origin-opener-policy": "same-origin",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
  // HSTS only over https — ignored (and meaningless) on the dev http origin.
  if (options.secure) headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  return headers;
}
