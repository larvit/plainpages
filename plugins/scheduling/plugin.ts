// Reference plugin (todo §7): a worked example of the contract — a list page that fetches upstream
// data, a CSRF-guarded form that forwards a write upstream, and permission-gated nav. Copy this
// folder, rename it, point it at your own backend. Full contract: docs/plugin-contract.md.

import { definePlugin } from "../../src/plugin.ts";
import { createShift, createUpstream, listShifts, newShiftForm, READ, SHIFTS_PATH, WRITE } from "./shifts.ts";

// The upstream this plugin reads/writes — a stand-in for your real backend (the plugin is
// stateless). Configure via env; the dev compose points it at a tiny mock (examples/shifts-upstream).
const upstream = createUpstream(process.env["SCHEDULING_UPSTREAM"] ?? "http://shifts-upstream:4000");

export default definePlugin({
  apiVersion: "1.0.0", // the host contract this was built against — a literal, never HOST_API_VERSION

  // Merged into the global menu + filtered per user: the "Shifts" leaf shows only for a user holding
  // `scheduling:read`, so the whole "Scheduling" header disappears for everyone else.
  nav: [{
    children: [{ href: SHIFTS_PATH, id: "scheduling:shifts", label: "Shifts", permission: READ }],
    icon: "i-cal",
    id: "scheduling",
    label: "Scheduling",
  }],

  // Tokens this plugin introduces (docs + Keto seeding). Namespaced `<id>:<action>`.
  permissions: [
    { description: "View shifts", token: READ },
    { description: "Create and edit shifts", token: WRITE },
  ],

  // Mounted under /scheduling; `permission` gates before the handler runs.
  routes: [
    { handler: listShifts(upstream), method: "GET", path: "/shifts", permission: READ },
    { handler: newShiftForm(), method: "GET", path: "/shifts/new", permission: WRITE },
    { handler: createShift(upstream), method: "POST", path: "/shifts", permission: WRITE },
  ],
});
