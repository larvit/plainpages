import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign, type JsonWebKey } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp, type AppOptions } from "./app.ts";
import { readFormBody } from "./body.ts";
import { createLogger } from "./logger.ts";
import { createDenylist } from "./denylist.ts";
import { CSRF_COOKIE, issueCsrfToken } from "./csrf.ts";
import { can, check, GuardError, requireSession } from "./guards.ts";
import { HydraError, type HydraAdmin, type OAuth2Client } from "./hydra-admin.ts";
import { staticJwks } from "./jwks.ts";
import type { ExpandTree, KetoClient, RelationTuple, SubjectSet } from "./keto-client.ts";
import type { Identity, KratosAdmin } from "./kratos-admin.ts";
import { KratosError, type Flow, type FlowType, type KratosPublic, type Session, type UiNode } from "./kratos-public.ts";
import { SESSION_COOKIE } from "./login.ts";
import type { Plugin } from "./plugin.ts";
import { contentTypeFor, resolveStaticPath, routePublic } from "./static.ts";

const viewsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "views");

// A session JWT signed with a throwaway test key — the §4 verify path. Wired into the shared
// `server` (and the per-test apps) so a request can present a valid session; the dashboard and the
// gated routes need one (§10). `staticJwks([ecJwk])` is the matching verify side.
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ecJwk: JsonWebKey = { ...(ec.publicKey.export({ format: "jwk" }) as JsonWebKey), alg: "ES256", kid: "test-kid" };
const b64url = (i: Buffer | string): string => Buffer.from(i).toString("base64url");
function mintJwt(payload: Record<string, unknown>): string {
  const input = `${b64url(JSON.stringify({ alg: "ES256", kid: "test-kid", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
  return `${input}.${b64url(sign("SHA256", Buffer.from(input), { dsaEncoding: "ieee-p1363", key: ec.privateKey }))}`;
}
// A session cookie carrying `roles`, valid for 10 min — the auth most tests need to reach a gated page.
const session = (roles: string[] = []): string =>
  `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 600, roles, sub: "u1" })}`;

const server = createApp({ jwks: staticJwks([ecJwk]) });
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

test("the dashboard at /dashboard: the app-shell People list, gated to a session, filterable via the URL", async () => {
  // The dashboard is gated to a signed-in user (§10), so present a session.
  const res = await fetch(base + "/dashboard", { headers: { cookie: session() } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const html = await res.text();
  // Shell + building blocks composed around the mock data.
  assert.match(html, /Plainpages/); // sidebar brand
  assert.match(html, /<aside class="sidebar"/);
  assert.match(html, /<form class="filters"/);
  assert.match(html, /<table class="table"/);
  assert.match(html, /<footer class="pager"/);
  assert.match(html, /Avery Kline/); // a mock person on page 1
  assert.match(html, /Starter dashboard/); // the default flags itself a demo to replace with a `dashboard` plugin (§10)

  // The Sign-out POST form carries a CSRF token matching the Set-Cookie issued for the page (§4).
  const csrfCookie = (res.headers.get("set-cookie") ?? "").match(/plainpages_csrf=([^;]+)/)?.[1];
  assert.ok(csrfCookie, "GET /dashboard issues a CSRF cookie");
  assert.match(res.headers.get("set-cookie") ?? "", /plainpages_csrf=[^;]+;.*HttpOnly/);
  assert.match(html, /<form class="menu-item-form" method="post" action="\/logout">/);
  assert.match(html, new RegExp(`name="_csrf" value="${csrfCookie!.replace(/[.]/g, "\\.")}"`));

  // A search query filters server-side: a no-match query drops every row.
  const empty = await fetch(base + "/dashboard?q=zzz-no-such-person", { headers: { cookie: session() } });
  assert.doesNotMatch(await empty.text(), /Avery Kline/);
});

test("/ is the public landing (§10): anonymous → 200 with intro + sign-in/register links, no gate", async () => {
  const res = await fetch(base + "/", { redirect: "manual" });
  assert.equal(res.status, 200); // public — no redirect to sign in
  const html = await res.text();
  assert.match(html, /href="\/login"/); // a prominent path to sign in
  assert.match(html, /href="\/registration"/); // and to register
  assert.doesNotMatch(html, /<aside class="sidebar"/); // standalone page, not the signed-in app shell
});

test("/dashboard is gated (§10): an anonymous visitor is bounced to sign in (return_to kept)", async () => {
  const res = await fetch(base + "/dashboard", { redirect: "manual" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login?return_to=%2Fdashboard");
});

test("plugins replace either landing (§10): `home` owns the public /, `dashboard` owns the gated /dashboard", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pp-home-"));
  mkdirSync(join(dir, "portal", "views"), { recursive: true });
  writeFileSync(join(dir, "portal", "views", "welcome.ejs"), `<h1>Welcome to <%= brand %></h1><a href="/login">Sign in</a>`);
  // The dashboard view renders the native app shell from ctx.chrome — the blessed plugin ergonomics:
  // its own title/body, the global menu (chrome.nav), the signed-in user, the Sign-out CSRF token.
  writeFileSync(join(dir, "portal", "views", "board.ejs"),
    `<%- include("partials/shell", { body: "<p>Hi " + user.email + "</p>", brand: chrome.brand, csrfToken: chrome.csrfToken, nav: include("partials/nav-tree", { nodes: chrome.nav }), theme: chrome.theme, title: "My Portal", user: chrome.user }) %>`);
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const portal: Plugin = {
    apiVersion: "1.0.0",
    dashboard: (ctx) => ({ data: { chrome: ctx.chrome, user: ctx.user }, view: "board" }),
    home: () => ({ data: { brand: "Acme" }, view: "welcome" }),
    id: "portal",
  };
  const app = createApp({ jwks: staticJwks([ecJwk]), plugins: [portal], pluginsDir: dir });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;

  // `home` replaces the public landing — still ungated (anonymous sees it).
  const pub = await fetch(url + "/", { redirect: "manual" });
  assert.equal(pub.status, 200);
  assert.match(await pub.text(), /Welcome to Acme/);

  // `dashboard` replaces the gated dashboard — anonymous bounces, a session lands on the plugin's page.
  assert.equal((await fetch(url + "/dashboard", { redirect: "manual" })).status, 303);
  const board = await fetch(url + "/dashboard", { headers: { cookie: session() } });
  assert.equal(board.status, 200);
  const html = await board.text();
  assert.match(html, /<h1 class="page-title">My Portal<\/h1>/); // its own title in the native shell
  assert.match(html, /Hi a@b\.c/); // its handler rendered, with ctx.user
  assert.doesNotMatch(html, /Avery Kline/); // the built-in mock People list is gone — fully replaced
});

test("renders branding from the menu config into the shell: logo + default theme", async (t) => {
  const app = createApp({ jwks: staticJwks([ecJwk]), menu: { branding: { logo: "/public/brand/logo.svg", name: "Acme Ops", theme: "dark" }, override: {} } });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const html = await (await fetch(`http://localhost:${(app.address() as AddressInfo).port}/dashboard`, { headers: { cookie: session() } })).text();

  assert.match(html, /<img class="brand-logo" src="\/public\/brand\/logo\.svg"/);
  assert.match(html, /Acme Ops/);
  assert.match(html, /id="theme-dark"\s+checked/); // config default theme reaches the switch
});

