import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "./app.ts";
import { readFormBody } from "./body.ts";
import { createDenylist } from "../auth/denylist.ts";
import { CSRF_COOKIE, issueCsrfToken } from "../auth/csrf.ts";
import { can, check, GuardError, requireSession } from "../auth/guards.ts";
import { staticJwks } from "../auth/jwks.ts";
import type { Identity } from "../auth/kratos-admin.ts";
import { KratosError, type Session } from "../auth/kratos-public.ts";
import { SESSION_COOKIE } from "../auth/login.ts";
import type { Plugin } from "../plugin-host/plugin.ts";
import { ecJwk, fakeKeto, mintJwt, startApp, stubAdmin, withWhoami } from "./app-harness.ts";

// A test plugin exercising each RouteResult shape, a path param, and the permission gate.
const demoPlugin: Plugin = {
  apiVersion: "1.0.0",
  id: "demo",
  routes: [
    { handler: (ctx) => ({ html: `<p>Hi ${ctx.params.name}</p>` }), method: "GET", path: "/hello/:name" },
    { handler: () => ({ json: { ok: true } }), method: "GET", path: "/data" },
    { handler: () => ({ redirect: "/demo/hello/world" }), method: "POST", path: "/go" },
    { handler: () => ({ html: "secret" }), method: "GET", path: "/secret", permission: "demo:read" },
    { handler: () => ({ html: "open to all" }), method: "GET", path: "/public-page", public: true }, // blessed public
    { handler: () => ({ data: { who: "Plainpages" }, view: "page" }), method: "GET", path: "/page" },
  ],
};

test("mounts plugin routes: params, html/json/redirect/view results, and the permission gate", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pp-plugins-"));
  mkdirSync(join(dir, "demo", "views"), { recursive: true });
  mkdirSync(join(dir, "demo", "public"), { recursive: true });
  // The view also include()s a core building-block partial, proving plugin views reuse them.
  writeFileSync(join(dir, "demo", "views", "page.ejs"), `<h1>Hello <%= who %></h1><%- include("partials/theme-switch") %>`);
  writeFileSync(join(dir, "demo", "public", "app.css"), ".demo{color:red}");
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const url = await startApp(t, [demoPlugin], dir);

  // Path param + html
  const hi = await fetch(url + "/demo/hello/world");
  assert.equal(hi.status, 200);
  assert.match(await hi.text(), /Hi world/);

  // json
  const data = await fetch(url + "/demo/data");
  assert.match(data.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await data.json(), { ok: true });

  // redirect (POST → 303 Location)
  const go = await fetch(url + "/demo/go", { method: "POST", redirect: "manual" });
  assert.equal(go.status, 303);
  assert.equal(go.headers.get("location"), "/demo/hello/world");

  // view rendered from the plugin's own views/, including a core partial
  const page = await (await fetch(url + "/demo/page")).text();
  assert.match(page, /Hello Plainpages/);
  assert.match(page, /role="radiogroup"/); // core partials/theme-switch resolved

  // static asset served from the plugin's own public/ at /public/<id>/
  const css = await fetch(url + "/public/demo/app.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") ?? "", /text\/css/);
  assert.match(await css.text(), /\.demo/);
  assert.equal((await fetch(url + "/public/demo/..%2f..%2fplugin.ts")).status, 403); // traversal still blocked

  // gated route, anonymous → redirect to sign in (like the built-in screens), not a dead-end 403;
  // the requested page is preserved as return_to so login lands the user back there.
  const denied = await fetch(url + "/demo/secret", { redirect: "manual" });
  assert.equal(denied.status, 303);
  assert.equal(denied.headers.get("location"), "/login?return_to=%2Fdemo%2Fsecret");

  // a route marked public is reachable anonymously — no gate, no redirect.
  const open = await fetch(url + "/demo/public-page", { redirect: "manual" });
  assert.equal(open.status, 200);
  assert.match(await open.text(), /open to all/);

  // known path + wrong method → 405 with Allow; unknown path → 404
  const wrong = await fetch(url + "/demo/data", { method: "DELETE" });
  assert.equal(wrong.status, 405);
  assert.match(wrong.headers.get("allow") ?? "", /GET/);
  assert.equal((await fetch(url + "/demo/nope")).status, 404);
});

