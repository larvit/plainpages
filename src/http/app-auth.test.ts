import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "./app.ts";
import { CSRF_COOKIE, issueCsrfToken } from "../auth/csrf.ts";
import { HydraError, type HydraAdmin } from "../auth/hydra-admin.ts";
import { staticJwks } from "../auth/jwks.ts";
import type { Identity } from "../auth/kratos-admin.ts";
import { KratosError, type Flow, type FlowType, type KratosPublic, type Session, type UiNode } from "../auth/kratos-public.ts";
import { SESSION_COOKIE } from "../auth/login.ts";
import { createI18n } from "../i18n/runtime.ts";
import { loadI18n } from "../i18n/load.ts";
import { ecJwk, fakeKeto, mintJwt, mockKratos, OAUTH_SUBJECT, stubAdmin, stubHydra, withWhoami } from "./app-harness.ts";

// A re-rendered login flow: csrf hidden, themed fields, a submit, and a failed-attempt message.
const node = (attrs: Record<string, unknown>, label?: string): UiNode => ({ attributes: attrs, group: "default", messages: [], meta: label ? { label: { id: 1, text: label, type: "info" } } : {}, type: "input" });
const loginFlow = (id: string): Flow => ({
  id,
  ui: {
    action: `http://127.0.0.1:4433/self-service/login?flow=${id}`,
    messages: [{ id: 4000006, text: "The provided credentials are invalid.", type: "error" }],
    method: "post",
    nodes: [
      node({ name: "csrf_token", type: "hidden", value: "tok" }),
      node({ name: "identifier", required: true, type: "email" }, "E-Mail"),
      node({ name: "password", required: true, type: "password" }, "Password"),
      node({ name: "method", type: "submit", value: "password" }, "Sign in"),
      { attributes: { name: "provider", type: "submit", value: "google" }, group: "oidc", messages: [], meta: { label: { id: 1, text: "Sign in with Google", type: "info" } }, type: "input" },
    ],
  },
});

// GET dispatch for the themed auth pages: the same handler branches on session presence.
test("themed auth GET: anonymous inits a flow (CSRF relay, stale→restart); a signed-in user is sent home, except /settings", async (t) => {
  const app = createApp({ jwks: staticJwks([ecJwk]), kratos: mockKratos(async (_t, id) => { if (id === "stale") throw new KratosError("gone", 410, ""); return loginFlow(id); }) });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;

  // Anonymous, no ?flow= → init one + relay Kratos' CSRF cookie.
  const init = await fetch(url + "/login", { redirect: "manual" });
  assert.equal(init.status, 303);
  assert.equal(init.headers.get("location"), "/login?flow=new1");
  assert.match(init.headers.get("set-cookie") ?? "", /csrf_token=abc/);
  // A stale flow id (Kratos 410) bounces back to a fresh init.
  const stale = await fetch(url + "/login?flow=stale", { redirect: "manual" });
  assert.equal(stale.status, 303);
  assert.equal(stale.headers.get("location"), "/login");

  // Already signed in → /login + /registration short-circuit to the app dashboard; /settings stays reachable.
  const signedIn = { headers: { cookie: `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 600, permissions: [], sub: "u1" })}` }, redirect: "manual" as const };
  for (const path of ["/login", "/registration"]) {
    const res = await fetch(url + path, signedIn);
    assert.equal(res.status, 303, `${path} while signed in → 303`);
    assert.equal(res.headers.get("location"), "/dashboard");
  }
  assert.equal((await fetch(url + "/settings", signedIn)).headers.get("location"), "/settings?flow=new1");
});