test("emits a structured access-log line per request (the injected §9 logger)", async (t) => {
  const lines: string[] = [];
  const app = createApp({ log: createLogger({ format: "json", level: "info", stderr: () => {}, stdout: (m) => lines.push(m) }) });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const res = await fetch(`http://localhost:${(app.address() as AddressInfo).port}/?q=zz`); // the public "/" — no auth
  assert.equal(res.status, 200);
  await res.text(); // consume the body so the connection closes (the access line emits on close)

  // The line is emitted on connection close (after the body is sent) — poll briefly for it.
  let line: string | undefined;
  for (let i = 0; i < 50 && !line; i++) {
    line = lines.find((l) => l.includes('"msg":"request"'));
    if (!line) await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(line, "an access line is logged for the request");
  const rec = JSON.parse(line!);
  assert.equal(rec.method, "GET");
  assert.equal(rec.path, "/"); // pathname only — the ?q=… query is dropped (may carry tokens)
  assert.equal(rec.status, 200);
  assert.equal(rec["service.name"], "plainpages");
  assert.equal(typeof rec.ms, "number");
  assert.ok(rec.requestId, "carries a requestId for log↔trace correlation");
});

test("ctx.log: a handler logs in the request trace, and ctx.log.fetch continues the inbound trace (§9)", async (t) => {
  const lines: string[] = [];
  const upstream: { traceparent: string | undefined; url: string }[] = [];
  const realFetch = globalThis.fetch;
  // Intercept only the upstream call; everything else (the test's own request to the server) passes through.
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("http://upstream.test")) return realFetch(input, init);
    upstream.push({ traceparent: new Headers(init?.headers).get("traceparent") ?? undefined, url });
    return new Response("[]", { headers: { "content-type": "application/json" }, status: 200 });
  };
  t.after(() => { globalThis.fetch = realFetch; });

  const plugin: Plugin = {
    apiVersion: "1.0.0",
    id: "obs",
    routes: [{
      handler: async (ctx) => {
        ctx.log.info("ping handled", { who: "obs" }); // plugin logging via ctx.log
        await ctx.log.fetch("http://upstream.test/data"); // an upstream call, traced + propagated
        return { json: { ok: true } };
      },
      method: "GET",
      path: "/ping",
    }],
  };
  const app = createApp({ log: createLogger({ format: "json", level: "info", stderr: () => {}, stdout: (m) => lines.push(m) }), plugins: [plugin] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const base = `http://localhost:${(app.address() as AddressInfo).port}`;

  const inbound = "0af7651916cd43dd8448eb211c80319c";
  await (await fetch(base + "/obs/ping", { headers: { traceparent: `00-${inbound}-b7ad6b7169203331-01` } })).text();

  // ctx.log emitted a line tagged with the request's id (handler ran inside the request trace).
  let pl: string | undefined;
  for (let i = 0; i < 50 && !pl; i++) { pl = lines.find((l) => l.includes('"msg":"ping handled"')); if (!pl) await new Promise((r) => setTimeout(r, 10)); }
  assert.ok(pl, "ctx.log line is emitted");
  const rec = JSON.parse(pl!);
  assert.equal(rec.who, "obs");
  assert.ok(rec.requestId, "the plugin line shares the request id");

  // ctx.log.fetch propagated a W3C traceparent continuing the inbound distributed trace.
  const up = upstream.find((r) => r.url === "http://upstream.test/data");
  assert.ok(up?.traceparent, "ctx.log.fetch injects a traceparent");
  assert.equal(up!.traceparent!.split("-")[1], inbound, "the upstream call continues the inbound trace");
});

test("ctx.log after a client abort doesn't throw: the request log is ended only once the handler unwinds (§9)", async (t) => {
  // The request span is ended on response "close", which also fires on a premature client abort.
  // The handler keeps running after that — its ctx.log must not throw "already ended", so end() is
  // deferred until the handler settles (regression for the abort race).
  let afterCloseOk = false;
  let afterCloseErr: string | undefined;
  const plugin: Plugin = {
    apiVersion: "1.0.0",
    id: "slow",
    routes: [{
      handler: async (ctx) => {
        await new Promise((r) => setTimeout(r, 120)); // outlasts the client abort below
        try { ctx.log.info("after abort", {}); afterCloseOk = true; } // would throw if end() already ran
        catch (e) { afterCloseErr = String(e); }
        return { json: { ok: true } };
      },
      method: "GET",
      path: "/go", // route mounts at /<id>/<path> → /slow/go
    }],
  };
  const app = createApp({ log: createLogger({ level: "none" }), plugins: [plugin] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const base = `http://localhost:${(app.address() as AddressInfo).port}`;

  // Abort the request mid-handler (well before the 120ms), forcing res "close" while it still runs.
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(fetch(base + "/slow/go", { signal: ac.signal })); // the client sees the abort

  await new Promise((r) => setTimeout(r, 200)); // let the handler finish post-abort
  assert.equal(afterCloseErr, undefined, "ctx.log did not throw after the client disconnected");
  assert.ok(afterCloseOk, "the handler logged successfully after close");

  // The server is unharmed — a fresh request still succeeds.
  assert.equal((await fetch(base + "/slow/go")).status, 200);
});

test("static serving: GET sends body + content-type, HEAD headers only, unsafe paths → 403", async () => {
  const get = await fetch(base + "/public/css/styles.css");
  assert.equal(get.status, 200);
  assert.match(get.headers.get("content-type") ?? "", /text\/css/);

  const head = await fetch(base + "/public/css/styles.css", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get("content-length")) > 0);
  assert.equal((await head.text()).length, 0);

  // Encoded traversal and a NUL byte are refused before touching the filesystem.
  assert.equal((await fetch(base + "/public/..%2f..%2fapp.ts")).status, 403);
  assert.equal((await fetch(base + "/public/%00")).status, 403);
});

test("every response carries the security headers; HSTS follows SECURE_COOKIES (§9)", async (t) => {
  // Default app (secureCookies off): a page (the public "/") and a static asset both carry the
  // hardening headers, proving they're set once up front and survive each writeHead (paths merge).
  for (const path of ["/", "/public/css/styles.css"]) {
    const res = await fetch(base + path);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(res.headers.get("x-frame-options"), "DENY", path);
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/, path);
    assert.equal(res.headers.get("strict-transport-security"), null, path); // http dev → no HSTS
  }

  // A https deployment (SECURE_COOKIES=true) adds HSTS.
  const secure = createApp({ secureCookies: true });
  await new Promise<void>((r) => secure.listen(0, r));
  t.after(() => secure.close());
  const res = await fetch(`http://localhost:${(secure.address() as AddressInfo).port}/`);
  assert.match(res.headers.get("strict-transport-security") ?? "", /max-age=\d+/);
});

// Production caches compiled templates; rendering must stay correct across repeated requests.
test("renders correctly with template caching enabled", async () => {
  const app = createApp({ cache: true });
  try {
    await new Promise<void>((resolve) => app.listen(0, resolve));
    const url = `http://localhost:${(app.address() as AddressInfo).port}/`; // the public landing
    for (let i = 0; i < 2; i++) {
      const res = await fetch(url);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /Plainpages/);
    }
  } finally {
    app.close();
  }
});