test("a plugin view renders the native chrome; its forms are CSRF-guarded via ctx.verifyCsrf", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pp-plugins-"));
  mkdirSync(join(dir, "panelkit", "views"), { recursive: true });
  // The view composes the core shell from ctx.chrome — branding, the global nav — and its own
  // CSRF-guarded form carrying chrome.csrfToken (the representative way a plugin form gets the token,
  // independent of the shell's auth-dependent profile/sign-out block).
  writeFileSync(join(dir, "panelkit", "views", "panel.ejs"),
    `<%- include("partials/shell", { body: '<form method="post" action="/panelkit/save"><input type="hidden" name="_csrf" value="' + chrome.csrfToken + '" /></form>', brand: chrome.brand, csrfToken: chrome.csrfToken, nav: include("partials/nav-tree", { nodes: chrome.nav }), title, user: chrome.user }) %>`);
  t.after(() => rmSync(dir, { force: true, recursive: true }));

  const plugin: Plugin = {
    apiVersion: "1.0.0",
    id: "panelkit",
    nav: [{ href: "/panelkit/panel", icon: "i-grid", id: "panelkit", label: "Panel kit" }],
    routes: [
      { handler: (ctx) => ({ data: { chrome: ctx.chrome, title: "Panel" }, view: "panel" }), method: "GET", path: "/panel" },
      {
        handler: async (ctx) => {
          const form = await readFormBody(ctx.req);
          if (!ctx.verifyCsrf(form.get("_csrf"))) throw new GuardError(403, "bad csrf");
          return { redirect: "/panelkit/panel" };
        },
        method: "POST", path: "/save",
      },
    ],
  };

  const secret = "test-csrf-secret";
  const app = createApp({ csrfSecret: secret, plugins: [plugin], pluginsDir: dir });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;

  // GET renders the shell: branding (DEFAULT_MENU), the (ungated) plugin nav, and a CSRF cookie
  // whose token is embedded in the plugin's own form (double-submit).
  const res = await fetch(url + "/panelkit/panel");
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /class="brand-name">Plainpages/);
  assert.match(body, /Panel kit/);
  const cookieTok = /plainpages_csrf=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  assert.ok(cookieTok, "a plugin route issues the CSRF cookie when fresh");
  assert.equal(/name="_csrf" value="([^"]+)"/.exec(body)?.[1], cookieTok);

  // POST with no token → 403 (ctx.verifyCsrf fails closed); matching cookie + field → 303.
  assert.equal((await fetch(url + "/panelkit/save", { method: "POST", redirect: "manual" })).status, 403);
  const tok = issueCsrfToken(secret);
  const ok = await fetch(url + "/panelkit/save", {
    body: `_csrf=${encodeURIComponent(tok)}`,
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${CSRF_COOKIE}=${tok}` },
    method: "POST", redirect: "manual",
  });
  assert.equal(ok.status, 303);
});

// JWT middleware: a verified session cookie populates ctx.user/permissions, which the gate reads.
test("a verified session JWT authorizes a permission-gated route; no cookie / expired token → sign in", async (t) => {
  const app = createApp({ jwks: staticJwks([ecJwk]), plugins: [demoPlugin] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const secret = (cookie?: string) => fetch(url + "/demo/secret", { redirect: "manual", ...(cookie ? { headers: { cookie } } : {}) });

  // Token carrying the gating permission → the handler runs (200).
  const ok = await secret(`${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec + 600, permissions: ["demo:read"], sub: "u1" })}`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "secret");

  // No cookie and an expired token both render anonymous → the gate bounces to sign in (303 → /login,
  // remembering the gated page as return_to).
  const noCookie = await secret();
  assert.equal(noCookie.status, 303);
  assert.equal(noCookie.headers.get("location"), "/login?return_to=%2Fdemo%2Fsecret");
  assert.equal((await secret(`${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec - 600, permissions: ["demo:read"], sub: "u1" })}`)).status, 303);

  // The gated dashboard renders for any signed-in user; anonymous is bounced to sign in before any
  // page renders (gate on /dashboard). The Admin section links come from the admin plugin — its nav
  // composition + permission-filtering is covered in the admin-screen tests below.
  const dash = await fetch(url + "/dashboard", { headers: { cookie: `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec + 600, permissions: ["admin"], sub: "u1" })}` } });
  assert.equal(dash.status, 200);
  const anonDash = await fetch(url + "/dashboard", { redirect: "manual" });
  assert.equal(anonDash.status, 303);
  assert.equal(anonDash.headers.get("location"), "/login?return_to=%2Fdashboard");
});

test("revocation denylist: a revoked subject's token stops authorizing on the hot path; a fresh re-login passes", async (t) => {
  const denylist = createDenylist(); // no Ory clients ⇒ a revoked token drops straight to anonymous (no re-mint)
  const app = createApp({ denylist, jwks: staticJwks([ecJwk]), plugins: [demoPlugin] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const secret = (iat: number) => fetch(url + "/demo/secret", { redirect: "manual", headers: { cookie: `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec + 600, iat, permissions: ["demo:read"], sub: "u1" })}` } });

  assert.equal((await secret(nowSec)).status, 200); // before any revoke, the token authorizes

  denylist.revoke("u1");
  assert.equal((await secret(nowSec - 5)).status, 303); // the pre-revoke token now bounces to /login
  assert.equal((await secret(nowSec + 5)).status, 200); // a fresh re-login (iat after the revoke) still works
});

test("session re-mint: an expired JWT backed by a live Kratos session is silently re-minted; a dead session clears it", async (t) => {
  const identity: Identity = { id: "u1", traits: { email: "a@b.c" } };
  const nowSec = Math.floor(Date.now() / 1000);
  const freshJwt = mintJwt({ email: "a@b.c", exp: nowSec + 600, permissions: ["demo:read"], sub: "u1" });
  const live = withWhoami(async (o) => (o?.tokenizeAs ? { active: true, identity, tokenized: freshJwt } : { active: true, identity }) as Session);
  const keto = fakeKeto([], { check: async () => true, listRelations: async () => ({ nextPageToken: null, tuples: [{ namespace: "Permission", object: "demo:read", relation: "granted", subject_id: "user:u1" }] }) });
  const expired = `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec - 600, permissions: ["demo:read"], sub: "u1" })}; plainpages_session=s`;

  // Live Kratos session: the lapsed token is re-minted — the gated route runs AND a fresh cookie rides the response.
  const app = createApp({ jwks: staticJwks([ecJwk]), keto, kratos: live, kratosAdmin: stubAdmin({}), plugins: [demoPlugin] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const ok = await fetch(`http://localhost:${(app.address() as AddressInfo).port}/demo/secret`, { headers: { cookie: expired } });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "secret");
  assert.match(ok.headers.get("set-cookie") ?? "", /^plainpages_jwt=/);

  // Kratos session gone: no re-mint, the stale cookie is cleared, the now-anonymous request bounces to sign in.
  const dead = createApp({ jwks: staticJwks([ecJwk]), keto, kratos: withWhoami(async () => null), kratosAdmin: stubAdmin({}), plugins: [demoPlugin] });
  await new Promise<void>((r) => dead.listen(0, r));
  t.after(() => dead.close());
  const denied = await fetch(`http://localhost:${(dead.address() as AddressInfo).port}/demo/secret`, { headers: { cookie: expired }, redirect: "manual" });
  assert.equal(denied.status, 303);
  assert.equal(denied.headers.get("location"), "/login?return_to=%2Fdemo%2Fsecret");
  assert.match(denied.headers.get("set-cookie") ?? "", /^plainpages_jwt=;.*Max-Age=0/);

  // Ory unreachable (not a dead session): whoami throws → degrade to anonymous (bounce to /login, not 500),
  // and leave the cookie untouched so the token can re-mint once Ory recovers.
  const down = createApp({ jwks: staticJwks([ecJwk]), keto, kratos: withWhoami(async () => { throw new KratosError("kratos down", 503, ""); }), kratosAdmin: stubAdmin({}), plugins: [demoPlugin] });
  await new Promise<void>((r) => down.listen(0, r));
  t.after(() => down.close());
  const outage = await fetch(`http://localhost:${(down.address() as AddressInfo).port}/demo/secret`, { headers: { cookie: expired }, redirect: "manual" });
  assert.equal(outage.status, 303);
  assert.equal(outage.headers.get("location"), "/login?return_to=%2Fdemo%2Fsecret");
  assert.equal(outage.headers.get("set-cookie"), null);
});