test("themed auth GET: an existing Kratos session (no app JWT yet) recovers via /auth/complete, never 500", async (t) => {
  // After registration's `session` hook the user holds a Kratos session but no app JWT — so ctx.user
  // is null and the "already signed in" short-circuit can't fire. Initialising a login/registration
  // flow then returns Kratos 400 `session_already_available`; recover by completing login (mint the
  // JWT from the live session), preserving return_to — never fall through to the catch-all 500.
  const sessionRace = new KratosError("Kratos init login flow failed (400)", 400, JSON.stringify({ error: { id: "session_already_available" } }));
  const app = createApp({ jwks: staticJwks([ecJwk]), kratos: { ...mockKratos(async () => loginFlow("x")), initBrowserFlow: async () => { throw sessionRace; } } });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;

  const recover = await fetch(url + "/login", { redirect: "manual" });
  assert.equal(recover.status, 303);
  assert.equal(recover.headers.get("location"), "/auth/complete");
  // return_to is carried through so the deep link still lands after the JWT is minted.
  const deep = await fetch(url + "/login?return_to=" + encodeURIComponent("/admin/users"), { redirect: "manual" });
  assert.equal(deep.headers.get("location"), "/auth/complete?return_to=%2Fadmin%2Fusers");

  // A genuinely unexpected Kratos 400 is still surfaced as a 500 (not masked as a session race).
  const app2 = createApp({ jwks: staticJwks([ecJwk]), kratos: { ...mockKratos(async () => loginFlow("x")), initBrowserFlow: async () => { throw new KratosError("bad", 400, JSON.stringify({ error: { id: "security_csrf_violation" } })); } } });
  await new Promise<void>((r) => app2.listen(0, r));
  t.after(() => app2.close());
  const url2 = `http://localhost:${(app2.address() as AddressInfo).port}`;
  assert.equal((await fetch(url2 + "/login", { redirect: "manual" })).status, 500);
});

test("themed auth GET: an anonymous hit on /settings (Kratos 401) bounces to sign-in with the page as return_to, never 500", async (t) => {
  let failure = new KratosError("Kratos init settings flow failed (401)", 401, "");
  const throwing = async (): Promise<never> => { throw failure; };
  const app = createApp({ jwks: staticJwks([ecJwk]), kratos: { ...mockKratos(throwing), initBrowserFlow: throwing } });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;

  const init = await fetch(url + "/settings", { redirect: "manual" });
  assert.equal(init.status, 303);
  assert.equal(init.headers.get("location"), "/login?return_to=%2Fsettings");
  const existing = await fetch(url + "/settings?flow=f1", { redirect: "manual" });
  assert.equal(existing.headers.get("location"), "/login?return_to=%2Fsettings");
  // /login redirecting to itself would loop, so a 401 there stays the catch-all 500.
  assert.equal((await fetch(url + "/login", { redirect: "manual" })).status, 500);
  // Only a 401 means "sign in": an Ory outage on /settings is still the honest 503.
  failure = new KratosError("Kratos init settings flow failed (500)", 500, "");
  assert.equal((await fetch(url + "/settings", { redirect: "manual" })).status, 503);
});

// return_to: a deep-link login lands back on the requested page. The gate redirects to
// /login?return_to=<host-relative path>; /login bakes that into the Kratos flow so completion
// returns there — but a first-party path must route via /auth/complete first (to mint the JWT).
test("login return_to: a first-party deep link is wrapped through /auth/complete; an absolute target passes through as-is", async (t) => {
  let lastReturnTo: string | undefined;
  const kratos: KratosPublic = {
    ...mockKratos(async (_t, id) => loginFlow(id)),
    initBrowserFlow: async (_t: FlowType, opts = {}) => { lastReturnTo = opts.returnTo; return { flow: { id: "new1", ui: { action: "", method: "post", nodes: [] } }, setCookie: [] }; },
  };
  const app = createApp({ kratos });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;

  // A host-relative deep link → wrapped: Kratos returns to <origin>/auth/complete?return_to=<path>,
  // so the JWT is minted before the user lands on the page (query preserved, re-encoded).
  await fetch(url + "/login?return_to=" + encodeURIComponent("/admin/users?q=1"), { redirect: "manual" });
  assert.match(lastReturnTo ?? "", /^http:\/\/[^/]+\/auth\/complete\?return_to=%2Fadmin%2Fusers%3Fq%3D1$/);

  // An absolute target (the OAuth2 login challenge) is passed to Kratos unchanged — Kratos
  // allow-lists it. A protocol-relative "//evil.com" is likewise not wrapped (Kratos rejects it).
  const abs = "http://localhost/oauth2/login?login_challenge=abc";
  await fetch(url + "/login?return_to=" + encodeURIComponent(abs), { redirect: "manual" });
  assert.equal(lastReturnTo, abs);
  await fetch(url + "/login?return_to=" + encodeURIComponent("//evil.com"), { redirect: "manual" });
  assert.equal(lastReturnTo, "//evil.com");
});