test("returns the 404 HTML page for unknown routes", async () => {
  const res = await fetch(base + "/missing");
  assert.equal(res.status, 404);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await res.text(), /404/);
});

test("renders the 500 HTML page when a handler throws", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pp-views-"));
  writeFileSync(join(dir, "index.ejs"), "<% throw new Error('boom'); %>"); // the dashboard view
  cpSync(join(viewsDir, "500.ejs"), join(dir, "500.ejs"));
  const app = createApp({ jwks: staticJwks([ecJwk]), viewsDir: dir });
  try {
    await new Promise<void>((resolve) => app.listen(0, resolve));
    // A session reaches the (throwing) dashboard render; the gate would otherwise bounce to /login.
    const res = await fetch(`http://localhost:${(app.address() as AddressInfo).port}/dashboard`, { headers: { cookie: session() } });
    assert.equal(res.status, 500);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await res.text(), /500/);
  } finally {
    app.close();
    rmSync(dir, { force: true, recursive: true });
  }
});

// A test plugin exercising each RouteResult shape, a path param, and the permission gate.
const demoPlugin: Plugin = {
  apiVersion: "1.0.0",
  id: "demo",
  routes: [
    { handler: (ctx) => ({ html: `<p>Hi ${ctx.params.name}</p>` }), method: "GET", path: "/hello/:name" },
    { handler: () => ({ json: { ok: true } }), method: "GET", path: "/data" },
    { handler: () => ({ redirect: "/demo/hello/world" }), method: "POST", path: "/go" },
    { handler: () => ({ html: "secret" }), method: "GET", path: "/secret", permission: "demo:read" },
    { handler: () => ({ html: "open to all" }), method: "GET", path: "/public-page", public: true }, // §10 blessed public
    { handler: () => ({ data: { who: "Plainpages" }, view: "page" }), method: "GET", path: "/page" },
  ],
};

async function startApp(t: TestContext, plugins: Plugin[], pluginsDir?: string): Promise<string> {
  const app = createApp(pluginsDir ? { plugins, pluginsDir } : { plugins });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  return `http://localhost:${(app.address() as AddressInfo).port}`;
}

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

  // a route marked public (§10) is reachable anonymously — no gate, no redirect.
  const open = await fetch(url + "/demo/public-page", { redirect: "manual" });
  assert.equal(open.status, 200);
  assert.match(await open.text(), /open to all/);

  // known path + wrong method → 405 with Allow; unknown path → 404
  const wrong = await fetch(url + "/demo/data", { method: "DELETE" });
  assert.equal(wrong.status, 405);
  assert.match(wrong.headers.get("allow") ?? "", /GET/);
  assert.equal((await fetch(url + "/demo/nope")).status, 404);
});

