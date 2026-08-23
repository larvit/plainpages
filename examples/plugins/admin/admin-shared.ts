// Shared plumbing for the admin example plugin: the section nav fragment, the screen gate, the
// CSRF-guarded form reader, the destructive-confirm model builder, and small RouteResult helpers.
// Everything imports the host only through the @plainpages/plugin-api barrel.

import { can, CSRF_FIELD, englishTranslator, GuardError, type NavNode, readFormBody, type RequestContext, requireSession, type RouteResult, type Translate, type User } from "@plainpages/plugin-api";
import enUS from "./i18n/en-US.ts";

// This plugin's English — its catalog, then the host's — for a view model built outside a request,
// i.e. its unit tests. At runtime the handlers pass ctx.t instead.
export const ADMIN_EN: Translate = englishTranslator(enUS);

export const ADMIN_USERS_BASE = "/admin/users";
export const ADMIN_GROUPS_BASE = "/admin/groups";
export const ADMIN_CLIENTS_BASE = "/admin/clients";
export const ADMIN_PLUGIN_SETTINGS_BASE = "/admin/plugin-settings";

// One resource per screen — the `<resource>` half of every permission this plugin gates on.
// `oauth2-clients` rather than `clients` because permission names are one global namespace.
// There is no `permissions` resource: permissions are declared in plugin code, not created here, so
// holding a grant is a property of a user or a group and is edited on those two screens.
export type AdminResource = "groups" | "oauth2-clients" | "plugin-settings" | "users";

export type AdminAction = "read" | "write";

// `<resource>:<action>` (README → Naming a permission).
export function permissionName(resource: AdminResource, action: AdminAction): string {
  return `${resource}:${action}`;
}

// Every screen reads on GET/HEAD and mutates on POST. The route table and the in-handler guard both
// go through this rather than each spelling the permission out, so they cannot drift. Deliberately
// local: generalised, it would make authorization a function of the transport verb (AGENTS.md).
export function actionForMethod(method: string): AdminAction {
  const verb = method.toUpperCase();
  return verb === "GET" || verb === "HEAD" ? "read" : "write";
}

// The plugin's nav fragment: an ungated "Admin" header + its three screens, each gated on its own
// read permission. The header carries no `permission` because a user may hold one screen's and not
// another's; composeNav drops a header left with no visible children, so a user holding none of the
// three never sees the section. The host current-marks the active item — no `current`/`open` here.
export const ADMIN_NAV: NavNode = {
  children: [
    { href: ADMIN_USERS_BASE, icon: "i-users", id: "users", label: "admin.nav.users", permission: permissionName("users", "read") },
    { href: ADMIN_GROUPS_BASE, icon: "i-layers", id: "groups", label: "admin.nav.groups", permission: permissionName("groups", "read") },
    { href: ADMIN_CLIENTS_BASE, icon: "i-globe", id: "clients", label: "admin.nav.clients", permission: permissionName("oauth2-clients", "read") },
    { href: ADMIN_PLUGIN_SETTINGS_BASE, icon: "i-sliders", id: "plugin-settings", label: "admin.nav.pluginSettings", permission: permissionName("plugin-settings", "read") },
  ],
  icon: "i-shield",
  id: "admin",
  label: "admin.nav.section", // a key in this plugin's catalog; the host translates nav labels
};

// The screen gate: a signed-in user holding this request's `<resource>:<action>`. Each route already
// declares the same permission, so this is defence-in-depth and what a direct unit test relies on.
// `action` defaults to the method's, and is passed explicitly by a *write-intent GET* — a create
// form or a delete-confirm page — which refuses a reader rather than rendering a form whose submit
// would 403. The route table declares the same override, so the two cannot disagree.
export function requirePermission(ctx: RequestContext, resource: AdminResource, action?: AdminAction): User {
  const user = requireSession(ctx); // anonymous → GuardError → /login (return_to kept)
  const permission = permissionName(resource, action ?? actionForMethod(ctx.req.method ?? "GET"));
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
