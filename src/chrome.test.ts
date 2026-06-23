import assert from "node:assert/strict";
import test from "node:test";
import { buildPluginChrome } from "./chrome.ts";
import { DEFAULT_MENU, type MenuConfig } from "./menu-config.ts";
import type { NavNode } from "./nav.ts";
import type { Plugin } from "./plugin.ts";

const scheduling: Plugin = {
  apiVersion: "1.0.0",
  id: "scheduling",
  nav: [{
    children: [{ href: "/scheduling/shifts", id: "scheduling:shifts", label: "Shifts", permission: "scheduling:read" }],
    icon: "i-cal", id: "scheduling", label: "Scheduling",
  }],
};
// A plugin with a public nav node (reachable by anyone, signed in or not).
const portal: Plugin = { apiVersion: "1.0.0", id: "portal", nav: [{ href: "/portal", id: "portal", label: "Portal", public: true }] };

const labels = (nodes: NavNode[]): string[] => nodes.map((n) => n.label);

test("anonymous: brand from menu, Guest user; the gated Dashboard link is hidden, a public node still shows", () => {
  const chrome = buildPluginChrome({ menu: DEFAULT_MENU, plugins: [scheduling, portal] });
  assert.equal(chrome.brand.name, DEFAULT_MENU.branding.name);
  assert.equal(chrome.user.name, "Guest");
  // Dashboard points at the gated /dashboard — showing it to an anonymous visitor only dead-ends them
  // at /login, so it's dropped. Scheduling's only child is gated (dropped), admin gated (dropped);
  // the explicitly public Portal node remains.
  assert.deepEqual(labels(chrome.nav), ["Portal"]);
});

test("anonymous shell Sign-in link carries the current page as return_to", () => {
  assert.equal(buildPluginChrome({ menu: DEFAULT_MENU }).signInHref, "/login"); // no path known
  assert.equal(buildPluginChrome({ currentPath: "/portal", menu: DEFAULT_MENU }).signInHref, "/login?return_to=%2Fportal");
});

test("a permission holder sees the Dashboard link + plugin nav; current path opens the active leaf", () => {
  const chrome = buildPluginChrome({
    currentPath: "/scheduling/shifts", menu: DEFAULT_MENU, plugins: [scheduling],
    user: { email: "ada@x.io", id: "u1", roles: ["scheduling:read"] },
  });
  assert.deepEqual(labels(chrome.nav), ["Dashboard", "Scheduling"]); // Dashboard shown to a signed-in user
  const section = chrome.nav.find((n) => n.label === "Scheduling")!;
  assert.equal(section.open, true); // ancestor of the current leaf opened
  assert.equal(section.children!.find((c) => c.label === "Shifts")!.current, true);
  assert.equal(chrome.user.name, "ada"); // email local part
});

test("an admin sees the gated admin section; a sub-path marks its base leaf current", () => {
  const chrome = buildPluginChrome({ currentPath: "/admin/users/new", menu: DEFAULT_MENU, user: { email: "a@b.c", id: "u1", roles: ["admin"] } });
  const admin = chrome.nav.find((n) => n.label === "Admin")!;
  assert.ok(admin); // gated section visible to an admin
  assert.equal(admin.open, true); // ancestor of the current leaf opened
  // /admin/users/new is under the Users base (/admin/users) → that leaf is current, not Groups/Roles.
  assert.equal(admin.children!.find((c) => c.label === "Users")!.current, true);
  assert.equal(admin.children!.find((c) => c.label === "Groups")!.current, undefined);
});

test("branding logo + default theme flow through when set", () => {
  const menu: MenuConfig = { branding: { logo: "/logo.svg", name: "Acme", theme: "dark" }, override: {} };
  const chrome = buildPluginChrome({ menu });
  assert.equal(chrome.brand.logo, "/logo.svg");
  assert.equal(chrome.brand.name, "Acme");
  assert.equal(chrome.theme, "dark");
});
