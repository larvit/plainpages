import assert from "node:assert/strict";
import { test } from "node:test";
import { ENGLISH } from "./english.ts";
import { localeHref } from "./locale.ts";
import { i18nLocals, type I18nRequest } from "./view-locals.ts";

const request = (overrides: Partial<I18nRequest> = {}): I18nRequest => ({
  locale: "sv-SE",
  localeHref: (href) => href,
  locales: ["en-US", "sv-SE"],
  switchBase: "/admin/users?q=ada",
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

test("the picker points wherever the host says — after a POST that is the nearest page answering GET", () => {
  // The picker is on every page; on a POST-rendered one its own URL may answer no GET, so the host
  // resolves the target (app.ts → switchBase) and this just renders it.
  const locals = i18nLocals(request({ switchBase: "/admin/users/u1" }));
  assert.deepEqual(locals.localeSwitch.map((c) => c.href), ["/admin/users/u1?locale=en-US", "/admin/users/u1?locale=sv-SE"]);
});
