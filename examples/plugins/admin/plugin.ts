// Admin example plugin: the Users / Groups / OAuth2-clients screens for running the system.
// These used to ship inside the core; they were extracted here so a fresh clone has no built-in admin
// GUI. Copy this folder to plugins/admin (then restart) to enable it — see README → Quick start.
//
// It is a *system* plugin: its handlers reach the host's Ory admin clients (Kratos/Keto/Hydra) and the
// instant-revoke hook via ctx.system, which the host populates when those services are wired (the dev
// stack wires all of them). Where a capability is absent the screen degrades to a themed 503.

import { definePlugin, type HttpMethod, type Route, type RouteHandler } from "#plugin-api";
import { clientsCreate, clientsDeleteConfirm, clientsDelete, clientsDetail, clientsList, clientsNewForm } from "./admin-clients.ts";
import { groupsAddMember, groupsCreate, groupsDelete, groupsDeleteConfirm, groupsDetail, groupsList, groupsNewForm, groupsPermissions, groupsRemoveMember } from "./admin-groups.ts";
import { usersCreate, usersDeleteConfirm, usersDelete, usersEditForm, usersList, usersNewForm, usersPermissions, usersRecovery, usersState, usersUpdate } from "./admin-users.ts";
import { ADMIN_NAV, actionForMethod, type AdminResource, permissionName } from "./admin-shared.ts";

// One route factory per screen: a GET gates on `<resource>:read` and a POST on `<resource>:write`,
// derived through the same two helpers the in-handler guard uses, so the table below cannot drift
// from it. The host redirects an anonymous visitor to /login, gives a signed-in user missing the
// permission the 403 page, and filters the nav the same way. Handlers are thin and keyed on
// ctx.params (the host extracts :id / :name), the idiomatic per-route style.
const on = (resource: AdminResource) => (method: HttpMethod, path: string, handler: RouteHandler): Route =>
  ({ handler, method, path, permission: permissionName(resource, actionForMethod(method)) });

const users = on("users");
const groups = on("groups");
const clients = on("oauth2-clients");

export default definePlugin({
  apiVersion: "1.0.0", // the host contract this was built against — a literal, never HOST_API_VERSION

  nav: [ADMIN_NAV],

  permissions: [
    { description: "View users and the permissions they hold", name: "users:read" },
    { description: "Create, edit and delete users, and grant them permissions", name: "users:write" },
    { description: "View groups, their members and the permissions they hold", name: "groups:read" },
    { description: "Create and delete groups, and change their members and permissions", name: "groups:write" },
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
    users("POST", "/users/:id/permissions", usersPermissions),
    // Groups
    groups("GET", "/groups", groupsList),
    groups("POST", "/groups", groupsCreate),
    groups("GET", "/groups/new", groupsNewForm),
    groups("GET", "/groups/:name", groupsDetail),
    groups("POST", "/groups/:name/members", groupsAddMember),
    groups("GET", "/groups/:name/delete", groupsDeleteConfirm),
    groups("POST", "/groups/:name/delete", groupsDelete),
    groups("POST", "/groups/:name/members/delete", groupsRemoveMember),
    groups("POST", "/groups/:name/permissions", groupsPermissions),
    // OAuth2 clients
    clients("GET", "/clients", clientsList),
    clients("POST", "/clients", clientsCreate),
    clients("GET", "/clients/new", clientsNewForm),
    clients("GET", "/clients/:id", clientsDetail),
    clients("GET", "/clients/:id/delete", clientsDeleteConfirm),
    clients("POST", "/clients/:id/delete", clientsDelete),
  ],
});
