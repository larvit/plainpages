import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";

const field = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "views", "partials", "field.ejs");
const render = (data: Record<string, unknown> = {}): Promise<string> => ejs.renderFile(field, data);
const flat = (s: string): string => s.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

test("field renders label, icon input, hint, inline link/optional, and a server-driven error", async () => {
  // Error field: aria-invalid + aria-describedby wiring, icon, error markup with raw HTML.
  const errored = flat(await render({
    id: "reg-email", name: "email", label: "Email", type: "email",
    autocomplete: "email", placeholder: "you@company.com", required: true, icon: "i-mail",
    error: { html: 'Already used. <a href="/login">Sign in</a>.' },
  }));
  assert.match(errored, /<div class="field has-error"><label for="reg-email">Email<\/label>/);
  assert.match(errored, /<div class="input-wrap"><svg class="ico ico-sm input-ico" aria-hidden="true"><use href="#i-mail"\s*\/?><\/svg>/);
  assert.match(errored, /<input class="input has-ico" id="reg-email" name="email" type="email" autocomplete="email" placeholder="you@company.com" aria-invalid="true" aria-describedby="reg-email-err" required>/);
  assert.match(errored, /<p class="field-error" id="reg-email-err" role="alert"><svg class="ico ico-sm" aria-hidden="true"><use href="#i-alert"\s*\/?><\/svg><span>Already used\. <a href="\/login">Sign in<\/a>\.<\/span><\/p>/);

  // field-top with an inline link, hint, minlength; no error → no has-error / aria-invalid.
  const withLink = flat(await render({
    id: "login-password", name: "password", label: "Password", type: "password",
    autocomplete: "current-password", placeholder: "••••••••", required: true, minlength: 8, icon: "i-lock",
    link: { href: "/forgot", label: "Forgot password?" }, hint: "Use 8 or more characters.",
  }));
  assert.match(withLink, /<div class="field"><div class="field-top"><label for="login-password">Password<\/label><a class="field-link" href="\/forgot">Forgot password\?<\/a><\/div>/);
  assert.match(withLink, /<input class="input has-ico" id="login-password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" minlength="8" required>/);
  assert.match(withLink, /<span class="field-hint">Use 8 or more characters\.<\/span><\/div>/);
  assert.doesNotMatch(withLink, /has-error|aria-invalid/);

  // field-top with an "Optional" tag, a value, no icon → plain input.
  const optional = flat(await render({
    id: "reg-name", name: "name", label: "Name", optional: true, value: "Avery", autocomplete: "name", placeholder: "Avery Kline",
  }));
  assert.match(optional, /<div class="field-top"><label for="reg-name">Name<\/label><span class="optional">Optional<\/span><\/div>/);
  assert.match(optional, /<div class="input-wrap"><input class="input" id="reg-name" name="name" type="text" autocomplete="name" placeholder="Avery Kline" value="Avery"><\/div>/);
});

test("field defaults to a bare text input, escapes a string error, and never throws", async () => {
  const bare = flat(await render({ id: "x", name: "x", label: "X" }));
  assert.match(bare, /<div class="field"><label for="x">X<\/label><div class="input-wrap"><input class="input" id="x" name="x" type="text"><\/div><\/div>/);

  // OTP code field: inputmode + pattern render (both after autocomplete, before required).
  const code = flat(await render({ id: "field-code", name: "code", label: "Verification code", autocomplete: "one-time-code", inputmode: "numeric", pattern: "[0-9]*", required: true, icon: "i-shield" }));
  assert.match(code, /<input class="input has-ico" id="field-code" name="code" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="\[0-9\]\*" required>/);

  const stringErr = flat(await render({ id: "x", name: "x", label: "X", error: "<b>Required</b>." }));
  assert.match(stringErr, /<span>&lt;b&gt;Required&lt;\/b&gt;\.<\/span>/); // string error is escaped
  assert.match(stringErr, /aria-describedby="x-err"/);
});
