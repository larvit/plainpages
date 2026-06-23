// Page chrome for plugin pages: the brand / global-nav / user / theme / csrf block a
// plugin view hands to partials/shell so its page looks native — the same shell the dashboard and
// admin screens render. Pure; the host builds it per plugin request and exposes it on ctx.chrome.
// nav is the global menu — Dashboard + every plugin's fragment + the gated admin section — run
// through composeNav (override + per-user filter) and current-marked for the request path.

import { adminSection, DASHBOARD_NAV } from "./admin-nav.ts";
import type { User } from "./context.ts";
import { type MenuConfig } from "./menu-config.ts";
import { composeNav, type NavNode } from "./nav.ts";
import type { Plugin } from "./plugin.ts";
import { shellUser, type ShellUser } from "./shell-context.ts";

export interface PageChrome {
  brand: { logo?: string; name: string; sub?: string };
  csrfToken: string; // double-submit token for the shell's Sign-out form + a plugin's own forms
  nav: NavNode[]; // global menu, composed + role-filtered + current-marked, ready for nav-tree.ejs
  signInHref: string; // where the shell's anonymous "Sign in" link points — carries this page as return_to
  theme?: string;
  user: ShellUser;
}

export interface ChromeOptions {
  csrfToken?: string;
  currentPath?: string; // request pathname; the matching nav leaf is marked current
  menu: MenuConfig;
  plugins?: Plugin[];
  user?: User | null;
}

export function buildPluginChrome(opts: ChromeOptions): PageChrome {
  // The Dashboard link targets the gated /dashboard, so show it only to a signed-in user — to an
  // anonymous visitor (a public page in the shell) it would only dead-end at /login.
  const fragments: NavNode[][] = opts.user ? [[DASHBOARD_NAV]] : [];
  for (const p of opts.plugins ?? []) if (p.nav?.length) fragments.push(p.nav);
  fragments.push([adminSection()]);

  const roles = opts.user?.roles ?? [];
  const nav = composeNav(fragments, opts.menu.override, roles);
  if (opts.currentPath) {
    // Mark by the *best* (longest) href that is the path or a parent of it, so a sub-path like
    // /admin/users/new marks the Users base leaf (/admin/users) and the dashboard marks Dashboard.
    const target = bestHref(nav, opts.currentPath);
    if (target) markCurrent(nav, target);
  }

  const b = opts.menu.branding;
  return {
    brand: { ...(b.logo != null ? { logo: b.logo } : {}), name: b.name, ...(b.sub != null ? { sub: b.sub } : {}) },
    csrfToken: opts.csrfToken ?? "",
    nav,
    // Anonymous "Sign in" returns to the current page (it's host-relative, our own pathname).
    signInHref: opts.currentPath ? `/login?return_to=${encodeURIComponent(opts.currentPath)}` : "/login",
    ...(b.theme != null ? { theme: b.theme } : {}),
    user: shellUser(opts.user),
  };
}

// The href of the leaf that owns `path`: an exact match, else the longest href that is a parent of
// it (href + "/" prefixes path), so /admin/users/123 resolves to the /admin/users leaf. "/" never
// counts as a parent (it would own everything). Returns undefined when nothing matches.
function bestHref(nodes: NavNode[], path: string): string | undefined {
  let best: string | undefined;
  const visit = (ns: NavNode[]): void => {
    for (const n of ns) {
      if (n.href != null && (n.href === path || (n.href !== "/" && path.startsWith(`${n.href}/`)))) {
        if (best === undefined || n.href.length > best.length) best = n.href;
      }
      if (n.children) visit(n.children);
    }
  };
  visit(nodes);
  return best;
}

// Mark the leaf whose href equals `target` as current and open every ancestor header so the active
// page is revealed. Mutates the freshly-composed nodes (composeNav returns new objects each call).
// Returns whether this subtree contains the current node.
function markCurrent(nodes: NavNode[], target: string): boolean {
  let hit = false;
  for (const node of nodes) {
    const here = node.href === target;
    const inChild = node.children ? markCurrent(node.children, target) : false;
    if (here) node.current = true;
    if (here || inChild) {
      if (node.children) node.open = true;
      hit = true;
    }
  }
  return hit;
}
