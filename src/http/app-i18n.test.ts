import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createApp } from "./app.ts";
import { staticJwks } from "../auth/jwks.ts";
import { SESSION_COOKIE } from "../auth/login.ts";
import type { Plugin } from "../plugin-host/plugin.ts";
import { createI18n } from "../i18n/runtime.ts";
import type { MenuConfig } from "../ui/menu-config.ts";
import { loadI18n } from "../i18n/load.ts";
import { ecJwk, mintJwt } from "./app-harness.ts";

// ---- language (i18n) ----

// The installed catalogs, as server.ts wires them: the shipped core locales (en-US + sv-SE).
async function localeApp(t: TestContext): Promise<string> {
  const app = createApp({ i18n: createI18n(await loadI18n()), jwks: staticJwks([ecJwk]) });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  return `http://localhost:${(app.address() as AddressInfo).port}`;
}

test("?locale serves that language and carries the choice onto the links the page renders", async (t) => {
  const url = await localeApp(t);
  const html = await (await fetch(`${url}/?locale=sv-SE`)).text();

  assert.match(html, /<html lang="sv-SE" dir="ltr">/); // the document says what language it is in
  assert.match(html, /Logga in/); // the landing page's own words
  assert.doesNotMatch(html, /Operational web apps/);
  // The chosen locale rides along, so clicking through the app stays in Swedish without a cookie.
  assert.match(html, /href="\/login\?locale=sv-SE"/);
  // …and the picker offers the other installed locale, pointing at this same page.
  assert.match(html, /hreflang="en-US"/);
  assert.match(html, /href="\/\?locale=en-US"/);
});

test("Accept-Language decides when the URL doesn't, and a lone language matches its region", async (t) => {
  const url = await localeApp(t);
  const swedish = await (await fetch(`${url}/`, { headers: { "accept-language": "sv;q=0.9, en;q=0.4" } })).text();
  assert.match(swedish, /<html lang="sv-SE"/);
  // The visitor never asked for a locale in the URL, so the links stay clean.
  assert.match(swedish, /href="\/login"/);

  const english = await (await fetch(`${url}/`, { headers: { "accept-language": "de-DE" } })).text();
  assert.match(english, /<html lang="en-US"/); // nothing matches ⇒ the baseline
});

test("an uninstalled or malformed ?locale falls back instead of failing", async (t) => {
  const url = await localeApp(t);
  for (const bad of ["sv-FI", "klingon", "../../etc"]) {
    const res = await fetch(`${url}/?locale=${encodeURIComponent(bad)}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<html lang="en-US"/, `expected en-US for ${bad}`);
  }
});

test("a redirect the host emits keeps the visitor's language", async (t) => {
  const url = await localeApp(t);
  const res = await fetch(`${url}/dashboard?locale=sv-SE`, { redirect: "manual" }); // anonymous ⇒ sign in first
  assert.equal(res.status, 303);
  const location = res.headers.get("location") ?? "";
  assert.match(location, /^\/login\?/);
  assert.match(location, /locale=sv-SE/);
});

test("the error pages speak the visitor's language too", async (t) => {
  const url = await localeApp(t);
  const html = await (await fetch(`${url}/no-such-page?locale=sv-SE`)).text();
  assert.match(html, /<html lang="sv-SE"/);
  assert.match(html, /Sidan hittades inte/);
});

test("a plugin that owns a landing page, or short-circuits a hook, translates from its own catalog", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pp-i18n-plugin-"));
  mkdirSync(join(dir, "demo", "i18n"), { recursive: true });
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  writeFileSync(join(dir, "demo", "i18n", "en-US.ts"), 'const m = { "demo.hello": "Hello from the plugin" };\nexport default m;\n');

  // Every plugin-owned render path: the public landing, the gated dashboard, and a hook short-circuit.
  const demo: Plugin = {
    apiVersion: "1.0.0",
    dashboard: (ctx) => ({ html: ctx.t("demo.hello") }),
    home: (ctx) => ({ html: ctx.t("demo.hello") }),
    hooks: { onRequest: (ctx) => (ctx.url.pathname === "/hooked" ? { html: ctx.t("demo.hello") } : undefined) },
    id: "demo",
  };
  const i18n = createI18n(await loadI18n({ pluginIds: ["demo"], pluginsDir: dir }));
  const app = createApp({ i18n, jwks: staticJwks([ecJwk]), plugins: [demo], pluginsDir: dir });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const cookie = `${SESSION_COOKIE}=${mintJwt({ email: "a@b", exp: nowSec + 600, permissions: [], sub: "u1" })}`;

  assert.equal(await (await fetch(`${url}/`)).text(), "Hello from the plugin");
  assert.equal(await (await fetch(`${url}/hooked`)).text(), "Hello from the plugin");
  assert.equal(await (await fetch(`${url}/dashboard`, { headers: { cookie } })).text(), "Hello from the plugin");
});

test("an error page renders without composing the menu — it exists for when the shell's data is what failed", async (t) => {
  // The chrome getter is lazy on purpose; a render that reads no chrome must not trigger it, or a
  // broken menu takes the error pages down with it.
  let built = 0;
  const menu: MenuConfig = { branding: { get name() { built++; return "Plainpages"; } }, override: {} };
  const app = createApp({ jwks: staticJwks([ecJwk]), menu });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;

  const res = await fetch(`${url}/no-such-page`);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /Page not found/);
  assert.equal(built, 0);
});

test("a POST-rendered page still offers the language picker, pointed at a page that answers GET", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pp-post-lang-"));
  mkdirSync(join(dir, "demo", "views"), { recursive: true });
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  // The view renders the picker exactly as the shell does.
  writeFileSync(join(dir, "demo", "views", "page.ejs"), `<%- include("partials/locale-switch") %>`);
  const demo: Plugin = {
    apiVersion: "1.0.0",
    id: "demo",
    routes: [
      { handler: () => ({ view: "page" }), method: "GET", path: "/thing" },
      { handler: () => ({ view: "page" }), method: "POST", path: "/thing" },
      { handler: () => ({ view: "page" }), method: "POST", path: "/thing/act" }, // POST-only: no GET sibling
    ],
  };
  const app = createApp({ i18n: createI18n(await loadI18n()), plugins: [demo], pluginsDir: dir });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const post = (path: string, headers: Record<string, string> = {}) => fetch(url + path, { headers, method: "POST" });

  // A POST whose path also answers GET → the picker points at that page.
  assert.match(await (await post("/demo/thing?locale=sv-SE")).text(), /href="\/demo\/thing\?locale=en-US"/);
  // A POST-only path → the page the form was submitted from, so the link can't dead-end on a 405.
  const fromForm = await post("/demo/thing/act?locale=sv-SE", { referer: `${url}/demo/thing?locale=sv-SE` });
  assert.match(await fromForm.text(), /href="\/demo\/thing\?locale=en-US"/);
  // …and with no referer to fall back on, the front page.
  assert.match(await (await post("/demo/thing/act?locale=sv-SE")).text(), /href="\/\?locale=en-US"/);
});
