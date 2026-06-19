import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";

const shell = join(dirname(fileURLToPath(import.meta.url)), "..", "views", "partials", "shell.ejs");
const render = (data: Record<string, unknown> = {}): Promise<string> => ejs.renderFile(shell, data);

test("app shell renders sidebar, topbar and the content slot", async () => {
  const html = await render({
    title: "People",
    brand: { name: "Acme Console", sub: "v2" },
    csrfToken: "tok.sig",
    nav: '<a id="nav-marker" href="/x">Overview</a>',
    body: '<section id="body-marker">page</section>',
    actions: '<button id="action-marker">Add</button>',
  });

  // Skip link is the first focusable element, targeting the main landmark.
  assert.match(html, /<a class="skip-link" href="#main-content">Skip to content<\/a>/);

  // Three structural landmarks of the shell; the page title is the page's <h1>.
  assert.match(html, /<aside class="sidebar"/);
  assert.match(html, /<header class="topbar"/);
  assert.match(html, /<main class="content" id="main-content"/);
  assert.match(html, /<h1 class="page-title">People<\/h1>/);

  // Slots render their raw HTML where the page injects it.
  assert.match(html, /<a id="nav-marker"/); // sidebar nav slot
  assert.match(html, /<section id="body-marker">page<\/section>/); // content slot
  assert.match(html, /<button id="action-marker"/); // topbar actions slot

  // Sign out is a CSRF-guarded POST form (state change, not a GET link), carrying the token.
  assert.match(html, /<form class="menu-item-form" method="post" action="\/logout">/);
  assert.match(html, /<input type="hidden" name="_csrf" value="tok\.sig" \/>/);

  // Branding, document title, and the inlined icon sprite (so <use> resolves).
  assert.match(html, /Acme Console/);
  assert.match(html, /<title>People<\/title>/);
  assert.match(html, /<symbol id="i-menu"/);
  assert.match(html, /<use href="#i-menu"\s*\/?>/); // hamburger references the menu icon
});

test("app shell renders a configured logo + default theme, falls back to the brand mark", async () => {
  const branded = await render({ brand: { logo: "/public/brand/logo.svg", name: "Acme" }, theme: "dark" });
  assert.match(branded, /<img class="brand-logo" src="\/public\/brand\/logo\.svg"/);
  assert.doesNotMatch(branded, /brand-mark/); // a logo replaces the default mark
  assert.match(branded, /id="theme-dark"\s+checked/); // default theme applied to the switch

  const plain = await render({ brand: { name: "Acme" } }); // no logo, no theme
  assert.match(plain, /<span class="brand-mark">/); // default mark
  assert.match(plain, /id="theme-auto"\s+checked/); // theme-switch default
});

test("app shell links extra per-page stylesheets via the styles slot (e.g. a plugin's own CSS)", async () => {
  const withCss = await render({ styles: ["/public/scheduling/scheduling.css"] });
  assert.match(withCss, /<link rel="stylesheet" href="\/public\/css\/styles\.css" \/>/); // core stylesheet always present
  assert.match(withCss, /<link rel="stylesheet" href="\/public\/scheduling\/scheduling\.css" \/>/); // the extra one

  const none = await render(); // no styles → only the core stylesheet
  assert.equal((none.match(/rel="stylesheet"/g) ?? []).length, 1);
});

test("app shell escapes text but passes slot HTML through, and renders with defaults", async () => {
  const escaped = await render({ title: "<x>", body: "<p>raw</p>" });
  assert.match(escaped, /<title>&lt;x&gt;<\/title>/); // user text is escaped
  assert.match(escaped, /<p>raw<\/p>/); // slot HTML is not

  const bare = await render(); // no locals → defaults, must not throw
  assert.match(bare, /<aside class="sidebar"/);
  assert.match(bare, /<main class="content"/);
});
