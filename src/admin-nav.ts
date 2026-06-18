// Shared sidebar nav for the built-in admin screens (todo §5). Both the Users and Groups
// screens render the same admin section (Dashboard · Users · Groups), with `current` set on the
// active item. Extracted so the two screens can't drift. The global config-driven menu wiring
// (an admin section gated per user) is the separate §5 menu item; this is the local in-screen nav.

import { type MenuConfig } from "./menu-config.ts";
import { composeNav, type NavNode } from "./nav.ts";

export const ADMIN_PERMISSION = "admin"; // role token gating every admin screen
export const ADMIN_USERS_BASE = "/admin/users";
export const ADMIN_GROUPS_BASE = "/admin/groups";
export const ADMIN_ROLES_BASE = "/admin/roles";

type AdminScreen = "dashboard" | "groups" | "roles" | "users";

export function adminNav(roles: string[], menu: MenuConfig, current: AdminScreen): NavNode[] {
  const gated = (id: AdminScreen, href: string, icon: string, label: string): NavNode =>
    ({ ...(current === id ? { current: true } : {}), href, icon, id, label, permission: ADMIN_PERMISSION });
  return composeNav([[
    { href: "/", icon: "i-grid", id: "dashboard", label: "Dashboard" },
    gated("users", ADMIN_USERS_BASE, "i-users", "Users"),
    gated("groups", ADMIN_GROUPS_BASE, "i-layers", "Groups"),
    gated("roles", ADMIN_ROLES_BASE, "i-shield", "Roles"),
  ]], menu.override, roles);
}