test("a plugin view renders the native chrome; its forms are CSRF-guarded via ctx.verifyCsrf (§7)", async (t) => {
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

// JWT middleware (§4): a verified session cookie populates ctx.user/roles, which the gate reads.
// The key + mintJwt + session() helper are hoisted above the shared `server` (top of file).
test("a verified session JWT authorizes a role-gated route; no cookie / expired token → sign in", async (t) => {
  const app = createApp({ jwks: staticJwks([ecJwk]), plugins: [demoPlugin] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const secret = (cookie?: string) => fetch(url + "/demo/secret", { redirect: "manual", ...(cookie ? { headers: { cookie } } : {}) });

  // Token carrying the gating role → the handler runs (200).
  const ok = await secret(`${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec + 600, roles: ["demo:read"], sub: "u1" })}`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "secret");

  // No cookie and an expired token both render anonymous → the gate bounces to sign in (303 → /login,
  // remembering the gated page as return_to).
  const noCookie = await secret();
  assert.equal(noCookie.status, 303);
  assert.equal(noCookie.headers.get("location"), "/login?return_to=%2Fdemo%2Fsecret");
  assert.equal((await secret(`${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec - 600, roles: ["demo:read"], sub: "u1" })}`)).status, 303);

  // The dashboard wires in the permission-gated Admin section: an admin's roles surface the links;
  // anonymous is bounced to sign in before any page renders (§10 gate on /dashboard).
  const admin = await fetch(url + "/dashboard", { headers: { cookie: `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec + 600, roles: ["admin"], sub: "u1" })}` } });
  assert.match(await admin.text(), /href="\/admin\/users"/);
  const anonDash = await fetch(url + "/dashboard", { redirect: "manual" });
  assert.equal(anonDash.status, 303);
  assert.equal(anonDash.headers.get("location"), "/login?return_to=%2Fdashboard");
});

test("revocation denylist (§9): a revoked subject's token stops authorizing on the hot path; a fresh re-login passes", async (t) => {
  const denylist = createDenylist(); // no Ory clients ⇒ a revoked token drops straight to anonymous (no re-mint)
  const app = createApp({ denylist, jwks: staticJwks([ecJwk]), plugins: [demoPlugin] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const secret = (iat: number) => fetch(url + "/demo/secret", { redirect: "manual", headers: { cookie: `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec + 600, iat, roles: ["demo:read"], sub: "u1" })}` } });

  assert.equal((await secret(nowSec)).status, 200); // before any revoke, the token authorizes

  denylist.revoke("u1");
  assert.equal((await secret(nowSec - 5)).status, 303); // the pre-revoke token now bounces to /login
  assert.equal((await secret(nowSec + 5)).status, 200); // a fresh re-login (iat after the revoke) still works
});

test("session re-mint: an expired JWT backed by a live Kratos session is silently re-minted; a dead session clears it", async (t) => {
  const identity: Identity = { id: "u1", traits: { email: "a@b.c" } };
  const nowSec = Math.floor(Date.now() / 1000);
  const freshJwt = mintJwt({ email: "a@b.c", exp: nowSec + 600, roles: ["demo:read"], sub: "u1" });
  const live = withWhoami(async (o) => (o?.tokenizeAs ? { active: true, identity, tokenized: freshJwt } : { active: true, identity }) as Session);
  const keto = fakeKeto([], { check: async () => true, listRelations: async () => ({ nextPageToken: null, tuples: [{ namespace: "Role", object: "demo:read", relation: "members", subject_id: "user:u1" }] }) });
  const expired = `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec - 600, roles: ["demo:read"], sub: "u1" })}; plainpages_session=s`;

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
    ],
  };
  const app = createApp({ jwks: staticJwks([ecJwk]), plugins: [guarded] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const auth = (roles: string[]) => ({ headers: { cookie: `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec + 600, roles, sub: "u1" })}` } });

  // requireSession: anonymous bounces to /login (remembering the page); a signed-in user reaches the handler.
  const anon = await fetch(url + "/guarded/me", { redirect: "manual" });
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.get("location"), "/login?return_to=%2Fguarded%2Fme");
  const me = await fetch(url + "/guarded/me", auth([]));
  assert.equal(me.status, 200);
  assert.match(await me.text(), /hi a@b\.c/);

  // can: signed-in but lacking the role → 403 page; carrying it → 200.
  assert.equal((await fetch(url + "/guarded/admin-only", auth([]))).status, 403);
  assert.equal((await fetch(url + "/guarded/admin-only", auth(["admin"]))).status, 200);

  // check (live Keto): the keto verdict gates the handler.
  assert.equal((await fetch(url + "/guarded/doc/open", auth([]))).status, 200);
  assert.equal((await fetch(url + "/guarded/doc/shut", auth([]))).status, 403);

  // declarative route `permission` gate: anonymous → sign in, signed-in-without-role → the 403 page, with → 200.
  const gAnon = await fetch(url + "/guarded/gated", { redirect: "manual" });
  assert.equal(gAnon.status, 303);
  assert.equal(gAnon.headers.get("location"), "/login?return_to=%2Fguarded%2Fgated");
  const gDenied = await fetch(url + "/guarded/gated", auth([]));
  assert.equal(gDenied.status, 403);
  assert.match(await gDenied.text(), /403/); // the rendered 403.ejs over HTTP
  assert.equal((await fetch(url + "/guarded/gated", auth(["secret:read"]))).status, 200);
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

function mockKratos(getFlow: KratosPublic["getFlow"]): KratosPublic {
  return {
    createLogoutFlow: async () => null,
    getFlow,
    initBrowserFlow: async (_t: FlowType) => ({ flow: { id: "new1", ui: { action: "", method: "post", nodes: [] } }, setCookie: ["csrf_token=abc; Path=/; HttpOnly"] }),
    submitFlow: async () => { throw new Error("unused"); },
    whoami: async () => null,
  };
}

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
  const signedIn = { headers: { cookie: `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 600, roles: [], sub: "u1" })}` }, redirect: "manual" as const };
  for (const path of ["/login", "/registration"]) {
    const res = await fetch(url + path, signedIn);
    assert.equal(res.status, 303, `${path} while signed in → 303`);
    assert.equal(res.headers.get("location"), "/dashboard");
  }
  assert.equal((await fetch(url + "/settings", signedIn)).headers.get("location"), "/settings?flow=new1");
});

// return_to (§9): a deep-link login lands back on the requested page. The gate redirects to
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

  // An absolute target (the §6 OAuth2 login challenge) is passed to Kratos unchanged — Kratos
  // allow-lists it. A protocol-relative "//evil.com" is likewise not wrapped (Kratos rejects it).
  const abs = "http://localhost/oauth2/login?login_challenge=abc";
  await fetch(url + "/login?return_to=" + encodeURIComponent(abs), { redirect: "manual" });
  assert.equal(lastReturnTo, abs);
  await fetch(url + "/login?return_to=" + encodeURIComponent("//evil.com"), { redirect: "manual" });
  assert.equal(lastReturnTo, "//evil.com");
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
  assert.match(html, /The provided credentials are invalid\./);
});

// Login completion (§4): /auth/complete is where Kratos lands the browser after login.
const stubAdmin = (over: Partial<KratosAdmin>): KratosAdmin => ({
  createIdentity: async () => { throw new Error("unused"); },
  createRecoveryCode: async () => ({ code: "000000", link: "http://kratos/recover" }),
  deleteIdentity: async () => {},
  getIdentity: async () => null,
  listIdentities: async () => ({ identities: [], nextPageToken: null }),
  updateIdentity: async () => { throw new Error("unused"); },
  updateMetadataPublic: async () => ({ id: "x" }),
  ...over,
});
const sameSet = (a?: SubjectSet, b?: SubjectSet): boolean =>
  (!a && !b) || (!!a && !!b && a.namespace === b.namespace && a.object === b.object && a.relation === b.relation);
const matchesTuple = (t: RelationTuple, f: Partial<RelationTuple>): boolean =>
  (f.namespace === undefined || t.namespace === f.namespace) &&
  (f.object === undefined || t.object === f.object) &&
  (f.relation === undefined || t.relation === f.relation) &&
  (f.subject_id === undefined || t.subject_id === f.subject_id) &&
  (f.subject_set === undefined || sameSet(t.subject_set, f.subject_set));
// A stateful in-memory KetoClient over a tuple array (writes mutate it); used by login + the admin screens.
const fakeKeto = (tuples: RelationTuple[] = [], over: Partial<KetoClient> = {}): KetoClient => ({
  check: async () => false,
  deleteTuple: async (f) => { for (let i = tuples.length - 1; i >= 0; i--) if (matchesTuple(tuples[i]!, f)) tuples.splice(i, 1); },
  expand: async () => ({ type: "leaf" }),
  listRelations: async (q = {}) => ({ nextPageToken: null, tuples: tuples.filter((t) => matchesTuple(t, q)) }),
  writeTuple: async (tp) => { if (!tuples.some((t) => matchesTuple(t, tp) && sameSet(t.subject_set, tp.subject_set))) tuples.push(tp); },
  ...over,
});
const withWhoami = (whoami: KratosPublic["whoami"]): KratosPublic => ({ ...mockKratos(async () => { throw new Error("unused"); }), whoami });

// Shared harness for the §5 admin-screen HTTP tests: an app on a random port with an admin JWT +
// CSRF cookie. get(path, roles)/post(path, body) carry them; `token` is the matching CSRF field.
const ADMIN_CSRF = "admin-secret";
async function adminHarness(t: TestContext, opts: AppOptions = {}) {
  const app = createApp({ csrfSecret: ADMIN_CSRF, jwks: staticJwks([ecJwk]), ...opts });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const token = issueCsrfToken(ADMIN_CSRF);
  const nowSec = Math.floor(Date.now() / 1000);
  const cookie = (roles: string[]) => `${SESSION_COOKIE}=${mintJwt({ email: "admin@x", exp: nowSec + 600, roles, sub: "admin1" })}; ${CSRF_COOKIE}=${token}`;
  const get = (path: string, roles: string[] = ["admin"]) => fetch(url + path, { headers: { cookie: cookie(roles) }, redirect: "manual" });
  const post = (path: string, body: string) =>
    fetch(url + path, { body, headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie(["admin"]) }, method: "POST", redirect: "manual" });
  return { get, post, token, url };
}
// Every admin route is gated: anonymous → /login, a signed-in non-admin → 403.
async function assertAdminGate(url: string, get: (path: string, roles?: string[]) => Promise<Response>, path: string) {
  const anon = await fetch(url + path, { redirect: "manual" });
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.get("location"), `/login?return_to=${encodeURIComponent(path)}`); // remembers the page
  assert.equal((await get(path, [])).status, 403);
}

test("login completion (/auth/complete): a live session mints the JWT cookie; no session → /login, no cookie", async (t) => {
  const identity: Identity = { id: "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55", traits: { email: "admin@plainpages.local" } };
  let projected: unknown;
  const kratos = withWhoami(async (o) => (o?.tokenizeAs ? { active: true, identity, tokenized: "h.p.s" } : { active: true, identity }) as Session);
  const kratosAdmin = stubAdmin({ updateMetadataPublic: async (_id, meta) => { projected = meta; return identity; } });
  const keto = fakeKeto([], { check: async () => true, listRelations: async () => ({ nextPageToken: null, tuples: [{ namespace: "Role", object: "admin", relation: "members", subject_id: `user:${identity.id}` }] }) });
  const complete = async (app: ReturnType<typeof createApp>, cookie?: string, returnTo?: string) => {
    await new Promise<void>((r) => app.listen(0, r));
    t.after(() => app.close());
    const q = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : "";
    return fetch(`http://localhost:${(app.address() as AddressInfo).port}/auth/complete${q}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  };

  // Live Kratos session: roles from Keto → projection → tokenize → JWT cookie, land on the dashboard.
  const ok = await complete(createApp({ keto, kratos, kratosAdmin }), "plainpages_session=s");
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/dashboard");
  assert.match(ok.headers.get("set-cookie") ?? "", /^plainpages_jwt=h\.p\.s;.*HttpOnly/);
  assert.deepEqual(projected, { roles: ["admin"] }); // Keto roles projected onto the identity for the tokenizer

  // return_to (§9): a safe host-relative target lands the user back where they were headed; an
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

// OAuth2 login challenge (§6): another app logs in *through* us; Hydra hands the browser here.
const stubHydra = (over: Partial<HydraAdmin> = {}): HydraAdmin => ({
  acceptConsentRequest: async () => ({ redirect: "http://127.0.0.1:4444/oauth2/auth?consent_verifier=v" }),
  acceptLoginRequest: async () => ({ redirect: "http://127.0.0.1:4444/oauth2/auth?login_verifier=v" }),
  acceptLogoutRequest: async () => ({ redirect: "http://acme.example/post-logout" }),
  createClient: async (c) => ({ ...c, client_id: "c1", client_secret: "s3cr3t" }),
  deleteClient: async () => {},
  getClient: async () => null,
  getConsentRequest: async () => ({ challenge: "cons1", client: { client_name: "Acme Reports" }, requested_scope: ["openid", "profile"], skip: false, subject: OAUTH_SUBJECT }),
  getLoginRequest: async () => ({ challenge: "chal1", skip: false, subject: "" }),
  listClients: async () => ({ clients: [], nextPageToken: null }),
  rejectConsentRequest: async () => ({ redirect: "http://acme.example/cb?error=access_denied" }),
  rejectLoginRequest: async () => { throw new Error("unused"); },
  ...over,
});
const OAUTH_SUBJECT = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55";
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

// Built-in Users admin screen (§5): gate + every CRUD action over HTTP against a mock Kratos admin.
test("admin Users screen: gate, list/filter, create, edit, deactivate, delete, recovery (CSRF-guarded)", async (t) => {
  const mk = (email: string, over: Partial<Identity> = {}): Identity =>
    ({ id: randomUUID(), schema_id: "default", state: "active", traits: { email, name: { first: "Ada", last: "Lovelace" } }, ...over });
  const store: Identity[] = [mk("ada@example.com"), mk("babbage@example.com", { state: "inactive" }), mk("you@example.com", { id: "admin1" })];
  let lastCreate: { traits?: unknown } | undefined;
  const kratosAdmin = stubAdmin({
    createIdentity: async (payload) => { lastCreate = payload as { traits?: unknown }; const created = mk("grace@example.com"); store.push(created); return created; },
    createRecoveryCode: async (id) => ({ code: "123456", link: `http://kratos/self-service/recovery?code=123456&id=${id}` }),
    deleteIdentity: async (id) => { const i = store.findIndex((x) => x.id === id); if (i >= 0) store.splice(i, 1); },
    getIdentity: async (id) => store.find((x) => x.id === id) ?? null,
    listIdentities: async () => ({ identities: store, nextPageToken: null }),
    updateIdentity: async (id, payload) => { const it = store.find((x) => x.id === id)!; Object.assign(it, payload); return it; },
  });
  const denylist = createDenylist(); // §9: a deactivate/delete should revoke the target's live tokens instantly
  const { get, post, token, url } = await adminHarness(t, { denylist, kratosAdmin });

  await assertAdminGate(url, get, "/admin/users");

  // List: the admin sees the rows + the "add" link; the status filter narrows server-side.
  const listHtml = await (await get("/admin/users")).text();
  assert.match(listHtml, /ada@example\.com/);
  assert.match(listHtml, /href="\/admin\/users\/new"/);
  assert.doesNotMatch(await (await get("/admin/users?status=inactive")).text(), /ada@example\.com/);

  // Create: the form renders; a valid post creates the identity and redirects to the list.
  assert.match(await (await get("/admin/users/new")).text(), /Create user/);
  const created = await post("/admin/users", `_csrf=${token}&email=grace%40example.com&first=Grace&last=Hopper&password=`);
  assert.equal(created.status, 303);
  assert.equal(created.headers.get("location"), "/admin/users");
  assert.deepEqual(lastCreate?.traits, { email: "grace@example.com", name: { first: "Grace", last: "Hopper" } });

  // A create with no CSRF token is refused and creates nothing.
  const before = store.length;
  assert.equal((await post("/admin/users", "email=x%40y.z")).status, 403);
  assert.equal(store.length, before);

  // Edit: email is read-only + prefilled; a post rewrites the name.
  const target = store[0]!;
  const editHtml = await (await get(`/admin/users/${target.id}`)).text();
  assert.match(editHtml, /name="email"[^>]*readonly/);
  assert.match(editHtml, /value="ada@example\.com"/);
  const updated = await post(`/admin/users/${target.id}`, `_csrf=${token}&first=Ada&last=King`);
  assert.equal(updated.status, 303);
  assert.deepEqual((target.traits as { name: unknown }).name, { first: "Ada", last: "King" });

  // Deactivate (state toggle): active → inactive, and the target's live tokens are revoked at once (§9).
  await post(`/admin/users/${target.id}/state`, `_csrf=${token}`);
  assert.equal(target.state, "inactive");
  assert.equal(denylist.isRevoked(target.id, 0), true);

  // Recovery: renders the edit page (200) showing the generated code (code-based; no admin-host link).
  const rec = await post(`/admin/users/${target.id}/recovery`, `_csrf=${token}`);
  assert.equal(rec.status, 200);
  const recHtml = await rec.text();
  assert.match(recHtml, /Recovery code generated/);
  assert.match(recHtml, /<code>123456<\/code>/);
  assert.doesNotMatch(recHtml, /self-service\/recovery\?code=/); // the unreachable admin-API link is gone

  // Delete needs a deliberate confirm step (zero-JS): GET renders the interstitial, POST performs it.
  const confirm = await (await get(`/admin/users/${target.id}/delete`)).text();
  assert.match(confirm, /Cancel/);
  assert.match(confirm, new RegExp(`action="/admin/users/${target.id}/delete"`));
  const del = await post(`/admin/users/${target.id}/delete`, `_csrf=${token}`);
  assert.equal(del.status, 303);
  assert.ok(!store.some((x) => x.id === target.id));

  // Self-protection: an admin can't delete or deactivate their own account (JWT sub = admin1).
  assert.equal((await post(`/admin/users/admin1/delete`, `_csrf=${token}`)).status, 400);
  assert.ok(store.some((x) => x.id === "admin1"));
  assert.equal((await post(`/admin/users/admin1/state`, `_csrf=${token}`)).status, 400);
  assert.equal(store.find((x) => x.id === "admin1")!.state, "active");

  // Unknown id → 404; malformed %-encoding → 404 (not a 500), matching groups/roles/clients.
  assert.equal((await get(`/admin/users/${randomUUID()}`)).status, 404);
  assert.equal((await get("/admin/users/%ZZ")).status, 404);
});

// Built-in Groups admin screen (§5): gate + list/create/membership/delete over HTTP against a
// fakeKeto (tuples are the only state) and a stub Kratos admin (resolves member emails).
test("admin Groups screen: gate, list, create, detail/membership, delete (CSRF-guarded)", async (t) => {
  const ada = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b01";
  const grace = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b02";
  const identities: Identity[] = [
    { id: ada, schema_id: "default", state: "active", traits: { email: "ada@example.com" } },
    { id: grace, schema_id: "default", state: "active", traits: { email: "grace@example.com" } },
  ];
  const tuples: RelationTuple[] = [{ namespace: "Group", object: "eng", relation: "members", subject_id: `user:${ada}` }];
  const keto = fakeKeto(tuples);
  const kratosAdmin = stubAdmin({ listIdentities: async () => ({ identities, nextPageToken: null }) });
  const { get, post, token, url } = await adminHarness(t, { keto, kratosAdmin });

  await assertAdminGate(url, get, "/admin/groups");

  // List: the existing group shows + the "add" link.
  const listHtml = await (await get("/admin/groups")).text();
  assert.match(listHtml, /href="\/admin\/groups\/eng"/);
  assert.match(listHtml, /href="\/admin\/groups\/new"/);

  // Create: the form renders; a valid post writes the first-member tuple and redirects to the detail.
  assert.match(await (await get("/admin/groups/new")).text(), /Create group/);
  const created = await post("/admin/groups", `_csrf=${token}&name=design&member=user:${grace}`);
  assert.equal(created.status, 303);
  assert.equal(created.headers.get("location"), "/admin/groups/design");
  assert.ok(tuples.some((tp) => tp.object === "design" && tp.subject_id === `user:${grace}`));

  // An invalid name, a duplicate name, or a missing CSRF token are all refused, nothing written.
  const before = tuples.length;
  assert.equal((await post("/admin/groups", `_csrf=${token}&name=Bad Name&member=user:${grace}`)).status, 400);
  assert.equal((await post("/admin/groups", `_csrf=${token}&name=eng&member=user:${grace}`)).status, 400); // already exists
  assert.equal((await post("/admin/groups", `name=x&member=user:${grace}`)).status, 403);
  assert.equal(tuples.length, before);

  // Detail: lists the current member by email.
  assert.match(await (await get("/admin/groups/eng")).text(), /ada@example\.com/);

  // Add a member, then remove it.
  await post("/admin/groups/eng/members", `_csrf=${token}&member=user:${grace}`);
  assert.ok(tuples.some((tp) => tp.object === "eng" && tp.subject_id === `user:${grace}`));
  await post("/admin/groups/eng/members/delete", `_csrf=${token}&member=user:${grace}`);
  assert.ok(!tuples.some((tp) => tp.object === "eng" && tp.subject_id === `user:${grace}`));

  // Delete the group: a confirm step (GET) then the POST removes every member tuple, back to the list.
  assert.match(await (await get("/admin/groups/eng/delete")).text(), /Cancel/);
  const del = await post("/admin/groups/eng/delete", `_csrf=${token}`);
  assert.equal(del.status, 303);
  assert.equal(del.headers.get("location"), "/admin/groups");
  assert.ok(!tuples.some((tp) => tp.object === "eng"));

  // An invalid group name in the path → 404; malformed %-encoding doesn't 500.
  assert.equal((await get("/admin/groups/Bad%20Name")).status, 404);
  assert.equal((await get("/admin/groups/%ZZ")).status, 404);
});

// Built-in Roles & permissions admin screen (§5): gate + list/create/assign/revoke/delete over HTTP
// against a fake in-memory Keto whose `expand` mirrors Keto's transitive resolution, so the
// effective-access view surfaces a user reachable only through a group.
test("admin Roles screen: gate, list, create, assign user/group, effective access (expand), revoke, delete", async (t) => {
  const ada = randomUUID();
  const grace = randomUUID();
  const identities: Identity[] = [
    { id: ada, schema_id: "default", state: "active", traits: { email: "ada@example.com" } },
    { id: grace, schema_id: "default", state: "active", traits: { email: "grace@example.com" } },
  ];
  // grace is in the `eng` group; `editor` is an existing role whose only direct member is ada.
  const tuples: RelationTuple[] = [
    { namespace: "Group", object: "eng", relation: "members", subject_id: `user:${grace}` },
    { namespace: "Role", object: "editor", relation: "members", subject_id: `user:${ada}` },
  ];
  // Mirror Keto's expand shape: the subject rides on `tuple`, set nodes carry members as children.
  const expandSet = (set: SubjectSet): ExpandTree => ({
    children: tuples
      .filter((tp) => tp.namespace === set.namespace && tp.object === set.object && tp.relation === set.relation)
      .map((tp) => (tp.subject_id ? { tuple: { namespace: "", object: "", relation: "", subject_id: tp.subject_id }, type: "leaf" } : expandSet(tp.subject_set!))),
    tuple: { namespace: "", object: "", relation: "", subject_set: set },
    type: "union",
  });
  const keto = fakeKeto(tuples, { expand: async (set) => expandSet(set) });
  const kratosAdmin = stubAdmin({ listIdentities: async () => ({ identities, nextPageToken: null }) });
  const denylist = createDenylist(); // §9: granting/revoking a *user's* role revokes their live tokens (a group change is transitive → left to lag)
  const { get, post, token, url } = await adminHarness(t, { denylist, keto, kratosAdmin });

  await assertAdminGate(url, get, "/admin/roles");

  // List: the existing role shows + the "add" link.
  const listHtml = await (await get("/admin/roles")).text();
  assert.match(listHtml, /href="\/admin\/roles\/editor"/);
  assert.match(listHtml, /href="\/admin\/roles\/new"/);

  // Create: a valid post writes the first-member tuple and redirects to the detail.
  assert.match(await (await get("/admin/roles/new")).text(), /Create role/);
  const created = await post("/admin/roles", `_csrf=${token}&name=viewer&member=user:${ada}`);
  assert.equal(created.status, 303);
  assert.equal(created.headers.get("location"), "/admin/roles/viewer");
  assert.ok(tuples.some((tp) => tp.namespace === "Role" && tp.object === "viewer" && tp.subject_id === `user:${ada}`));
  assert.equal(denylist.isRevoked(ada, 0), true); // assigning a role to a user revokes their stale token so the grant lands now

  // An invalid name, a duplicate name, or a missing CSRF token are all refused, nothing written.
  const before = tuples.length;
  assert.equal((await post("/admin/roles", `_csrf=${token}&name=Bad Name&member=user:${ada}`)).status, 400);
  assert.equal((await post("/admin/roles", `_csrf=${token}&name=editor&member=user:${ada}`)).status, 400); // already exists
  assert.equal((await post("/admin/roles", `name=x&member=user:${ada}`)).status, 403);
  assert.equal(tuples.length, before);

  // Detail: ada (direct) is in the effective-access list; grace (only reachable via a group) is not
  // yet — though grace appears elsewhere as an assignable candidate, so target the effective <li>.
  const effectiveLi = (email: string) => new RegExp(`<li><span class="cell-strong">${email.replace(".", "\\.")}`);
  const detail = await (await get("/admin/roles/editor")).text();
  assert.match(detail, effectiveLi("ada@example.com"));
  assert.doesNotMatch(detail, effectiveLi("grace@example.com"));

  // Assign the `eng` group to the role → grace now holds it transitively (effective access via expand).
  await post("/admin/roles/editor/members", `_csrf=${token}&member=group:eng`);
  assert.ok(tuples.some((tp) => tp.namespace === "Role" && tp.object === "editor" && tp.subject_set?.object === "eng"));
  const withGroup = await (await get("/admin/roles/editor")).text();
  assert.match(withGroup, effectiveLi("grace@example.com"));

  // Revoke the group membership.
  await post("/admin/roles/editor/members/delete", `_csrf=${token}&member=group:eng`);
  assert.ok(!tuples.some((tp) => tp.namespace === "Role" && tp.object === "editor" && tp.subject_set?.object === "eng"));

  // Unassigning a *user* membership likewise revokes that user's live token (§9), so the loss of access is immediate.
  await post("/admin/roles/editor/members", `_csrf=${token}&member=user:${grace}`);
  await post("/admin/roles/editor/members/delete", `_csrf=${token}&member=user:${grace}`);
  assert.equal(denylist.isRevoked(grace, 0), true);

  // Delete the role: a confirm step (GET) then the POST removes every member tuple, back to the list.
  assert.match(await (await get("/admin/roles/editor/delete")).text(), /Cancel/);
  const del = await post("/admin/roles/editor/delete", `_csrf=${token}`);
  assert.equal(del.status, 303);
  assert.equal(del.headers.get("location"), "/admin/roles");
  assert.ok(!tuples.some((tp) => tp.namespace === "Role" && tp.object === "editor"));

  // Self-protection: the admin role can't be deleted, nor can you revoke your own admin (sub admin1).
  tuples.push({ namespace: "Role", object: "admin", relation: "members", subject_id: "user:admin1" });
  assert.equal((await post("/admin/roles/admin/delete", `_csrf=${token}`)).status, 400);
  assert.ok(tuples.some((tp) => tp.object === "admin"));
  assert.equal((await post("/admin/roles/admin/members/delete", `_csrf=${token}&member=user:admin1`)).status, 400);
  assert.ok(tuples.some((tp) => tp.object === "admin" && tp.subject_id === "user:admin1"));

  // An invalid role name in the path → 404; malformed %-encoding doesn't 500.
  assert.equal((await get("/admin/roles/Bad%20Name")).status, 404);
  assert.equal((await get("/admin/roles/%ZZ")).status, 404);
});

// Built-in OAuth2 clients admin screen (§6): gate + list/register/detail/delete over HTTP against an
// in-memory Hydra. Registration shows the one-time client_secret on the post-create page (no PRG).
test("admin OAuth2 clients screen: gate, list, register (one-time secret), detail, delete (CSRF-guarded)", async (t) => {
  const store: OAuth2Client[] = [
    { client_id: "existing", client_name: "Reporting", redirect_uris: ["https://reporting.example/cb"], scope: "openid", token_endpoint_auth_method: "client_secret_basic" },
  ];
  let seq = 0;
  const hydra = stubHydra({
    createClient: async (c) => { const created = { ...c, client_id: `gen-${++seq}`, client_secret: `secret-${seq}` }; store.push(created); return created; },
    deleteClient: async (id) => { const i = store.findIndex((c) => c.client_id === id); if (i >= 0) store.splice(i, 1); },
    getClient: async (id) => store.find((c) => c.client_id === id) ?? null,
    listClients: async () => ({ clients: store, nextPageToken: null }),
  });
  const { get, post, token, url } = await adminHarness(t, { hydra });

  await assertAdminGate(url, get, "/admin/clients");

  // List: the existing client shows + the "register" link.
  const listHtml = await (await get("/admin/clients")).text();
  assert.match(listHtml, /href="\/admin\/clients\/existing"/);
  assert.match(listHtml, /href="\/admin\/clients\/new"/);
  assert.match(listHtml, /Reporting/);

  // Register: the form renders (with confidential-vs-public guidance); a valid post creates the
  // client and shows the one-time secret + id.
  const formHtml = await (await get("/admin/clients/new")).text();
  assert.match(formHtml, /Register client/);
  assert.match(formHtml, /can't keep a secret/i); // guidance on the public-vs-confidential choice
  const created = await post("/admin/clients", `_csrf=${token}&name=Grafana&redirectUris=${encodeURIComponent("https://graf/cb")}&scope=openid+offline_access`);
  assert.equal(created.status, 200); // not a redirect — the secret is shown once
  const createdHtml = await created.text();
  assert.match(createdHtml, /Client registered/);
  assert.match(createdHtml, /secret-1/); // the one-time client_secret
  assert.match(createdHtml, /gen-1/);    // the generated client_id
  assert.ok(store.some((c) => c.client_name === "Grafana" && c.token_endpoint_auth_method === "client_secret_basic"));

  // Invalid input (missing redirect URI) and a missing CSRF token are both refused, nothing created.
  const before = store.length;
  assert.equal((await post("/admin/clients", `_csrf=${token}&name=NoRedirect&redirectUris=`)).status, 400);
  assert.equal((await post("/admin/clients", `name=x&redirectUris=${encodeURIComponent("https://x/cb")}`)).status, 403);
  assert.equal(store.length, before);

  // Detail: read-only info, never the secret again, a delete control.
  const detail = await (await get("/admin/clients/existing")).text();
  assert.match(detail, /reporting\.example\/cb/);
  assert.doesNotMatch(detail, /Client secret/i); // the secret is shown only once, at creation
  assert.match(detail, /delete and re-register/i); // no edit: the lifecycle guidance is surfaced
  assert.match(detail, /href="\/admin\/clients\/existing\/delete"/);

  // Delete: a confirm step (GET) then the POST removes the client, back to the list.
  assert.match(await (await get("/admin/clients/existing/delete")).text(), /Cancel/);
  const del = await post("/admin/clients/existing/delete", `_csrf=${token}`);
  assert.equal(del.status, 303);
  assert.equal(del.headers.get("location"), "/admin/clients");
  assert.ok(!store.some((c) => c.client_id === "existing"));

  // Unknown id → 404; malformed %-encoding doesn't 500.
  assert.equal((await get("/admin/clients/does-not-exist")).status, 404);
  assert.equal((await get("/admin/clients/%ZZ")).status, 404);
});

test("resolveStaticPath blocks traversal and control chars, allows nested files", () => {
  assert.equal(resolveStaticPath("/srv/public", "../app.ts"), null);
  assert.equal(resolveStaticPath("/srv/public", "a\x00b"), null);
  assert.equal(resolveStaticPath("/srv/public", "css/styles.css"), "/srv/public/css/styles.css");
});

test("contentTypeFor maps known and unknown extensions", () => {
  assert.match(contentTypeFor("a.css"), /text\/css/);
  assert.equal(contentTypeFor("a.bin"), "application/octet-stream");
});

test("routePublic sends a plugin-id segment to its public/ dir, everything else to core", () => {
  const ids = new Set(["scheduling"]);
  assert.deepEqual(routePublic("scheduling/app.css", "/core", "/plugins", ids), { dir: "/plugins/scheduling/public", subPath: "app.css" });
  assert.deepEqual(routePublic("scheduling/img/logo.svg", "/core", "/plugins", ids), { dir: "/plugins/scheduling/public", subPath: "img/logo.svg" });
  assert.deepEqual(routePublic("scheduling", "/core", "/plugins", ids), { dir: "/plugins/scheduling/public", subPath: "" }); // bare /public/<id>, no file
  assert.deepEqual(routePublic("css/styles.css", "/core", "/plugins", ids), { dir: "/core", subPath: "css/styles.css" }); // not a plugin → core
});
