import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";

const authCard = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "views", "partials", "auth-card.ejs");
const render = (data: Record<string, unknown> = {}): Promise<string> => ejs.renderFile(authCard, data);
const flat = (s: string): string => s.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

test("auth-card renders head, SSO providers (text logo + icon link), body slot and alt footer", async () => {
  const html = flat(await render({
    title: "Sign in", sub: "Welcome back.", action: "/login",
    sso: { providers: [
      { label: "Continue with Google", logo: "G" },
      { label: "Continue with SAML SSO", icon: "i-shield", href: "/sso/saml" },
      { label: "Sign in with Microsoft", logo: "M", name: "provider", value: "microsoft" },
    ] },
    body: '<div id="fields">FORM</div><button class="btn btn-primary btn-block">Sign in</button>',
    alt: { text: "Don't have an account?", href: "/register", label: "Create one" },
  }));

  assert.match(html, /<form class="auth-card" method="post" action="\/login"><div class="auth-head"><h1>Sign in<\/h1><p class="auth-sub">Welcome back\.<\/p><\/div>/);

  // SSO: text-logo button vs icon-logo link, then the divider.
  assert.match(html, /<div class="sso" aria-label="Single sign-on options"><ul class="sso-list">/);
  assert.match(html, /<li><button type="button" class="sso-btn"><span class="sso-logo" aria-hidden="true">G<\/span><span class="sso-label">Continue with Google<\/span><\/button><\/li>/);
  assert.match(html, /<li><a class="sso-btn" href="\/sso\/saml"><span class="sso-logo" aria-hidden="true"><svg class="ico ico-sm"><use href="#i-shield"\s*\/?><\/svg><\/span><span class="sso-label">Continue with SAML SSO<\/span><\/a><\/li>/);
  // A provider with name/value submits to the form (Kratos OIDC) — type="submit", not a decorative
  // button; `formnovalidate` so it bypasses the required email/password fields (SSO needs neither).
  assert.match(html, /<li><button type="submit" class="sso-btn" name="provider" value="microsoft" formnovalidate><span class="sso-logo" aria-hidden="true">M<\/span><span class="sso-label">Sign in with Microsoft<\/span><\/button><\/li>/);
  assert.match(html, /<\/ul><div class="auth-divider">or<\/div><\/div>/);

  // Body slot lands inside .auth-form; alt footer renders text + link.
  assert.match(html, /<div class="auth-form"><div id="fields">FORM<\/div><button class="btn btn-primary btn-block">Sign in<\/button><\/div>/);
  assert.match(html, /<p class="auth-alt">Don&#39;t have an account\? <a href="\/register">Create one<\/a><\/p><\/form>/); // apostrophe is escaped
});

test("auth-card renders a back link, omits SSO/alt when absent, escapes title, and never throws", async () => {
  const back = flat(await render({
    title: "Reset password", sub: "Enter your email.",
    back: { href: "/login", label: "Back to sign in" },
    body: "<button>Send</button>",
  }));
  assert.match(back, /<div class="auth-head"><a class="auth-back" href="\/login"><svg class="ico ico-sm" aria-hidden="true"><use href="#i-arrow-left"\s*\/?><\/svg>Back to sign in<\/a><h1>Reset password<\/h1>/);
  assert.doesNotMatch(back, /class="sso"|auth-alt/);

  // Defaults: post method, empty form, escaped title, no throw.
  assert.match(flat(await render({ title: "<x>" })), /<form class="auth-card" method="post"><div class="auth-head"><h1>&lt;x&gt;<\/h1><\/div><div class="auth-form"><\/div><\/form>/);
  assert.match(flat(await render()), /<form class="auth-card" method="post">/);
});
