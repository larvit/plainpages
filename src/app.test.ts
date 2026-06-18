import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type JsonWebKey } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { can, check, GuardError, requireSession } from "./guards.ts";
import { staticJwks } from "./jwks.ts";
import type { KetoClient } from "./keto-client.ts";
import type { Identity, KratosAdmin } from "./kratos-admin.ts";
import { KratosError, type Flow, type FlowType, type KratosPublic, type Session, type UiNode } from "./kratos-public.ts";
import { SESSION_COOKIE } from "./login.ts";
import type { Plugin } from "./plugin.ts";
import { contentTypeFor, resolveStaticPath, routePublic } from "./static.ts";

const viewsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "views");

const server = createApp();
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

test("serves the home page: the app-shell People dashboard, filterable via the URL", async () => {
  const res = await fetch(base + "/");
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

  // A search query filters server-side: a no-match query drops every row.
  const empty = await fetch(base + "/?q=zzz-no-such-person");
  assert.doesNotMatch(await empty.text(), /Avery Kline/);
});

test("renders branding from the menu config into the shell: logo + default theme", async (t) => {
  const app = createApp({ menu: { branding: { logo: "/public/brand/logo.svg", name: "Acme Ops", theme: "dark" }, override: {} } });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const html = await (await fetch(`http://localhost:${(app.address() as AddressInfo).port}/`)).text();

  assert.match(html, /<img class="brand-logo" src="\/public\/brand\/logo\.svg"/);
  assert.match(html, /Acme Ops/);
  assert.match(html, /id="theme-dark"\s+checked/); // config default theme reaches the switch
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

// Production caches compiled templates; rendering must stay correct across repeated requests.
test("renders correctly with template caching enabled", async () => {
  const app = createApp({ cache: true });
  try {
    await new Promise<void>((resolve) => app.listen(0, resolve));
    const url = `http://localhost:${(app.address() as AddressInfo).port}/`;
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
  writeFileSync(join(dir, "index.ejs"), "<% throw new Error('boom'); %>");
  cpSync(join(viewsDir, "500.ejs"), join(dir, "500.ejs"));
  const app = createApp({ viewsDir: dir });
  try {
    await new Promise<void>((resolve) => app.listen(0, resolve));
    const res = await fetch(`http://localhost:${(app.address() as AddressInfo).port}/`);
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

  // gated route with no session → the rendered 403 page (covers the gate + 403.ejs over HTTP)
  const denied = await fetch(url + "/demo/secret");
  assert.equal(denied.status, 403);
  const deniedBody = await denied.text();
  assert.match(deniedBody, /403/);
  assert.match(deniedBody, /styles\.css/);

  // known path + wrong method → 405 with Allow; unknown path → 404
  const wrong = await fetch(url + "/demo/data", { method: "DELETE" });
  assert.equal(wrong.status, 405);
  assert.match(wrong.headers.get("allow") ?? "", /GET/);
  assert.equal((await fetch(url + "/demo/nope")).status, 404);
});

// JWT middleware (§4): a verified session cookie populates ctx.user/roles, which the gate reads.
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ecJwk: JsonWebKey = { ...(ec.publicKey.export({ format: "jwk" }) as JsonWebKey), alg: "ES256", kid: "test-kid" };
const b64url = (i: Buffer | string): string => Buffer.from(i).toString("base64url");
function mintJwt(payload: Record<string, unknown>): string {
  const input = `${b64url(JSON.stringify({ alg: "ES256", kid: "test-kid", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
  return `${input}.${b64url(sign("SHA256", Buffer.from(input), { dsaEncoding: "ieee-p1363", key: ec.privateKey }))}`;
}

test("a verified session JWT authorizes a role-gated route; no cookie / expired token → 403", async (t) => {
  const app = createApp({ jwks: staticJwks([ecJwk]), plugins: [demoPlugin] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const secret = (cookie?: string) => fetch(url + "/demo/secret", cookie ? { headers: { cookie } } : {});

  // Token carrying the gating role → the handler runs (200).
  const ok = await secret(`${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec + 600, roles: ["demo:read"], sub: "u1" })}`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "secret");

  // No cookie and an expired token both render anonymous → the gate denies (403).
  assert.equal((await secret()).status, 403);
  assert.equal((await secret(`${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec - 600, roles: ["demo:read"], sub: "u1" })}`)).status, 403);
});

test("session re-mint: an expired JWT backed by a live Kratos session is silently re-minted; a dead session clears it", async (t) => {
  const identity: Identity = { id: "u1", traits: { email: "a@b.c" } };
  const nowSec = Math.floor(Date.now() / 1000);
  const freshJwt = mintJwt({ email: "a@b.c", exp: nowSec + 600, roles: ["demo:read"], sub: "u1" });
  const live = withWhoami(async (o) => (o?.tokenizeAs ? { active: true, identity, tokenized: freshJwt } : { active: true, identity }) as Session);
  const keto = stubKeto({ listRelations: async () => ({ nextPageToken: null, tuples: [{ namespace: "Role", object: "demo:read", relation: "members", subject_id: "user:u1" }] }) });
  const expired = `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec - 600, roles: ["demo:read"], sub: "u1" })}; plainpages_session=s`;

  // Live Kratos session: the lapsed token is re-minted — the gated route runs AND a fresh cookie rides the response.
  const app = createApp({ jwks: staticJwks([ecJwk]), keto, kratos: live, kratosAdmin: stubAdmin({}), plugins: [demoPlugin] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const ok = await fetch(`http://localhost:${(app.address() as AddressInfo).port}/demo/secret`, { headers: { cookie: expired } });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "secret");
  assert.match(ok.headers.get("set-cookie") ?? "", /^plainpages_jwt=/);

  // Kratos session gone: no re-mint, the stale cookie is cleared, the gate denies.
  const dead = createApp({ jwks: staticJwks([ecJwk]), keto, kratos: withWhoami(async () => null), kratosAdmin: stubAdmin({}), plugins: [demoPlugin] });
  await new Promise<void>((r) => dead.listen(0, r));
  t.after(() => dead.close());
  const denied = await fetch(`http://localhost:${(dead.address() as AddressInfo).port}/demo/secret`, { headers: { cookie: expired } });
  assert.equal(denied.status, 403);
  assert.match(denied.headers.get("set-cookie") ?? "", /^plainpages_jwt=;.*Max-Age=0/);
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
    ],
  };
  const app = createApp({ jwks: staticJwks([ecJwk]), plugins: [guarded] });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const auth = (roles: string[]) => ({ headers: { cookie: `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: nowSec + 600, roles, sub: "u1" })}` } });

  // requireSession: anonymous bounces to /login; a signed-in user reaches the handler.
  const anon = await fetch(url + "/guarded/me", { redirect: "manual" });
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.get("location"), "/login");
  const me = await fetch(url + "/guarded/me", auth([]));
  assert.equal(me.status, 200);
  assert.match(await me.text(), /hi a@b\.c/);

  // can: signed-in but lacking the role → 403 page; carrying it → 200.
  assert.equal((await fetch(url + "/guarded/admin-only", auth([]))).status, 403);
  assert.equal((await fetch(url + "/guarded/admin-only", auth(["admin"]))).status, 200);

  // check (live Keto): the keto verdict gates the handler.
  assert.equal((await fetch(url + "/guarded/doc/open", auth([]))).status, 200);
  assert.equal((await fetch(url + "/guarded/doc/shut", auth([]))).status, 403);
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

  // onRequest short-circuits before routing — handler never runs.
  const blocked = await fetch(url + "/hooked/blocked");
  assert.equal(blocked.status, 403);
  assert.match(await blocked.text(), /blocked by hook/);

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
    getFlow,
    initBrowserFlow: async (_t: FlowType) => ({ flow: { id: "new1", ui: { action: "", method: "post", nodes: [] } }, setCookie: ["csrf_token=abc; Path=/; HttpOnly"] }),
    submitFlow: async () => { throw new Error("unused"); },
    whoami: async () => null,
  };
}

