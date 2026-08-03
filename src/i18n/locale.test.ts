import assert from "node:assert/strict";
import { test } from "node:test";
import { localeHref, localeLabel, matchLocale, parseAcceptLanguage, resolveLocale, textDirection } from "./locale.ts";

const available = ["en-US", "sv-FI", "sv-SE"];

test("parseAcceptLanguage orders tags by q, dropping wildcards and junk", () => {
  assert.deepEqual(parseAcceptLanguage("sv-SE,sv;q=0.9,en-US;q=0.8"), ["sv-SE", "sv", "en-US"]);
  assert.deepEqual(parseAcceptLanguage("en;q=0.2, sv;q=0.9, de"), ["de", "sv", "en"]); // no q ⇒ 1.0
  assert.deepEqual(parseAcceptLanguage("*, sv;q=0.5"), ["sv"]);
  assert.deepEqual(parseAcceptLanguage(""), []);
  assert.deepEqual(parseAcceptLanguage(undefined), []);
});

test("matchLocale takes an exact tag, case-insensitively", () => {
  assert.equal(matchLocale("sv-SE", available), "sv-SE");
  assert.equal(matchLocale("SV-se", available), "sv-SE");
});

test("matchLocale never substitutes another region", () => {
  assert.equal(matchLocale("sv-NO", available), null); // sv-SE exists, but the request asked for Norway
  assert.equal(matchLocale("de-DE", available), null);
});

test("matchLocale resolves a lone language to the first matching regional catalog", () => {
  assert.equal(matchLocale("sv", available), "sv-FI"); // alphabetically first of sv-FI / sv-SE
  assert.equal(matchLocale("sv", ["en-US", "sv-SE"]), "sv-SE");
  assert.equal(matchLocale("sv", ["sv-SE", "sv-FI"]), "sv-FI"); // input order must not matter
  assert.equal(matchLocale("en", available), "en-US");
});

test("matchLocale rejects malformed input instead of guessing", () => {
  for (const bad of ["", "!!", "sv_SE", "e", "../../etc", undefined, null]) {
    assert.equal(matchLocale(bad, available), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("resolveLocale: ?locale wins over Accept-Language", () => {
  const got = resolveLocale({ acceptLanguage: "en-US", available, param: "sv-SE" });
  assert.deepEqual(got, { explicit: true, locale: "sv-SE" });
});

test("resolveLocale: an unmatched ?locale falls through to Accept-Language", () => {
  const got = resolveLocale({ acceptLanguage: "de-DE;q=0.9, sv;q=0.8", available, param: "es-ES" });
  assert.deepEqual(got, { explicit: false, locale: "sv-FI" });
});

test("resolveLocale: nothing matches ⇒ en-US, and no request carried a locale", () => {
  assert.deepEqual(resolveLocale({ available, param: null }), { explicit: false, locale: "en-US" });
  assert.deepEqual(resolveLocale({ acceptLanguage: "de-DE", available, param: "" }), { explicit: false, locale: "en-US" });
});

test("localeHref carries the locale on host-relative links only", () => {
  assert.equal(localeHref("/admin/users", "sv-SE"), "/admin/users?locale=sv-SE");
  assert.equal(localeHref("/admin/users?q=a", "sv-SE"), "/admin/users?q=a&locale=sv-SE");
  assert.equal(localeHref("/admin/users?locale=en-US", "sv-SE"), "/admin/users?locale=sv-SE"); // replaced, never doubled
  assert.equal(localeHref("/docs#top", "sv-SE"), "/docs?locale=sv-SE#top");
  assert.equal(localeHref("/admin/users", null), "/admin/users"); // no explicit locale ⇒ untouched
  assert.equal(localeHref("https://example.com/x", "sv-SE"), "https://example.com/x"); // off-site
  assert.equal(localeHref("//example.com/x", "sv-SE"), "//example.com/x"); // protocol-relative is off-site too
  assert.equal(localeHref("", "sv-SE"), "");
  // The building blocks document href as optional (an unlinked page item, a header with no sort
  // target) — an absent one must not throw, or the page breaks only for visitors who chose a language.
  assert.equal(localeHref(undefined as unknown as string, "sv-SE"), undefined);
  assert.equal(localeHref(null as unknown as string, "sv-SE"), null);
});

test("textDirection reads the script direction, defaulting to ltr", () => {
  assert.equal(textDirection("en-US"), "ltr");
  assert.equal(textDirection("sv-SE"), "ltr");
  assert.equal(textDirection("ar-EG"), "rtl");
  assert.equal(textDirection("not a locale"), "ltr");
});

test("localeLabel names a locale in its own language", () => {
  assert.match(localeLabel("sv-SE"), /svenska/i);
  assert.equal(localeLabel("not a locale"), "not a locale"); // fail soft: the tag itself
});
