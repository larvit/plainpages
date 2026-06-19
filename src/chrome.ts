// Page chrome for plugin pages (todo §7): the brand / global-nav / user / theme / csrf block a
// plugin view hands to partials/shell so its page looks native — the same shell the dashboard and
// admin screens render. Pure; the host builds it per plugin request and exposes it on ctx.chrome.
// nav is the global menu — Dashboard + every plugin's fragment + the gated admin section — run
// through composeNav (override + per-user filter) and current-marked for the request path.

import { adminSection } from "./admin-nav.ts";
import type { User } from "./context.ts";
import { type MenuConfig } from "./menu-config.ts";
import { composeNav, type NavNode } from "./nav.ts";
import type { Plugin } from "./plugin.ts";
import { shellUser, type ShellUser } from "./shell-context.ts";

export interface PageChrome {
  brand: { logo?: string; name: string; sub?: string };
  csrfToken: string; // double-submit token for the shell's Sign-out form + a plugin's own forms
  nav: NavNode[]; // global menu, composed + role-filtered + current-marked, ready for nav-tree.ejs
  theme?: string;
  user: ShellUser;
}

const HOME: NavNode = { href: "/", icon: "i-grid", id: "dashboard", label: "Dashboard" };

export interface ChromeOptions {
  csrfToken?: string;
  currentPath?: string; // request pathname; the matching nav leaf is marked current
  menu: MenuConfig;
  plugins?: Plugin[];
  user?: User | null;
}

export function buildPluginChrome(opts: ChromeOptions): PageChrome {
  const fragments: NavNode[][] = [[HOME]];
  for (const p of opts.plugins ?? []) if (p.nav?.length) fragments.push(p.nav);
  fragments.push([adminSection()]);

  const roles = opts.user?.roles ?? [];
  const nav = composeNav(fragments, opts.menu.override, roles);
  if (opts.currentPath) markCurrent(nav, opts.currentPath);

  const b = opts.menu.branding;
  return {
    brand: { ...(b.logo != null ? { logo: b.logo } : {}), name: b.name, ...(b.sub != null ? { sub: b.sub } : {}) },
    csrfToken: opts.csrfToken ?? "",
    nav,
    ...(b.theme != null ? { theme: b.theme } : {}),
    user: shellUser(opts.user),
  };
}

// Mark the leaf whose href equals `path` as current and open every ancestor header so the active
// page is revealed. Mutates the freshly-composed nodes (composeNav returns new objects each call).
// Returns whether this subtree contains the current node.
function markCurrent(nodes: NavNode[], path: string): boolean {
  let hit = false;
  for (const node of nodes) {
    const here = node.href === path;
    const inChild = node.children ? markCurrent(node.children, path) : false;
    if (here) node.current = true;
    if (here || inChild) {
      if (node.children) node.open = true;
      hit = true;
    }
  }
  return hit;
}
