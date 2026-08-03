import assert from "node:assert/strict";
import { test } from "node:test";
import { ENGLISH } from "./english.ts";
import { localeHref } from "./locale.ts";
import { i18nLocals, type I18nRequest } from "./view-locals.ts";

const request = (overrides: Partial<I18nRequest> = {}): I18nRequest => ({
  locale: "sv-SE",
  localeHref: (href) => href,
  locales: ["en-US", "sv-SE"],
  method: "GET",
  t: ENGLISH,
  url: new URL("http://localhost/admin/users?q=ada"),
  ...overrides,
});

test("localeSwitch offers this same page in every installed locale, marking the current one", () => {
  const locals = i18nLocals(request());
  assert.deepEqual(locals.localeSwitch.map((c) => c.href), ["/admin/users?q=ada&locale=en-US", "/admin/users?q=ada&locale=sv-SE"]);
  assert.deepEqual(locals.localeSwitch.map((c) => c.current), [false, true]);
  assert.match(locals.localeSwitch[1]?.label ?? "", /svenska/i); // named in its own language
});

test("localeParam is the tag only when the URL asked — it is what the GET forms carry", () => {
  // The probe asks the very function that decides, so the two can't drift apart.
  assert.equal(i18nLocals(request()).localeParam, null); // identity localeHref ⇒ nothing was chosen
  assert.equal(i18nLocals(request({ localeHref: (href) => localeHref(href, "sv-SE") })).localeParam, "sv-SE");
});

test("dir follows the locale's script", () => {
  assert.equal(i18nLocals(request()).dir, "ltr");
  assert.equal(i18nLocals(request({ locale: "ar-EG" })).dir, "rtl");
});

test("a page rendered from a POST offers no language links — that URL may have no GET at all", () => {
  // Following one would dead-end on a 405 (a POST-only route), or silently discard a re-rendered
  // form's input. The picker renders nothing below two choices, so an empty list hides it.
  assert.deepEqual(i18nLocals(request({ method: "POST" })).localeSwitch, []);
});