test("themed flow init: no ?flow= initialises one, relays Kratos' CSRF cookie, and an expired flow restarts", async (t) => {
  const app = createApp({ kratos: mockKratos(async (_t, id) => { if (id === "stale") throw new KratosError("gone", 410, ""); return loginFlow(id); }) });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;

  const init = await fetch(url + "/login", { redirect: "manual" });
  assert.equal(init.status, 303);
  assert.equal(init.headers.get("location"), "/login?flow=new1");
  assert.match(init.headers.get("set-cookie") ?? "", /csrf_token=abc/);

  // A stale flow id (Kratos 410) bounces back to a fresh init.
  const stale = await fetch(url + "/login?flow=stale", { redirect: "manual" });
  assert.equal(stale.status, 303);
  assert.equal(stale.headers.get("location"), "/login");
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
  // Configured OIDC provider → an SSO submit button in the same form (posts provider=google).
  assert.match(html, /<div class="sso"/);
  assert.match(html, /<button type="submit" class="sso-btn" name="provider" value="google">.*Sign in with Google<\/span><\/button>/s);
  // The flow-level error renders as an alert.
  assert.match(html, /class="alert alert-neg"/);
  assert.match(html, /The provided credentials are invalid\./);
});

// Login completion (§4): /auth/complete is where Kratos lands the browser after login.
const stubAdmin = (over: Partial<KratosAdmin>): KratosAdmin => ({
  createIdentity: async () => { throw new Error("unused"); },
  deleteIdentity: async () => {},
  getIdentity: async () => null,
  listIdentities: async () => ({ identities: [], nextPageToken: null }),
  updateIdentity: async () => { throw new Error("unused"); },
  updateMetadataPublic: async () => ({ id: "x" }),
  ...over,
});
const stubKeto = (over: Partial<KetoClient>): KetoClient => ({
  check: async () => false,
  deleteTuple: async () => {},
  expand: async () => ({ type: "leaf" }),
  listRelations: async () => ({ nextPageToken: null, tuples: [] }),
  writeTuple: async () => {},
  ...over,
});
const withWhoami = (whoami: KratosPublic["whoami"]): KratosPublic => ({ ...mockKratos(async () => { throw new Error("unused"); }), whoami });

