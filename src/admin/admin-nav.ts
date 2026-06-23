// The built-in admin section of the menu. `adminSection()` is the one definition of the
// permission-gated "Admin" header (Users/Groups/Roles/clients) + its gate, composed into the single
// global menu (`buildPluginChrome`) — composeNav drops the whole header + subtree for a
// non-admin. Every page (dashboard, admin, plugin, auth) renders that one menu, so there's no
// separate admin sidebar to drift.

import { readFormBody } from "../http/body.ts";
import type { RequestContext, User } from "../http/context.ts";
import { CSRF_FIELD, verifyCsrfRequest } from "../auth/csrf.ts";
import { GuardError, loginRedirect } from "../auth/guards.ts";
import { type MenuConfig } from "../ui/menu-config.ts";
import type { NavNode } from "../ui/nav.ts";
import { buildShellContext } from "../ui/shell-context.ts";

export const ADMIN_PERMISSION = "admin"; // role token gating the admin section
export const ADMIN_USERS_BASE = "/admin/users";
export const ADMIN_GROUPS_BASE = "/admin/groups";
export const ADMIN_ROLES_BASE = "/admin/roles";
export const ADMIN_CLIENTS_BASE = "/admin/clients";

export type AdminScreen = "clients" | "groups" | "roles" | "users";

// The "Dashboard" link to the gated app home (/dashboard), composed into the global menu by
// buildPluginChrome (chrome.ts). It targets a gated route, so the chrome hides it from anonymous
// visitors (a non-signed-in click only dead-ends at /login).
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
// danger action behind a deliberate second step, plus a cancel link. Reused by all admin screens.
// `nav` is the unified global menu (ctx.chrome.nav), passed in by the handler.
export function buildConfirmModel(opts: {
  breadcrumbs: { href?: string; label: string }[];
  cancelHref: string;
  confirmAction: string;
  confirmLabel: string;
  csrfToken: string;
  menu: MenuConfig;
  message: string;
  nav: NavNode[];
  title: string;
  user: User | null;
}) {
  return {
    cancelHref: opts.cancelHref,
    confirm: { action: opts.confirmAction, label: opts.confirmLabel },
    message: opts.message,
    nav: opts.nav,
    shell: buildShellContext({ breadcrumbs: opts.breadcrumbs, csrfToken: opts.csrfToken, menu: opts.menu, title: opts.title, user: opts.user }),
  };
}
