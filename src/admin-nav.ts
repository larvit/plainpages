// The built-in admin section of the menu (todo §5). One definition of the Users/Groups/Roles links
// + their gate, reused two ways so they can't drift: `adminSection()` is the permission-gated
// "Admin" header wired into the global dashboard menu (composeNav drops the whole header + subtree
// for a non-admin), and `adminNav()` is the in-screen sidebar each admin screen renders (a link home
// + the same section, with the active item marked `current`).

import { readFormBody } from "./body.ts";
import type { RequestContext, User } from "./context.ts";
import { CSRF_FIELD, verifyCsrfRequest } from "./csrf.ts";
import { GuardError, loginRedirect } from "./guards.ts";
import { type MenuConfig } from "./menu-config.ts";
import { composeNav, type NavNode } from "./nav.ts";
import { buildShellContext } from "./shell-context.ts";

export const ADMIN_PERMISSION = "admin"; // role token gating the admin section
export const ADMIN_USERS_BASE = "/admin/users";
export const ADMIN_GROUPS_BASE = "/admin/groups";
export const ADMIN_ROLES_BASE = "/admin/roles";
export const ADMIN_CLIENTS_BASE = "/admin/clients";

export type AdminScreen = "clients" | "groups" | "roles" | "users";

// The "Dashboard" link to the gated app home (/dashboard). One definition, reused by the in-screen
// admin sidebar and the plugin-page chrome (chrome.ts) so the two can't drift. It targets a gated
// route, so the chrome hides it from anonymous visitors (a non-signed-in click only dead-ends at /login).
export const DASHBOARD_NAV: NavNode = { href: "/dashboard", icon: "i-grid", id: "dashboard", label: "Dashboard" };

const ITEMS: { href: string; icon: string; id: AdminScreen; label: string }[] = [
  { href: ADMIN_USERS_BASE, icon: "i-users", id: "users", label: "Users" },
  { href: ADMIN_GROUPS_BASE, icon: "i-layers", id: "groups", label: "Groups" },
  { href: ADMIN_ROLES_BASE, icon: "i-shield", id: "roles", label: "Roles" },
  { href: ADMIN_CLIENTS_BASE, icon: "i-globe", id: "clients", label: "OAuth2 clients" },
];

// The gated "Admin" header + its three screens; `current` marks the active screen and opens the
// header. The permission lives on the header, so composeNav drops the whole section for a non-admin.
export function adminSection(current?: AdminScreen): NavNode {
  return {
    children: ITEMS.map((it) => ({ ...it, ...(it.id === current ? { current: true } : {}) })),
    icon: "i-shield",
    id: "admin",
    label: "Admin",
    permission: ADMIN_PERMISSION,
    ...(current ? { open: true } : {}),
  };
}

// In-screen sidebar for the admin screens: a link home + the admin section (active item marked).
export function adminNav(roles: string[], menu: MenuConfig, current: AdminScreen): NavNode[] {
  return composeNav([[DASHBOARD_NAV, adminSection(current)]], menu.override, roles);
}

// The shared gate for every admin screen: a signed-in admin only. Throws GuardError that app.ts maps
// (anonymous → /login, non-admin → 403). Returns the (non-null) user for the handler to thread on.
export function requireAdmin(ctx: RequestContext): User {
  if (!ctx.user) throw new GuardError(401, "authentication required", loginRedirect(ctx));
  if (!ctx.roles.includes(ADMIN_PERMISSION)) throw new GuardError(403, "admin role required");
  return ctx.user;
}

// Read + CSRF-verify a mutation's form body once. Every admin write is a first-party POST form, so a
// POST without a valid double-submit token is refused (GuardError → 403); non-POST ⇒ undefined.
export async function guardedForm(ctx: RequestContext, csrfSecret: string): Promise<URLSearchParams | undefined> {
  if ((ctx.req.method ?? "GET").toUpperCase() !== "POST") return undefined;
  const form = await readFormBody(ctx.req);
  if (!verifyCsrfRequest({ cookieHeader: ctx.req.headers.cookie, secret: csrfSecret, submitted: form.get(CSRF_FIELD) })) {
    throw new GuardError(403, "invalid CSRF token");
  }
  return form;
}

// Build the model for the shared destructive-action confirm page (views/admin/confirm.ejs): a single
// danger action behind a deliberate second step, plus a cancel link. Reused by all three screens.
export function buildConfirmModel(opts: {
  breadcrumbs: { href?: string; label: string }[];
  cancelHref: string;
  confirmAction: string;
  confirmLabel: string;
  csrfToken: string;
  current: AdminScreen;
  menu: MenuConfig;
  message: string;
  title: string;
  user: User | null;
}) {
  return {
    cancelHref: opts.cancelHref,
    confirm: { action: opts.confirmAction, label: opts.confirmLabel },
    message: opts.message,
    nav: adminNav(opts.user?.roles ?? [], opts.menu, opts.current),
    shell: buildShellContext({ breadcrumbs: opts.breadcrumbs, csrfToken: opts.csrfToken, menu: opts.menu, title: opts.title, user: opts.user }),
  };
}
