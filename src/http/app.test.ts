import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { createApp } from "./app.ts";
import { createLogger } from "../logger.ts";
import { CSRF_COOKIE } from "../auth/csrf.ts";
import { staticJwks } from "../auth/jwks.ts";
import type { Plugin } from "../plugin-host/plugin.ts";
import { ENGLISH_LOCALS } from "../i18n/view-locals.ts";
import { ecJwk, session, startApp } from "./app-harness.ts";

const viewsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "views");

const server = createApp({ jwks: staticJwks([ecJwk]) });
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

test("the dashboard at /dashboard: the instructional starter in the unified shell, gated to a session", async () => {
  // The dashboard is gated to a signed-in user, so present a session.
  const res = await fetch(base + "/dashboard", { headers: { cookie: session() } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const html = await res.text();
  // The unified app shell: the same sidebar/menu every page renders.
  assert.match(html, /Plainpages/); // sidebar brand
  assert.match(html, /<aside class="sidebar"/);
  // The default is a short instructional starter, not a mock-data list.
  assert.match(html, /Starter dashboard/);
  assert.match(html, /<h1 class="page-title">Dashboard<\/h1>/); // the topbar heading …
  assert.match(html, /<nav class="crumbs"[^>]*>\s*<span>Dashboard<\/span>/); // … and its breadcrumb
  assert.match(html, /export default definePlugin/); // shows how to replace it from a plugin
  assert.doesNotMatch(html, /<form class="filters"/); // the old mock People list is gone
  assert.doesNotMatch(html, /Avery Kline/);

  // The Sign-out POST form carries a CSRF token matching the Set-Cookie issued for the page.
  const csrfCookie = (res.headers.get("set-cookie") ?? "").match(/plainpages_csrf=([^;]+)/)?.[1];
  assert.ok(csrfCookie, "GET /dashboard issues a CSRF cookie");
  assert.match(res.headers.get("set-cookie") ?? "", /plainpages_csrf=[^;]+;.*HttpOnly/);
  assert.match(html, /<form class="menu-item-form" method="post" action="\/logout">/);
  assert.match(html, new RegExp(`name="_csrf" value="${csrfCookie!.replace(/[.]/g, "\\.")}"`));
});

test("/ is the public landing: anonymous → 200 with intro + sign-in/register links, in the unified shell", async () => {
  const res = await fetch(base + "/", { redirect: "manual" });
  assert.equal(res.status, 200); // public — no redirect to sign in
  const html = await res.text();
  assert.match(html, /href="\/login"/); // a prominent path to sign in
  assert.match(html, /href="\/registration"/); // and to register
  // the same app shell every page renders — the menu shows even when signed out (permission-filtered).
  assert.match(html, /<aside class="sidebar"/);
  assert.match(html, /class="landing-title"/); // the landing hero owns the page's single <h1>
});

test("/dashboard is gated: an anonymous visitor is bounced to sign in (return_to kept)", async () => {
  const res = await fetch(base + "/dashboard", { redirect: "manual" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login?return_to=%2Fdashboard");
});

test("plugins replace either landing: `home` owns the public /, `dashboard` owns the gated /dashboard", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pp-home-"));
  mkdirSync(join(dir, "portal", "views"), { recursive: true });
  writeFileSync(join(dir, "portal", "views", "welcome.ejs"), `<h1>Welcome to <%= brand %></h1><a href="/login">Sign in</a>`);
  // The dashboard view renders the native app shell from ctx.chrome.
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

test("emits a structured access-log line per request (the injected logger)", async (t) => {
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

test("ctx.log: a handler logs in the request trace, and ctx.log.fetch continues the inbound trace", async (t) => {
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

test("ctx.log after a client abort doesn't throw: the request log is ended only once the handler unwinds", async (t) => {
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

test("every response carries the security headers; HSTS follows SECURE_COOKIES", async (t) => {
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

test("Cache-Control: pages and JSON are private, no-store unless the route sets its own", async (t) => {
  const NO_STORE = "private, no-store";
  const csrf = (await fetch(base + "/")).headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.match(csrf, new RegExp(`^${CSRF_COOKIE}=`));

  // The signed-out landing is no-store as well: it and the signed-in page share one URL.
  assert.equal((await fetch(base + "/")).headers.get("cache-control"), NO_STORE);
  assert.equal((await fetch(base + "/", { headers: { cookie: csrf } })).headers.get("cache-control"), NO_STORE);
  assert.equal((await fetch(base + "/", { headers: { cookie: csrf }, method: "HEAD" })).headers.get("cache-control"), NO_STORE);
  assert.equal((await fetch(base + "/", { headers: { cookie: `${csrf}; ${session()}` } })).headers.get("cache-control"), NO_STORE);

  assert.equal((await fetch(base + "/dashboard", { headers: { cookie: session() } })).headers.get("cache-control"), NO_STORE);
  assert.equal((await fetch(base + "/dashboard", { redirect: "manual" })).headers.get("cache-control"), NO_STORE); // sign-in bounce
  assert.equal((await fetch(base + "/nope", { headers: { cookie: csrf } })).headers.get("cache-control"), NO_STORE); // 404
  assert.equal((await fetch(base + "/public/css/styles.css")).headers.get("cache-control"), "public, max-age=300"); // static.test.ts covers asset caching

  const demo: Plugin = {
    apiVersion: "1.0.0",
    home: () => ({ html: "<p>plugin home</p>" }),
    id: "demo",
    routes: [
      { handler: () => ({ html: "open" }), method: "GET", path: "/open", public: true },
      { handler: () => ({ headers: { "Cache-Control": "public, max-age=600" }, html: "same" }), method: "GET", path: "/same", public: true },
      { handler: () => ({ json: { ok: true } }), method: "GET", path: "/data", public: true },
    ],
  };
  const url = await startApp(t, [demo]);
  for (const path of ["/demo/open", "/demo/data", "/"]) {
    assert.equal((await fetch(url + path)).headers.get("cache-control"), NO_STORE, path);
  }
  assert.equal((await fetch(url + "/demo/same")).headers.get("cache-control"), "public, max-age=600");
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

// Raw request so we can send an arbitrary Host (fetch derives Host from the URL); connect to the
// loopback server but present whatever host we want to exercise the canonical-host check.
function rawGet(port: number, path: string, host: string, method = "GET"): Promise<{ status: number; location: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("APP_URL canonical-host redirect: an off-host visitor is 308'd to the configured origin (path+query kept)", async (t) => {
  // Reach the app on any host and it sends you to APP_URL's, so the browser, the themed form and the
  // cross-origin Kratos POST share ONE cookie host. Same-host requests pass straight through.
  const app = createApp({ jwks: staticJwks([ecJwk]), appUrl: "http://canonical.example:3000" });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const port = (app.address() as AddressInfo).port;

  // Off-canonical host → 308 to the canonical origin, path + query preserved.
  const off = await rawGet(port, "/dashboard?q=x", `127.0.0.1:${port}`);
  assert.equal(off.status, 308);
  assert.equal(off.location, "http://canonical.example:3000/dashboard?q=x");

  // On the canonical host → no canonicalisation (the gated dashboard 303s to /login, never 308).
  const on = await rawGet(port, "/dashboard", "canonical.example:3000");
  assert.notEqual(on.status, 308);

  // Static assets are host-agnostic (served before the check) so health checks on any host still pass.
  const asset = await rawGet(port, "/public/css/styles.css", `127.0.0.1:${port}`);
  assert.equal(asset.status, 200);

  // A 308 must not replay a cross-host POST — non-GET/HEAD is left alone (not canonicalised).
  const post = await rawGet(port, "/dashboard", `127.0.0.1:${port}`, "POST");
  assert.notEqual(post.status, 308);
});

test("no APP_URL configured ⇒ no canonical redirect (unit-test apps and host-agnostic deploys unaffected)", async () => {
  // The shared `server` is built without appUrl, so any Host is served as-is (no 308).
  const r = await rawGet(Number(new URL(base).port), "/missing", "anything.example");
  assert.equal(r.status, 404); // reaches the normal handler, not a redirect
});

test("/error renders a themed sign-in error page (Kratos' flow error sink), not the 404", async () => {
  // Kratos' flows.error.ui_url points here; a flow error redirects to /error?id=<uuid>, which must
  // land on a real themed page rather than the catch-all 404.
  const res = await fetch(base + `/error?id=${randomUUID()}`, { redirect: "manual" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const html = await res.text();
  assert.doesNotMatch(html, /Page not found/); // not the 404 view
  assert.match(html, /sign in|sign-in|try again|something went wrong/i);
  assert.match(html, /href="\/login"/); // a path back into auth
});

test("renders the 500 HTML page when a handler throws", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pp-views-"));
  cpSync(viewsDir, dir, { recursive: true }); // the real views: 500.ejs includes the language picker
  writeFileSync(join(dir, "index.ejs"), "<% throw new Error('boom'); %>"); // …but the dashboard view throws
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

// Every /public/ reference in the page, as written in the HTML.
const publicRefs = (html: string): string[] => [...html.matchAll(/(?:href|src)="(\/public\/[^"]*)"/g)].map((m) => m[1] ?? "");

test("every /public/ href the host renders is versioned and answers a year-long immutable Cache-Control", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pp-plugins-"));
  mkdirSync(join(dir, "styled", "views"), { recursive: true });
  mkdirSync(join(dir, "styled", "public"), { recursive: true });
  writeFileSync(join(dir, "styled", "views", "page.ejs"), `<%- include("partials/shell", { body: "<p>styled</p>", styles: ["/public/styled/app.css"] }) %>`);
  writeFileSync(join(dir, "styled", "public", "app.css"), ".styled{}");
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const styled: Plugin = { apiVersion: "1.0.0", id: "styled", routes: [{ handler: () => ({ data: {}, view: "page" }), method: "GET", path: "/page", public: true }] };
  const url = await startApp(t, [styled], dir);

  const pages = { home: "/", notFound: "/no-such-page", plugin: "/styled/page" };
  const seen = new Set<string>();
  for (const [name, path] of Object.entries(pages)) {
    const refs = publicRefs(await (await fetch(url + path)).text());
    assert.ok(refs.length > 0, name);
    for (const ref of refs) {
      assert.match(ref, /\?v=[\w-]+$/, `${name}: ${ref}`);
      seen.add(ref);
    }
  }
  assert.ok([...seen].some((ref) => ref.startsWith("/public/styled/app.css?v=")), "the plugin's styles href");
  assert.ok([...seen].some((ref) => ref.startsWith("/public/favicon.svg?v=")), "the favicon");
  for (const ref of seen) {
    const res = await fetch(url + ref);
    assert.equal(res.status, 200, ref);
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable", ref);
  }
});

test("an error page rendered before the request has a context still versions its stylesheet", async () => {
  const port = Number(new URL(base).port);
  const res = await rawGet(port, "//", `localhost:${port}`); // `new URL("//", …)` throws before any context exists
  assert.equal(res.status, 500);
  const refs = publicRefs(res.body);
  assert.ok(refs.length > 0);
  for (const ref of refs) assert.match(ref, /\?v=[\w-]+$/, ref);
});

test("the standalone error and consent views version their stylesheets", async () => {
  for (const view of ["403", "404", "500", "503", "error", "oauth-consent"]) {
    const html = await ejs.renderFile(join(viewsDir, `${view}.ejs`), {
      ...ENGLISH_LOCALS,
      assetHref: (href: string) => `${href}?v=test`,
      consent: { account: "a@b.c", challenge: "c", client: "x", scopes: [] },
      csrfField: "csrf",
      csrfToken: "t",
      error: { message: "m" },
    });
    const refs = publicRefs(html);
    assert.ok(refs.length > 0, view);
    for (const ref of refs) assert.match(ref, /\?v=test$/, `${view}: ${ref}`);
  }
});

