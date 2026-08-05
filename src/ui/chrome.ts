// The brand / global-nav / user / theme / csrf block a view hands to partials/shell, exposed on
// ctx.chrome. `nav` is the global menu — Dashboard plus every plugin's fragment — run through
// composeNav (override + per-user filter) and current-marked for the request path.

import type { User } from "../http/context.ts";
import { ENGLISH } from "../i18n/english.ts";
import type { Translate } from "../i18n/translate.ts";
import { type MenuConfig } from "./menu-config.ts";
import { composeNav, type NavNode } from "./nav.ts";
import type { Plugin } from "../plugin-host/plugin.ts";
import { branding, shellUser, type ShellUser } from "./shell-context.ts";

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
  // Dashboard is gated, so an anonymous click would only dead-end at /login.
  const fragments: NavNode[][] = opts.user ? [[DASHBOARD_NAV]] : [];
  // A plugin's nav labels are keys in *its* catalog, so translate each fragment with that plugin's
  // translator before merging. composeNav then runs the core one over the result; already-translated
  // text passes through it.
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

  // The sign-in link keeps the visitor's locale, and brings it back afterwards via return_to.
  const returnTo = opts.currentPath ? `/login?return_to=${encodeURIComponent(carryLocale(opts.currentPath))}` : "/login";
  const { theme, ...brand } = branding(opts.menu, t);
  return {
    brand,
    csrfToken: opts.csrfToken ?? "",
    nav: carryLocaleInto(nav, carryLocale),
    signInHref: carryLocale(returnTo),
    ...(theme != null ? { theme } : {}),
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
