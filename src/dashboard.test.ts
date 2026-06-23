import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardModel } from "./dashboard.ts";
import type { NavNode } from "./nav.ts";

// The default /dashboard is an instructional starter (todo §10): no mock data, just the unified
// menu + shell. The host passes the one global menu (ctx.chrome.nav); the model passes it through.
const NAV: NavNode[] = [{ href: "/dashboard", label: "Dashboard" }, { children: [{ href: "/admin/users", label: "Users" }], label: "Admin" }];

test("dashboard model: titled shell, passes the unified nav + csrf + user through", () => {
  const m = buildDashboardModel({ csrfToken: "tok.sig", nav: NAV, user: { email: "ada@x.io", id: "u1", roles: ["admin"] } });
  assert.equal(m.shell.title, "Dashboard");
  assert.equal(m.shell.csrfToken, "tok.sig");
  assert.equal(m.shell.user.name, "ada"); // real signed-in identity, not a demo profile
  assert.deepEqual(m.nav, NAV); // the host's menu is used verbatim — the dashboard builds no nav of its own
});

test("dashboard model: sensible defaults (empty nav, no token, Guest) and branding from menu", () => {
  const m = buildDashboardModel();
  assert.deepEqual(m.nav, []);
  assert.equal(m.shell.csrfToken, "");
  assert.equal(m.shell.user.name, "Guest");
  assert.equal(m.shell.brand.name, "Plainpages");

  const branded = buildDashboardModel({ menu: { branding: { name: "Acme Ops", sub: "Admin", theme: "dark" }, override: {} } });
  assert.equal(branded.shell.brand.name, "Acme Ops");
  assert.equal(branded.shell.theme, "dark");
});
