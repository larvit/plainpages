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
import { rolesAddMember, rolesCreate, rolesDelete, rolesDeleteConfirm, rolesDetail, rolesList, rolesNewForm, rolesRemoveMember } from "./admin-permissions.ts";
import { usersCreate, usersDeleteConfirm, usersDelete, usersEditForm, usersList, usersNewForm, usersRecovery, usersState, usersUpdate } from "./admin-users.ts";
import { ADMIN_NAV, adminPermission, type AdminResource } from "./admin-shared.ts";

// One route factory per screen: `permission` is derived by `adminPermission`, so a GET gates on
// `<resource>:read` and a POST on `<resource>:write` and the table below cannot drift from the guard
// each handler runs. The host redirects an anonymous visitor to /login, gives a signed-in user
// missing the permission the 403 page, and filters the nav the same way. Handlers are thin and keyed
// on ctx.params (the host extracts :id / :name), the idiomatic per-route style.
const on = (resource: AdminResource) => (method: HttpMethod, path: string, handler: RouteHandler): Route =>
  ({ handler, method, path, permission: adminPermission(resource, method) });

const users = on("users");
const groups = on("groups");
const permissions = on("permissions");
const clients = on("oauth2-clients");

export default definePlugin({
  apiVersion: "1.0.0", // the host contract this was built against — a literal, never HOST_API_VERSION

  nav: [ADMIN_NAV],

  permissions: [
    { description: "View users", name: "users:read" },
    { description: "Create, edit and delete users", name: "users:write" },
    { description: "View groups and their members", name: "groups:read" },
    { description: "Create, delete and change the membership of groups", name: "groups:write" },
    { description: "View permissions and who holds them", name: "permissions:read" },
    { description: "Create, delete and grant permissions", name: "permissions:write" },
    { description: "View OAuth2 clients", name: "oauth2-clients:read" },
    { description: "Register and delete OAuth2 clients", name: "oauth2-clients:write" },
  ],

  routes: [
    // Users
    users("GET", "/users", usersList),
    users("POST", "/users", usersCreate),
    users("GET", "/users/new", usersNewForm),
    users("GET", "/users/:id", usersEditForm),
    users("POST", "/users/:id", usersUpdate),
    users("POST", "/users/:id/state", usersState),
    users("GET", "/users/:id/delete", usersDeleteConfirm),
    users("POST", "/users/:id/delete", usersDelete),
    users("POST", "/users/:id/recovery", usersRecovery),
    // Groups
    groups("GET", "/groups", groupsList),
    groups("POST", "/groups", groupsCreate),
    groups("GET", "/groups/new", groupsNewForm),
    groups("GET", "/groups/:name", groupsDetail),
    groups("POST", "/groups/:name/members", groupsAddMember),
    groups("GET", "/groups/:name/delete", groupsDeleteConfirm),
    groups("POST", "/groups/:name/delete", groupsDelete),
    groups("POST", "/groups/:name/members/delete", groupsRemoveMember),
    // Permissions
    permissions("GET", "/permissions", rolesList),
    permissions("POST", "/permissions", rolesCreate),
    permissions("GET", "/permissions/new", rolesNewForm),
    permissions("GET", "/permissions/:name", rolesDetail),
    permissions("POST", "/permissions/:name/members", rolesAddMember),
    permissions("GET", "/permissions/:name/delete", rolesDeleteConfirm),
    permissions("POST", "/permissions/:name/delete", rolesDelete),
    permissions("POST", "/permissions/:name/members/delete", rolesRemoveMember),
    // OAuth2 clients
    clients("GET", "/clients", clientsList),
    clients("POST", "/clients", clientsCreate),
    clients("GET", "/clients/new", clientsNewForm),
    clients("GET", "/clients/:id", clientsDetail),
    clients("GET", "/clients/:id/delete", clientsDeleteConfirm),
    clients("POST", "/clients/:id/delete", clientsDelete),
  ],
});
