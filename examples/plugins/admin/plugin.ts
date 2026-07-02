// Admin example plugin: the Users / Groups / Roles / OAuth2-clients screens for running the system.
// These used to ship inside the core; they were extracted here so a fresh clone has no built-in admin
// GUI. Copy this folder to plugins/admin (then restart) to enable it — see README → Quick start.
//
// It is a *system* plugin: its handlers reach the host's Ory admin clients (Kratos/Keto/Hydra) and the
// instant-revoke hook via ctx.system, which the host populates when those services are wired (the dev
// stack wires all of them). Where a capability is absent the screen degrades to a themed 503.

import { definePlugin, type HttpMethod, type Route, type RouteHandler } from "#plugin-api";
import { clientsCreate, clientsDeleteConfirm, clientsDelete, clientsDetail, clientsList, clientsNewForm } from "./admin-clients.ts";
import { groupsAddMember, groupsCreate, groupsDelete, groupsDeleteConfirm, groupsDetail, groupsList, groupsNewForm, groupsRemoveMember } from "./admin-groups.ts";
import { rolesAddMember, rolesCreate, rolesDelete, rolesDeleteConfirm, rolesDetail, rolesList, rolesNewForm, rolesRemoveMember } from "./admin-roles.ts";
import { usersCreate, usersDeleteConfirm, usersDelete, usersEditForm, usersList, usersNewForm, usersRecovery, usersState, usersUpdate } from "./admin-users.ts";
import { ADMIN_NAV, ADMIN_PERMISSION } from "./admin-shared.ts";

// Every admin route is gated by the one `admin` permission — the host redirects an anonymous visitor
// to /login, gives a signed-in non-admin the 403 page, and filters the nav the same way. Handlers are
// thin and keyed on ctx.params (the host extracts :id / :name), the idiomatic per-route style.
const r = (method: HttpMethod, path: string, handler: RouteHandler): Route => ({ handler, method, path, permission: ADMIN_PERMISSION });

export default definePlugin({
  apiVersion: "1.0.0", // the host contract this was built against — a literal, never HOST_API_VERSION

  nav: [ADMIN_NAV],

  permissions: [{ description: "Administer users, groups, roles, and OAuth2 clients", token: ADMIN_PERMISSION }],

  routes: [
    // Users
    r("GET", "/users", usersList),
    r("POST", "/users", usersCreate),
    r("GET", "/users/new", usersNewForm),
    r("GET", "/users/:id", usersEditForm),
    r("POST", "/users/:id", usersUpdate),
    r("POST", "/users/:id/state", usersState),
    r("GET", "/users/:id/delete", usersDeleteConfirm),
    r("POST", "/users/:id/delete", usersDelete),
    r("POST", "/users/:id/recovery", usersRecovery),
    // Groups
    r("GET", "/groups", groupsList),
    r("POST", "/groups", groupsCreate),
    r("GET", "/groups/new", groupsNewForm),
    r("GET", "/groups/:name", groupsDetail),
    r("POST", "/groups/:name/members", groupsAddMember),
    r("GET", "/groups/:name/delete", groupsDeleteConfirm),
    r("POST", "/groups/:name/delete", groupsDelete),
    r("POST", "/groups/:name/members/delete", groupsRemoveMember),
    // Roles
    r("GET", "/roles", rolesList),
    r("POST", "/roles", rolesCreate),
    r("GET", "/roles/new", rolesNewForm),
    r("GET", "/roles/:name", rolesDetail),
    r("POST", "/roles/:name/members", rolesAddMember),
    r("GET", "/roles/:name/delete", rolesDeleteConfirm),
    r("POST", "/roles/:name/delete", rolesDelete),
    r("POST", "/roles/:name/members/delete", rolesRemoveMember),
    // OAuth2 clients
    r("GET", "/clients", clientsList),
    r("POST", "/clients", clientsCreate),
    r("GET", "/clients/new", clientsNewForm),
    r("GET", "/clients/:id", clientsDetail),
    r("GET", "/clients/:id/delete", clientsDeleteConfirm),
    r("POST", "/clients/:id/delete", clientsDelete),
  ],
});
