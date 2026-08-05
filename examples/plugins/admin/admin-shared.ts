// Shared plumbing for the admin example plugin: the section nav fragment, the admin-only gate, the
// CSRF-guarded form reader, the destructive-confirm model builder, and small RouteResult helpers
// (themed not-found / capability-unavailable). Ported from the former built-in admin screens;
// everything imports the host only through the #plugin-api barrel.

import { can, CSRF_FIELD, englishTranslator, GuardError, type NavNode, readFormBody, type RequestContext, requireSession, type RouteResult, type Translate, type User } from "#plugin-api";
import enUS from "./i18n/en-US.ts";

// This plugin's English (its catalog, then the host's — the screens reuse core words like Cancel and
// Search), for a view model built outside a request: its unit tests. At runtime the handlers pass
// ctx.t, which reads this catalog in the visitor's locale first, then the host's.
export const ADMIN_EN: Translate = englishTranslator(enUS);

export const ADMIN_USERS_BASE = "/admin/users";
export const ADMIN_GROUPS_BASE = "/admin/groups";
export const ADMIN_PERMISSIONS_BASE = "/admin/permissions";
export const ADMIN_CLIENTS_BASE = "/admin/clients";

// One resource per screen — the `<resource>` half of every permission this plugin gates on.
// `oauth2-clients` rather than `clients` because permission names are one global namespace.
export type AdminResource = "groups" | "oauth2-clients" | "permissions" | "users";

export type AdminAction = "read" | "write";

// `<resource>:<action>` (README → Naming a permission).
export function permissionName(resource: AdminResource, action: AdminAction): string {
  return `${resource}:${action}`;
}

// This plugin's mapping from method to action: every screen reads on GET/HEAD and mutates on POST.
// The manifest's route table and the in-handler guard both go through it rather than each spelling
// the permission out, so they cannot drift into gating on different names. Deliberately local — as
// a general mechanism it would make authorization a function of the transport verb, and a route
// table should answer "what does this need?" on its own (AGENTS.md).
export function actionForMethod(method: string): AdminAction {
  const verb = method.toUpperCase();
  return verb === "GET" || verb === "HEAD" ? "read" : "write";
}

// The plugin's nav fragment: an ungated "Admin" header + its four screens, each gated on its own
// read permission. The header carries no `permission` because a user may hold one screen's and not
// another's; composeNav drops a header left with no visible children, so a user holding none of the
// four never sees the section. The host current-marks the active item — no `current`/`open` here.
export const ADMIN_NAV: NavNode = {
  children: [
    { href: ADMIN_USERS_BASE, icon: "i-users", id: "users", label: "admin.nav.users", permission: "users:read" },
    { href: ADMIN_GROUPS_BASE, icon: "i-layers", id: "groups", label: "admin.nav.groups", permission: "groups:read" },
    { href: ADMIN_PERMISSIONS_BASE, icon: "i-shield", id: "permissions", label: "admin.nav.permissions", permission: "permissions:read" },
    { href: ADMIN_CLIENTS_BASE, icon: "i-globe", id: "clients", label: "admin.nav.clients", permission: "oauth2-clients:read" },
  ],
  icon: "i-shield",
  id: "admin",
  label: "admin.nav.section", // a key in this plugin's catalog; the host translates nav labels
};

// The screen gate: a signed-in user holding this request's `<resource>:<action>`. Each route already
// declares the same permission, so the host enforces it before the handler runs; this is
// defence-in-depth and what a direct unit test relies on. Returns the (non-null) user for the
// handler to thread on. GuardError → /login or 403.
export function requirePermission(ctx: RequestContext, resource: AdminResource): User {
  const user = requireSession(ctx); // anonymous → GuardError → /login (return_to kept)
  const permission = permissionName(resource, actionForMethod(ctx.req.method ?? "GET"));
  if (!can(ctx, permission)) throw new GuardError(403, `${permission} required`);
  return user;
}

// Read + CSRF-verify a mutation's form body once (double-submit via ctx.verifyCsrf); non-POST ⇒
// undefined. A POST without a valid token is refused (GuardError → 403).
export async function guardedForm(ctx: RequestContext): Promise<URLSearchParams | undefined> {
  if ((ctx.req.method ?? "GET").toUpperCase() !== "POST") return undefined;
  const form = await readFormBody(ctx.req);
  if (!ctx.verifyCsrf(form.get(CSRF_FIELD))) throw new GuardError(403, "invalid CSRF token");
  return form;
}

// A themed "not found" (bad id/name in the path) rendered in the admin shell — 404, never a 500.
export function notFound(ctx: RequestContext): RouteResult {
  return { data: { chrome: ctx.chrome, message: ctx.t("admin.notFound.message"), title: ctx.t("admin.notFound.title") }, status: 404, view: "notice" };
}

// A capability the plugin needs isn't on ctx.system (Ory not wired). Login already requires these in
// a real deployment, so this is the honest 503 fallback for a misconfigured host, not a crash.
export function unavailable(ctx: RequestContext, what: string): RouteResult {
  return { data: { chrome: ctx.chrome, message: ctx.t("admin.unavailable.message", { what }), title: ctx.t("admin.unavailable.title") }, status: 503, view: "notice" };
}

// Model for the shared destructive-confirm page (views/confirm.ejs). The view reads the shell fields
// (brand/csrf/theme/user/nav) from ctx.chrome; this carries only the page body + title/breadcrumbs.
export function buildConfirmModel(opts: {
  breadcrumbs: { href?: string; label: string }[];
  cancelHref: string;
  confirmAction: string;
  confirmLabel: string;
  message: string;
  title: string;
}) {
  return {
    breadcrumbs: opts.breadcrumbs,
    cancelHref: opts.cancelHref,
    confirm: { action: opts.confirmAction, label: opts.confirmLabel },
    message: opts.message,
    title: opts.title,
  };
}
