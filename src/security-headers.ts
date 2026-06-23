// Response security headers: set once per request in app.ts so every response — page,
// JSON, redirect, static, or error — carries them (writeHead merges with setHeader). A plugin route
// may override any of them per-response via RouteResult.headers (e.g. relax the CSP to ship its own JS).

// Strict default CSP for the zero-JS, server-rendered core:
//  - script-src 'self'  : the core ships no JS; a plugin may still serve its own /public/<id>/*.js for
//                         opt-in progressive enhancement. No 'unsafe-inline' ⇒ an injected <script>
//                         can't run (the main XSS sink).
//  - style-src adds 'unsafe-inline' : a few partials carry inline style= attributes.
//  - img-src adds data:             : favicon + inline data URIs.
//  - no form-action     : the themed login form posts to Kratos' (often cross-origin) action URL.
//  - frame-ancestors 'none' : clickjacking guard (the modern X-Frame-Options).
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