test("guards map to responses: requireSession → /login, a failed can/check → 403, success runs the handler", async (t) => {
  const keto = { check: async (tuple: { object: string }) => tuple.object === "open" } as unknown as Parameters<typeof check>[0];
  const guarded: Plugin = {
    apiVersion: "1.0.0",
    id: "guarded",
    routes: [
      { handler: (ctx) => ({ html: `hi ${requireSession(ctx).email}` }), method: "GET", path: "/me" },
      { handler: (ctx) => { if (!can(ctx, "admin")) throw new GuardError(403, "no"); return { html: "ok" }; }, method: "GET", path: "/admin-only" },
      { handler: async (ctx) => { if (!(await check(keto, ctx, { namespace: "Resource", object: ctx.params.id ?? "", relation: "view" }))) throw new GuardError(403, "no"); return { html: "seen" }; }, method: "GET", path: "/doc/:id" },
      { handler: () => ({ html: "gated" }), method: "GET", path: "/gated", permission: "secret:read" }, // declarative route gate
      { handler: () => ({ html: "mine" }), method: "GET", path: "/mine", session: true }, // declarative session gate
    ],
  };
  const app = createApp({ jwks: staticJwks([ecJwk]), plugins: [guarded] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const auth = (permissions: string[]) => ({ headers: { cookie: `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec + 600, permissions, sub: "u1" })}` } });

  // requireSession: anonymous bounces to /login (remembering the page); a signed-in user reaches the handler.
  const anon = await fetch(url + "/guarded/me", { redirect: "manual" });
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.get("location"), "/login?return_to=%2Fguarded%2Fme");
  const me = await fetch(url + "/guarded/me", auth([]));
  assert.equal(me.status, 200);
  assert.match(await me.text(), /hi a@b\.c/);

  // can: signed-in but lacking the permission → 403 page; carrying it → 200.
  assert.equal((await fetch(url + "/guarded/admin-only", auth([]))).status, 403);
  assert.equal((await fetch(url + "/guarded/admin-only", auth(["admin"]))).status, 200);

  // check (live Keto): the keto verdict gates the handler.
  assert.equal((await fetch(url + "/guarded/doc/open", auth([]))).status, 200);
  assert.equal((await fetch(url + "/guarded/doc/shut", auth([]))).status, 403);

  // declarative route `permission` gate: anonymous → sign in, signed-in-without-permission → the 403 page, with → 200.
  const gAnon = await fetch(url + "/guarded/gated", { redirect: "manual" });
  assert.equal(gAnon.status, 303);
  assert.equal(gAnon.headers.get("location"), "/login?return_to=%2Fguarded%2Fgated");
  const gDenied = await fetch(url + "/guarded/gated", auth([]));
  assert.equal(gDenied.status, 403);
  assert.match(await gDenied.text(), /403/); // the rendered 403.ejs over HTTP
  assert.equal((await fetch(url + "/guarded/gated", auth(["secret:read"]))).status, 200);

  // declarative `session` gate: anonymous → sign in, and any signed-in user through, grant or none.
  const sAnon = await fetch(url + "/guarded/mine", { redirect: "manual" });
  assert.equal(sAnon.status, 303);
  assert.equal(sAnon.headers.get("location"), "/login?return_to=%2Fguarded%2Fmine");
  assert.equal((await fetch(url + "/guarded/mine", auth([]))).status, 200);
});

test("plugin hooks: onRequest can short-circuit a request and onResponse observes the handler result", async (t) => {
  const seen: string[] = [];
  const hooked: Plugin = {
    apiVersion: "1.0.0",
    hooks: {
      onRequest: (c) => (c.url.pathname === "/hooked/blocked" ? { html: "blocked by hook", status: 403 } : undefined),
      onResponse: (c, r) => void seen.push(`${c.url.pathname}:${r && "html" in r ? r.html : "?"}`),
    },
    id: "hooked",
    routes: [{ handler: () => ({ html: "handler ran" }), method: "GET", path: "/ok" }],
  };
  const url = await startApp(t, [hooked]);

  // onRequest short-circuits before routing — handler never runs; a fresh CSRF cookie still rides the
  // response so a form the hook renders has its matching double-submit cookie.
  const blocked = await fetch(url + "/hooked/blocked");
  assert.equal(blocked.status, 403);
  assert.match(await blocked.text(), /blocked by hook/);
  assert.match(blocked.headers.get("set-cookie") ?? "", /plainpages_csrf=/);

  // A normal route runs the handler; onResponse observed its result.
  assert.match(await (await fetch(url + "/hooked/ok")).text(), /handler ran/);
  assert.ok(seen.includes("/hooked/ok:handler ran"));
});