test("login return_to: a chosen language alone still routes through /auth/complete, so it survives the sign-in", async (t) => {
  let lastReturnTo: string | undefined;
  const kratos: KratosPublic = {
    ...mockKratos(async (_t, id) => loginFlow(id)),
    initBrowserFlow: async (_t: FlowType, opts = {}) => { lastReturnTo = opts.returnTo; return { flow: { id: "new1", ui: { action: "", method: "post", nodes: [] } }, setCookie: [] }; },
  };
  const app = createApp({ i18n: createI18n(await loadI18n()), kratos });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;

  lastReturnTo = "unset";
  await fetch(url + "/login", { redirect: "manual" });
  assert.equal(lastReturnTo, undefined, "no target and no language: Kratos keeps its default");
  await fetch(url + "/login?locale=sv-SE", { redirect: "manual" });
  assert.match(lastReturnTo ?? "", /^http:\/\/[^/]+\/auth\/complete\?locale=sv-SE$/);
  await fetch(url + "/login?locale=sv-SE&return_to=" + encodeURIComponent("/admin/users"), { redirect: "manual" });
  assert.match(lastReturnTo ?? "", /^http:\/\/[^/]+\/auth\/complete\?return_to=%2Fadmin%2Fusers%3Flocale%3Dsv-SE&locale=sv-SE$/);

  // An absolute target still reaches Kratos beside a chosen language; the language is lost instead.
  const abs = "http://localhost/oauth2/login?login_challenge=abc";
  await fetch(url + "/login?locale=sv-SE&return_to=" + encodeURIComponent(abs), { redirect: "manual" });
  assert.equal(lastReturnTo, abs);
});

// "Ory down ⇒ no logins" is documented; the auth path should say so honestly (503), not the
// generic "error on our end" 500 the catch-all renders.
test("auth flow when Ory is unreachable → an honest 503, not the catch-all 500", async (t) => {
  const boom = () => { throw new KratosError("kratos down", 503, ""); };
  const down: KratosPublic = { ...mockKratos(async () => boom()), initBrowserFlow: async () => boom() };
  const app = createApp({ kratos: down });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;

  const init = await fetch(url + "/login", { redirect: "manual" }); // init (no ?flow=) with Kratos down
  assert.equal(init.status, 503);
  assert.match(await init.text(), /unavailable/i);
  assert.equal((await fetch(url + "/login?flow=f1")).status, 503); // fetching a flow, Kratos down

  // A network-level throw (refused/timeout — not a KratosError) is treated the same way.
  const refused: KratosPublic = { ...mockKratos(async () => { throw new Error("ECONNREFUSED"); }), initBrowserFlow: async () => { throw new Error("ECONNREFUSED"); } };
  const app2 = createApp({ kratos: refused });
  await new Promise<void>((r) => app2.listen(0, r));
  t.after(() => app2.close());
  assert.equal((await fetch(`http://localhost:${(app2.address() as AddressInfo).port}/login`, { redirect: "manual" })).status, 503);
});

test("renders a fetched flow as the themed auth page: fields post straight to Kratos, errors surface", async (t) => {
  const app = createApp({ kratos: mockKratos(async (_t, id) => loginFlow(id)) });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const html = await (await fetch(`http://localhost:${(app.address() as AddressInfo).port}/login?flow=f1`)).text();

  // The form posts to flow.ui.action (Kratos owns CSRF); csrf rides as a hidden input.
  assert.match(html, /<form class="auth-card" method="post" action="http:\/\/127\.0\.0\.1:4433\/self-service\/login\?flow=f1"/);
  assert.match(html, /<input type="hidden" name="csrf_token" value="tok">/);
  assert.match(html, /name="identifier"/);
  assert.match(html, /name="password"[^>]*type="password"/);
  assert.match(html, /<button type="submit"[^>]*name="method" value="password">Sign in<\/button>/);
  assert.match(html, /<a href="\/registration">Create one<\/a>/); // alt link to register
  // Configured OIDC provider → an SSO submit button in the same form (posts provider=google);
  // `formnovalidate` so it bypasses the required email/password fields (SSO needs neither).
  assert.match(html, /<div class="sso"/);
  assert.match(html, /<button type="submit" class="sso-btn" name="provider" value="google" formnovalidate>.*Sign in with Google<\/span><\/button>/s);
  // The flow-level error renders as an alert.
  assert.match(html, /class="alert alert-neg"/);
  assert.match(html, /The credentials are invalid\./); // 4000006 → our wording (README → Translating)
});

