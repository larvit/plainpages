// The built-in admin section of the menu (todo §5). One definition of the Users/Groups/Roles links
// + their gate, reused two ways so they can't drift: `adminSection()` is the permission-gated
// "Admin" header wired into the global dashboard menu (composeNav drops the whole header + subtree
// for a non-admin), and `adminNav()` is the in-screen sidebar each admin screen renders (a link home
// + the same section, with the active item marked `current`).

import { type MenuConfig } from "./menu-config.ts";
import { composeNav, type NavNode } from "./nav.ts";

export const ADMIN_PERMISSION = "admin"; // role token gating the admin section
export const ADMIN_USERS_BASE = "/admin/users";
export const ADMIN_GROUPS_BASE = "/admin/groups";
export const ADMIN_ROLES_BASE = "/admin/roles";

export type AdminScreen = "groups" | "roles" | "users";

const ITEMS: { href: string; icon: string; id: AdminScreen; label: string }[] = [
  { href: ADMIN_USERS_BASE, icon: "i-users", id: "users", label: "Users" },
  { href: ADMIN_GROUPS_BASE, icon: "i-layers", id: "groups", label: "Groups" },
  { href: ADMIN_ROLES_BASE, icon: "i-shield", id: "roles", label: "Roles" },
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
  return composeNav([[
    { href: "/", icon: "i-grid", id: "dashboard", label: "Dashboard" },
    adminSection(current),
  ]], menu.override, roles);
}
