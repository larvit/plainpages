import assert from "node:assert/strict";
import { test } from "node:test";
import { localPath, safeUrl } from "./safe-url.ts";

test("safeUrl: passes relative + http(s) through, neutralises dangerous schemes", () => {
  // Relative forms (no scheme) and http(s) are rendered as-is.
  assert.equal(safeUrl("/admin/users?q=1#f"), "/admin/users?q=1#f");
  assert.equal(safeUrl("?q=1"), "?q=1");
  assert.equal(safeUrl("#frag"), "#frag");
  assert.equal(safeUrl("shifts/edit"), "shifts/edit");
  assert.equal(safeUrl("http://example.com/x"), "http://example.com/x");
  assert.equal(safeUrl("https://example.com/x"), "https://example.com/x");
  assert.equal(safeUrl("HTTPS://EXAMPLE.com"), "HTTPS://EXAMPLE.com"); // scheme match is case-insensitive
  // Any other scheme (the contract is: relative or http(s) only) ⇒ neutralised to "#".
  assert.equal(safeUrl("javascript:alert(1)"), "#");
  assert.equal(safeUrl("data:text/html,<script>alert(1)</script>"), "#");
  assert.equal(safeUrl("vbscript:msgbox(1)"), "#");
  assert.equal(safeUrl("mailto:x@y.z"), "#");
  // Control-char / leading-whitespace obfuscation can't slip a scheme past the check (browsers
  // strip TAB/CR/LF and leading controls before resolving the scheme).
  assert.equal(safeUrl("java\tscript:alert(1)"), "#");
  assert.equal(safeUrl("java\nscript:alert(1)"), "#");
  assert.equal(safeUrl("  javascript:alert(1)"), "#");
  // Empty / control-only ⇒ a safe no-op href.
  assert.equal(safeUrl(""), "#");
  // Leading Unicode whitespace above U+0020 (NBSP/NEL/LS) is left as-is on purpose: a browser only
  // strips C0+space when resolving an href, so a NBSP-prefixed "javascript:" is an invalid scheme to
  // it too \u2014 it resolves as a relative reference, not script. Documented so the strip set isn't widened later.
  assert.equal(safeUrl("\u00a0javascript:alert(1)"), "\u00a0javascript:alert(1)");
});

test("localPath: accepts host-relative paths, rejects absolute / protocol-relative / odd input", () => {
  assert.equal(localPath("/admin/users?q=1&page=2"), "/admin/users?q=1&page=2");
  assert.equal(localPath("/"), "/");
  // Protocol-relative and backslash variants are off-origin → rejected (open-redirect guard).
  assert.equal(localPath("//evil.com"), null);
  assert.equal(localPath("/\\evil.com"), null);
  assert.equal(localPath("https://evil.com"), null);
  assert.equal(localPath("javascript:alert(1)"), null);
  assert.equal(localPath("relative/no-leading-slash"), null);
  // Control chars / whitespace (a return_to is a server-built path) ⇒ rejected.
  assert.equal(localPath("/x\nSet-Cookie: y"), null);
  assert.equal(localPath("/a b"), null);
  assert.equal(localPath(""), null);
  assert.equal(localPath(null), null);
  assert.equal(localPath(undefined), null);
});