// Login completion: /auth/complete is where Kratos lands the browser after login.
test("login completion (/auth/complete): a live session mints the JWT cookie; no session → /login, no cookie", async (t) => {
  const identity: Identity = { id: "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55", traits: { email: "admin@plainpages.local" } };
  let projected: unknown;
  const kratos = withWhoami(async (o) => (o?.tokenizeAs ? { active: true, identity, tokenized: "h.p.s" } : { active: true, identity }) as Session);
  const kratosAdmin = stubAdmin({ updateMetadataPublic: async (_id, meta) => { projected = meta; return identity; } });
  const keto = fakeKeto([], { check: async () => true, listRelations: async () => ({ nextPageToken: null, tuples: [{ namespace: "Permission", object: "admin", relation: "granted", subject_id: `user:${identity.id}` }] }) });
  const complete = async (app: ReturnType<typeof createApp>, cookie?: string, returnTo?: string) => {
    await new Promise<void>((r) => app.listen(0, r));
    t.after(() => app.close());
    const q = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : "";
    return fetch(`http://localhost:${(app.address() as AddressInfo).port}/auth/complete${q}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  };

  // Live Kratos session: permissions from Keto → projection → tokenize → JWT cookie, land on the dashboard.
  const ok = await complete(createApp({ keto, kratos, kratosAdmin }), "plainpages_session=s");
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/dashboard");
  assert.match(ok.headers.get("set-cookie") ?? "", /^plainpages_jwt=h\.p\.s;.*HttpOnly/);
  assert.deepEqual(projected, { permissions: ["admin"] }); // Keto permissions projected onto the identity for the tokenizer

  // return_to: a safe host-relative target lands the user back where they were headed; an
  // off-origin one is ignored (open-redirect guard) and falls back to the dashboard.
  assert.equal((await complete(createApp({ keto, kratos, kratosAdmin }), "plainpages_session=s", "/admin/users?q=1")).headers.get("location"), "/admin/users?q=1");
  assert.equal((await complete(createApp({ keto, kratos, kratosAdmin }), "plainpages_session=s", "//evil.com")).headers.get("location"), "/dashboard");

  // No Kratos session: nothing minted, bounce to /login with no cookie.
  const none = await complete(createApp({ keto: fakeKeto(), kratos: withWhoami(async () => null), kratosAdmin: stubAdmin({}) }));
  assert.equal(none.status, 303);
  assert.equal(none.headers.get("location"), "/login");
  assert.equal(none.headers.get("set-cookie"), null);
});

test("logout (CSRF-guarded POST): valid token revokes the Kratos session + clears our JWT; bad token → 403", async (t) => {
  const logoutUrl = "http://127.0.0.1:4433/self-service/logout?token=lt";
  // Real Kratos keys off its own session cookie (plainpages_session), not our always-present CSRF cookie.
  const kratos: KratosPublic = { ...mockKratos(async () => { throw new Error("unused"); }), createLogoutFlow: async (o) => (o?.cookie?.includes("plainpages_session") ? { logoutToken: "lt", logoutUrl } : null) };
  const csrfSecret = "logout-secret";
  const app = createApp({ csrfSecret, kratos });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const token = issueCsrfToken(csrfSecret);
  const post = (cookie: string, body: string) =>
    fetch(url + "/logout", { body, headers: { "content-type": "application/x-www-form-urlencoded", cookie }, method: "POST", redirect: "manual" });

  // Valid double-submit (cookie token === form token) + active session → Kratos logout URL, JWT cleared.
  const out = await post(`${CSRF_COOKIE}=${token}; ${SESSION_COOKIE}=x; plainpages_session=s`, `_csrf=${token}`);
  assert.equal(out.status, 303);
  assert.equal(out.headers.get("location"), logoutUrl);
  assert.match(out.headers.getSetCookie().join("\n"), /plainpages_jwt=;.*Max-Age=0/);

  // No active Kratos session → clear our cookie and land on /login ourselves.
  const none = await post(`${CSRF_COOKIE}=${token}`, `_csrf=${token}`);
  assert.equal(none.status, 303);
  assert.equal(none.headers.get("location"), "/login");
  assert.match(none.headers.getSetCookie().join("\n"), /plainpages_jwt=;.*Max-Age=0/);

  // Missing field and a forged token are both refused (no Kratos call, no cookie cleared).
  assert.equal((await post(`${CSRF_COOKIE}=${token}`, "")).status, 403);
  assert.equal((await post(`${CSRF_COOKIE}=${token}`, "_csrf=forged.sig")).status, 403);
  assert.equal((await post("", `_csrf=${token}`)).status, 403); // no cookie to match
});


const oauthSession = (): Session => ({ active: true, identity: { id: OAUTH_SUBJECT, traits: { email: "ada@x.io" } } });

test("OAuth2 login challenge (/oauth2/login): a Kratos session accepts via Hydra; no session bounces to /login; missing challenge → 400", async (t) => {
  const identity = { id: "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55" };
  let acceptedSubject: string | undefined;
  const hydra = stubHydra({ acceptLoginRequest: async (_c, b) => { acceptedSubject = b.subject; return { redirect: "http://127.0.0.1:4444/oauth2/auth?login_verifier=v" }; } });

  const signedIn = createApp({ hydra, kratos: withWhoami(async () => ({ active: true, identity }) as Session) });
  await new Promise<void>((r) => signedIn.listen(0, r));
  t.after(() => signedIn.close());
  const base = `http://localhost:${(signedIn.address() as AddressInfo).port}`;

  // Signed in: accept the challenge with the Kratos identity → 303 to Hydra's resume URL.
  const accept = await fetch(base + "/oauth2/login?login_challenge=chal1", { headers: { cookie: "plainpages_session=s" }, redirect: "manual" });
  assert.equal(accept.status, 303);
  assert.match(accept.headers.get("location") ?? "", /\/oauth2\/auth\?login_verifier=v/);
  assert.equal(acceptedSubject, identity.id);

  // Missing login_challenge → 400 (someone hit the endpoint directly).
  assert.equal((await fetch(base + "/oauth2/login", { redirect: "manual" })).status, 400);

  // Not signed in: bounce to the themed login, return_to carrying an absolute URL back to here.
  const anon = createApp({ hydra: stubHydra(), kratos: withWhoami(async () => null) });
  await new Promise<void>((r) => anon.listen(0, r));
  t.after(() => anon.close());
  const bounce = await fetch(`http://localhost:${(anon.address() as AddressInfo).port}/oauth2/login?login_challenge=chal1`, { redirect: "manual" });
  assert.equal(bounce.status, 303);
  const loc = bounce.headers.get("location") ?? "";
  assert.match(loc, /^\/login\?return_to=/);
  assert.match(decodeURIComponent(loc.split("return_to=")[1]!), /^http:\/\/[^/]+\/oauth2\/login\?login_challenge=chal1$/);
});

test("OAuth2 consent challenge (/oauth2/consent): skip auto-accepts; a third-party shows the screen; allow/deny POST; CSRF-guarded; missing challenge", async (t) => {
  const csrfSecret = "consent-secret";
  let granted: { grant_scope?: string[]; session?: unknown } | undefined;
  const hydra = stubHydra({
    acceptConsentRequest: async (_c, b) => { granted = b; return { redirect: "http://127.0.0.1:4444/oauth2/auth?consent_verifier=v" }; },
    rejectConsentRequest: async () => ({ redirect: "http://acme.example/cb?error=access_denied" }),
  });
  const app = createApp({ csrfSecret, hydra, kratos: withWhoami(async () => oauthSession()) });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const base = `http://localhost:${(app.address() as AddressInfo).port}`;
  const token = issueCsrfToken(csrfSecret);
  const post = (body: string) =>
    fetch(base + "/oauth2/consent", { body, headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${CSRF_COOKIE}=${token}` }, method: "POST", redirect: "manual" });

  // Third-party (default stub: not first-party, not skipped) → 200 consent screen listing the
  // client + scopes, with a CSRF cookie its form echoes back; posts to our own /oauth2/consent.
  const page = await fetch(base + "/oauth2/consent?consent_challenge=cons1", { redirect: "manual" });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Authorize Acme Reports/);
  assert.match(html, /openid/);
  assert.match(html, /profile/);
  assert.match(html, /action="\/oauth2\/consent"/);
  // Informed consent: the screen names the account being authorized + offers a sign-out escape.
  assert.match(html, /Signed in as.*ada@x\.io/s);
  assert.match(html, /action="\/logout".*Sign out/s);
  assert.match(page.headers.get("set-cookie") ?? "", /plainpages_csrf=/);

  // Allow → 303 to Hydra, granting the scopes re-read from the challenge (never form-supplied) +
  // id_token claims from the Kratos identity.
  const allow = await post(`_csrf=${token}&consent_challenge=cons1&decision=allow`);
  assert.equal(allow.status, 303);
  assert.match(allow.headers.get("location") ?? "", /\/oauth2\/auth\?consent_verifier=v/);
  assert.deepEqual(granted?.grant_scope, ["openid", "profile"]);
  assert.deepEqual(granted?.session, { id_token: { email: "ada@x.io" } });

  // Deny → 303 back to the client with access_denied.
  const deny = await post(`_csrf=${token}&consent_challenge=cons1&decision=deny`);
  assert.equal(deny.status, 303);
  assert.equal(deny.headers.get("location"), "http://acme.example/cb?error=access_denied");

  // Forged/missing CSRF → 403 (no Hydra call); missing challenge → 400.
  assert.equal((await post("decision=allow")).status, 403);
  assert.equal((await fetch(base + "/oauth2/consent", { redirect: "manual" })).status, 400);

  // A Hydra-skipped client auto-accepts on GET (no screen) → 303 to Hydra.
  const skip = createApp({ hydra: stubHydra({ getConsentRequest: async () => ({ challenge: "cons1", requested_scope: ["openid"], skip: true, subject: OAUTH_SUBJECT }) }), kratos: withWhoami(async () => oauthSession()) });
  await new Promise<void>((r) => skip.listen(0, r));
  t.after(() => skip.close());
  const auto = await fetch(`http://localhost:${(skip.address() as AddressInfo).port}/oauth2/consent?consent_challenge=cons1`, { redirect: "manual" });
  assert.equal(auto.status, 303);
  assert.match(auto.headers.get("location") ?? "", /consent_verifier=v/);
});

test("OAuth2 RP-initiated logout (/oauth2/logout): accepts the logout challenge → 303 to Hydra; missing → 400", async (t) => {
  let acceptedChallenge: string | undefined;
  const hydra = stubHydra({ acceptLogoutRequest: async (c) => { acceptedChallenge = c; return { redirect: "http://acme.example/post-logout" }; } });
  const app = createApp({ hydra, kratos: withWhoami(async () => null) });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const base = `http://localhost:${(app.address() as AddressInfo).port}`;

  const ok = await fetch(base + "/oauth2/logout?logout_challenge=lc1", { redirect: "manual" });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "http://acme.example/post-logout");
  assert.equal(acceptedChallenge, "lc1");

  assert.equal((await fetch(base + "/oauth2/logout", { redirect: "manual" })).status, 400);
});

// All three OAuth2 challenge endpoints share one degrade contract (the documented "byte-identical"
// behaviour): a stale/consumed challenge (Hydra 4xx — back button, slow login) → recoverable 400,
// a genuine Hydra outage (5xx) → 500.
test("OAuth2 challenge endpoints degrade identically: stale Hydra 4xx → 400, outage 5xx → 500", async (t) => {
  const endpoints: { make: (status: number) => Partial<HydraAdmin>; path: string }[] = [
    { make: (s) => ({ getLoginRequest: async () => { throw new HydraError("x", s, ""); } }), path: "/oauth2/login?login_challenge=x" },
    { make: (s) => ({ getConsentRequest: async () => { throw new HydraError("x", s, ""); } }), path: "/oauth2/consent?consent_challenge=x" },
    { make: (s) => ({ acceptLogoutRequest: async () => { throw new HydraError("x", s, ""); } }), path: "/oauth2/logout?logout_challenge=x" },
  ];
  for (const { make, path } of endpoints) {
    for (const [status, expected] of [[410, 400], [503, 500]] as const) {
      const app = createApp({ hydra: stubHydra(make(status)), kratos: withWhoami(async () => null) });
      await new Promise<void>((r) => app.listen(0, r));
      t.after(() => app.close());
      const res = await fetch(`http://localhost:${(app.address() as AddressInfo).port}${path}`, { redirect: "manual" });
      assert.equal(res.status, expected, `${path} ${status} → ${expected}`);
    }
  }
});

