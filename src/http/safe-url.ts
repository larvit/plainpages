//   safeUrl(value)   — a URL field is emitted verbatim into an href/src, so a `javascript:`/`data:`
//                      URL from untrusted data would be live XSS. Relative or http(s) passes,
//                      anything else collapses to "#". Exported to plugins via plugin-api.ts.
//   localPath(value) — the redirect-URI allowlist for `return_to`: host-relative passes, absolute
//                      or protocol-relative is rejected, so a crafted value can't open-redirect.

// ASCII control chars + space that browsers strip/ignore when resolving a URL — strip them before
// the scheme check so "java\tscript:" / a leading space can't masquerade as relative.
const CONTROL_G = /[\u0000-\u0020\u007f]/g;
const CONTROL = /[\u0000-\u0020\u007f]/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i; // a URL scheme prefix, e.g. "javascript:", "http:"
const HTTP_SCHEME = /^https?:/i;

export function safeUrl(value: string): string {
  const cleaned = value.replace(CONTROL_G, "");
  if (!cleaned) return "#";
  // A scheme present? Allow only http(s). No scheme ⇒ relative ⇒ safe. Return the original once
  // deemed safe (EJS still HTML-escapes it into the attribute; the inert control chars don't matter).
  if (HAS_SCHEME.test(cleaned) && !HTTP_SCHEME.test(cleaned)) return "#";
  return value;
}

export function localPath(value: string | null | undefined): string | null {
  if (!value || CONTROL.test(value)) return null;
  if (!value.startsWith("/")) return null; // must be host-relative
  if (value.startsWith("//") || value.startsWith("/\\")) return null; // protocol-relative ⇒ off-origin
  return value;
}
