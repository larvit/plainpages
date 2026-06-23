// Central menu override + branding. Brand the app and reorder/rename/group/hide nav
// nodes (by their `id`) across all plugins — the override always wins, applied before the
// per-user permission filter. Every field is optional; delete one to fall back to the default.
// See src/ui/menu-config.ts (types), src/ui/nav.ts (NavOverride), docs/plugin-contract.md.

import { defineMenu } from "../src/ui/menu-config.ts";

export default defineMenu({
  branding: {
    name: "Plainpages", // app name shown in the sidebar
    sub: "Console", // optional subtitle under the name
    // logo: "/public/logo.svg", // optional logo asset (rendered in the sidebar brand)
    // theme: "auto",            // default color theme: auto | light | dark
  },

  // Operator override (rename → group → order → hide), keyed by node id.
  override: {
    // rename: { people: "Staff" },                                       // node id → new label
    // groups: [{ id: "admin", label: "Admin", children: ["users", "roles"] }],
    // order: ["people", "reports"],                                      // top-level order by id
    // hide: ["teams"],                                                    // remove nodes (any depth)
  },
});