test("login completion: mints the session JWT (roles from Keto → projection → tokenize) and sets the cookie", async (t) => {
  const identity: Identity = { id: "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55", traits: { email: "admin@plainpages.local" } };
  let projected: unknown;
  const kratos = withWhoami(async (o) => (o?.tokenizeAs ? { active: true, identity, tokenized: "h.p.s" } : { active: true, identity }) as Session);
  const kratosAdmin = stubAdmin({ updateMetadataPublic: async (_id, meta) => { projected = meta; return identity; } });
  const keto = stubKeto({ listRelations: async () => ({ nextPageToken: null, tuples: [{ namespace: "Role", object: "admin", relation: "members", subject_id: `user:${identity.id}` }] }) });

  const app = createApp({ keto, kratos, kratosAdmin });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const res = await fetch(`http://localhost:${(app.address() as AddressInfo).port}/auth/complete`, { headers: { cookie: "plainpages_session=s" }, redirect: "manual" });

  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/");
  assert.match(res.headers.get("set-cookie") ?? "", /^plainpages_jwt=h\.p\.s;.*HttpOnly/);
  assert.deepEqual(projected, { roles: ["admin"] }); // Keto roles projected onto the identity for the tokenizer
});

test("login completion with no Kratos session redirects to /login and sets no cookie", async (t) => {
  const app = createApp({ keto: stubKeto({}), kratos: withWhoami(async () => null), kratosAdmin: stubAdmin({}) });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const res = await fetch(`http://localhost:${(app.address() as AddressInfo).port}/auth/complete`, { redirect: "manual" });

  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login");
  assert.equal(res.headers.get("set-cookie"), null);
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
