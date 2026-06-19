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

const labels = (nodes: NavNode[]): string[] => nodes.map((n) => n.label);

test("anonymous: brand from menu, Guest user, gated plugin + admin nav filtered out", () => {
  const chrome = buildPluginChrome({ menu: DEFAULT_MENU, plugins: [scheduling] });
  assert.equal(chrome.brand.name, DEFAULT_MENU.branding.name);
  assert.equal(chrome.user.name, "Guest");
  assert.deepEqual(labels(chrome.nav), ["Dashboard"]); // Scheduling (gated child) + Admin dropped
});

test("a permission holder sees the plugin nav; current path opens the active leaf", () => {
  const chrome = buildPluginChrome({
    currentPath: "/scheduling/shifts", menu: DEFAULT_MENU, plugins: [scheduling],
    user: { email: "ada@x.io", id: "u1", roles: ["scheduling:read"] },
  });
  assert.deepEqual(labels(chrome.nav), ["Dashboard", "Scheduling"]);
  const section = chrome.nav.find((n) => n.label === "Scheduling")!;
  assert.equal(section.open, true); // ancestor of the current leaf opened
  assert.equal(section.children!.find((c) => c.label === "Shifts")!.current, true);
  assert.equal(chrome.user.name, "ada"); // email local part
});

test("an admin sees the gated admin section", () => {
  const chrome = buildPluginChrome({ menu: DEFAULT_MENU, user: { email: "a@b.c", id: "u1", roles: ["admin"] } });
  assert.ok(labels(chrome.nav).includes("Admin"));
});

test("branding logo + default theme flow through when set", () => {
  const menu: MenuConfig = { branding: { logo: "/logo.svg", name: "Acme", theme: "dark" }, override: {} };
  const chrome = buildPluginChrome({ menu });
  assert.equal(chrome.brand.logo, "/logo.svg");
  assert.equal(chrome.brand.name, "Acme");
  assert.equal(chrome.theme, "dark");
});
