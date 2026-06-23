// Reference plugin: a worked example of the contract — a list page that fetches upstream
// data, a CSRF-guarded form that forwards a write upstream, and permission-gated nav. Copy this
// folder, rename it, point it at your own backend. Full contract: docs/plugin-contract.md.

import { definePlugin } from "../../src/plugin-api.ts";
import { assertHttpUrl, createShift, createUpstream, listShifts, newShiftForm, overview, READ, SCHEDULING_PATH, SHIFTS_PATH, WRITE } from "./shifts.ts";

// The upstream this plugin reads/writes — a stand-in for your real backend (the plugin is
// stateless). Configure via env; the dev compose points it at a tiny mock (examples/shifts-upstream).
const upstreamUrl = process.env["SCHEDULING_UPSTREAM"] ?? "http://shifts-upstream:4000";
const upstream = createUpstream(upstreamUrl);

export default definePlugin({
  apiVersion: "1.0.0", // the host contract this was built against — a literal, never HOST_API_VERSION

  // onBoot runs after discovery, before the server listens: validate the plugin's own config so a
  // typo'd SCHEDULING_UPSTREAM fails the boot loudly instead of degrading every request later.
  hooks: { onBoot: () => assertHttpUrl(upstreamUrl, "SCHEDULING_UPSTREAM") },

  // Merged into the global menu + filtered per user. "Overview" is `public`, so the "Scheduling"
  // header shows for everyone (even signed out); "Shifts" needs `scheduling:read`, so the gated data
  // stays hidden until a reader signs in (a plugin may make a page + its menu option public).
  nav: [{
    children: [
      { href: SCHEDULING_PATH, id: "scheduling:overview", label: "Overview", public: true },
      { href: SHIFTS_PATH, id: "scheduling:shifts", label: "Shifts", permission: READ },
    ],
    icon: "i-cal",
    id: "scheduling",
    label: "Scheduling",
  }],

  // Tokens this plugin introduces (docs + Keto seeding). Namespaced `<id>:<action>`.
  permissions: [
    { description: "View shifts", token: READ },
    { description: "Create and edit shifts", token: WRITE },
  ],

  // Mounted under /scheduling; `permission` gates before the handler runs. The overview is `public`
  // (anyone may reach /scheduling, signed in or not); the rest need a role.
  routes: [
    { handler: overview(), method: "GET", path: "/", public: true },
    { handler: listShifts(upstream), method: "GET", path: "/shifts", permission: READ },
    { handler: newShiftForm(), method: "GET", path: "/shifts/new", permission: WRITE },
    { handler: createShift(upstream), method: "POST", path: "/shifts", permission: WRITE },
  ],
});
