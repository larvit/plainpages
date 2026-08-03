// Page chrome for plugin pages: the brand / global-nav / user / theme / csrf block a
// plugin view hands to partials/shell so its page looks native — the same shell the dashboard and
// every plugin renders. Pure; the host builds it per plugin request and exposes it on ctx.chrome.
// nav is the global menu — Dashboard + every plugin's fragment (admin screens included, when the
// admin plugin is installed) — run through composeNav (override + per-user filter) and
// current-marked for the request path.

import type { User } from "../http/context.ts";
import { ENGLISH } from "../i18n/english.ts";
import type { Translate } from "../i18n/translate.ts";
import { type MenuConfig } from "./menu-config.ts";
import { composeNav, type NavNode } from "./nav.ts";
import type { Plugin } from "../plugin-host/plugin.ts";
import { shellUser, type ShellUser } from "./shell-context.ts";

// The "Dashboard" link to the gated app home (/dashboard). It targets a gated route, so it's shown
// only to a signed-in user (an anonymous click would only dead-end at /login). Its label is a
// catalog key — composeNav translates every label, and an unknown one renders as written.
const DASHBOARD_NAV: NavNode = { href: "/dashboard", icon: "i-grid", id: "dashboard", label: "nav.dashboard" };

export interface PageChrome {
  brand: { logo?: string; name: string; sub?: string };
  csrfToken: string; // double-submit token for the shell's Sign-out form + a plugin's own forms
  nav: NavNode[]; // global menu, composed + permission-filtered + current-marked, ready for nav-tree.ejs
  signInHref: string; // where the shell's anonymous "Sign in" link points — carries this page as return_to
  theme?: string;
  user: ShellUser;
}

export interface ChromeOptions {
  csrfToken?: string;
  currentPath?: string; // request pathname; the matching nav leaf is marked current
  localeHref?: (href: string) => string; // carries an explicitly chosen locale onto every chrome link
  menu: MenuConfig;
  plugins?: Plugin[];
  t?: Translate; // the core translator: the built-in nodes, the central override's labels, branding
  translatorFor?: (pluginId: string) => Translate; // a plugin's own translator, for its nav fragment
  user?: User | null;
}

export function buildPluginChrome(opts: ChromeOptions): PageChrome {
  const t = opts.t ?? ENGLISH;
  const carryLocale = opts.localeHref ?? ((href: string) => href);
  // The Dashboard link targets the gated /dashboard, so show it only to a signed-in user — to an
  // anonymous visitor (a public page in the shell) it would only dead-end at /login. The admin
  // section, when present, is just another plugin's nav fragment (examples/plugins/admin).
  const fragments: NavNode[][] = opts.user ? [[DASHBOARD_NAV]] : [];
  // A plugin's nav labels are keys in *its* catalog, so translate each fragment with that plugin's
  // translator before they are merged. composeNav then runs the core one over the result for the
  // built-in nodes and the central override's labels; already-translated text passes through it.
  for (const p of opts.plugins ?? []) {
    if (p.nav?.length) fragments.push(translateNav(p.nav, opts.translatorFor?.(p.id) ?? t));
  }

  const permissions = opts.user?.permissions ?? [];
  const nav = composeNav(fragments, opts.menu.override, permissions, t);
  if (opts.currentPath) {
    // Mark by the *best* (longest) href that is the path or a parent of it, so a sub-path like
    // /admin/users/new marks the Users base leaf (/admin/users) and the dashboard marks Dashboard.
    // Marked before the locale rides along, so an href still matches the plain request path.
    const target = bestHref(nav, opts.currentPath);
    if (target) markCurrent(nav, target);
  }

  const b = opts.menu.branding;
  // The sign-in link keeps the visitor's locale, and brings it back afterwards via return_to.
  const returnTo = opts.currentPath ? `/login?return_to=${encodeURIComponent(carryLocale(opts.currentPath))}` : "/login";
  return {
    brand: { ...(b.logo != null ? { logo: b.logo } : {}), name: t(b.name), ...(b.sub != null ? { sub: t(b.sub) } : {}) },
    csrfToken: opts.csrfToken ?? "",
    nav: carryLocaleInto(nav, carryLocale),
    signInHref: carryLocale(returnTo),
    ...(b.theme != null ? { theme: b.theme } : {}),
    user: shellUser(opts.user, t),
  };
}

function translateNav(nodes: NavNode[], t: Translate): NavNode[] {
  return nodes.map((node) => ({
    ...node,
    label: t(node.label),
    ...(node.children ? { children: translateNav(node.children, t) } : {}),
  }));
}

function carryLocaleInto(nodes: NavNode[], carryLocale: (href: string) => string): NavNode[] {
  return nodes.map((node) => ({
    ...node,
    ...(node.href != null ? { href: carryLocale(node.href) } : {}),
    ...(node.children ? { children: carryLocaleInto(node.children, carryLocale) } : {}),
  }));
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
