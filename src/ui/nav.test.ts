import assert from "node:assert/strict";
import { test } from "node:test";
import type { User } from "../http/context.ts";
import { composeNav, type NavNode } from "./nav.ts";

function viewer(...permissions: string[]): User {
  return { email: "viewer@example.test", id: "01a06091-ba9f-765f-abf4-b5144c314bc7", permissions };
}

// Two plugin fragments; ids let the override target nodes, `permission` gates per permission.
const fragments: NavNode[][] = [
  [{
    icon: "i-cal", id: "sched", label: "Scheduling",
    children: [
      { href: "/scheduling/shifts", id: "shifts", label: "Shifts", permission: "scheduling:read" },
      { href: "/scheduling/manage", id: "manage", label: "Manage", permission: "scheduling:admin" },
    ],
  }],
  [{ href: "/reports", id: "reports", label: "Reports", permission: "reports:read" }],
];

test("composeNav merges fragments, filters by permission, and emits clean render nodes", () => {
  const tree = composeNav(fragments, {}, viewer("scheduling:read"));

  // Reports gone (no reports:read), Manage gone (no scheduling:admin), header kept with Shifts.
  // Output carries no `id`/`permission` and omits absent fields — ready for nav-tree.ejs.
  assert.deepEqual(tree, [
    { icon: "i-cal", label: "Scheduling", children: [{ href: "/scheduling/shifts", label: "Shifts" }] },
  ]);
});

test("composeNav drops gated subtrees, empty headers, and (with no permissions) all gated nodes", () => {
  // A header the user can't reach takes its whole subtree, even visible children.
  const gatedHeader: NavNode[][] = [[
    { id: "admin", label: "Admin", permission: "users:read", children: [{ href: "/u", id: "u", label: "Users" }] },
    { id: "free", label: "Free", children: [{ href: "/d", id: "d", label: "Docs" }] },
  ]];
  assert.deepEqual(composeNav(gatedHeader, {}, viewer()), [
    { label: "Free", children: [{ href: "/d", label: "Docs" }] },
  ]);

  // A pure header whose children are all filtered is dropped; a header with an href survives as a leaf.
  const emptyHeader: NavNode[][] = [[
    { id: "sec", label: "Section", children: [{ href: "/x", id: "x", label: "X", permission: "x:read" }] },
    { href: "/hub", id: "hub", label: "Hub", children: [{ href: "/y", id: "y", label: "Y", permission: "y:read" }] },
  ]];
  assert.deepEqual(composeNav(emptyHeader, {}, viewer()), [{ href: "/hub", label: "Hub" }]);

  // No fragments / no permissions → empty tree, never throws.
  assert.deepEqual(composeNav(), []);
});

test("composeNav shows a public node to everyone and a session node to any signed-in user", () => {
  // A header with a public child, a session child and a gated child: the public child keeps the
  // header alive for an anonymous visitor — so a plugin can show a menu option to all.
  const frag: NavNode[][] = [[{
    icon: "i-cal", id: "sched", label: "Scheduling",
    children: [
      { href: "/scheduling", id: "overview", label: "Overview", public: true },
      { href: "/scheduling/mine", id: "mine", label: "Mine", session: true },
      { href: "/scheduling/shifts", id: "shifts", label: "Shifts", permission: "scheduling:read" },
    ],
  }]];
  // `public`/`session` are filter-only (like id/permission) — never rendered into the output node.
  assert.deepEqual(composeNav(frag, {}, null), [
    { icon: "i-cal", label: "Scheduling", children: [{ href: "/scheduling", label: "Overview" }] },
  ]);
  // Signed in with no permission at all: the session node appears, the permission-gated one does not.
  assert.deepEqual(composeNav(frag, {}, viewer()), [
    { icon: "i-cal", label: "Scheduling", children: [{ href: "/scheduling", label: "Overview" }, { href: "/scheduling/mine", label: "Mine" }] },
  ]);
});

test("composeNav applies the override: rename, group, order, hide (then filters)", () => {
  const base: NavNode[][] = [[
    { href: "/a", id: "a", label: "Alpha" },
    { href: "/b", id: "b", label: "Beta" },
    { href: "/c", id: "c", label: "Gamma" },
    { href: "/secret", id: "secret", label: "Secret", permission: "secrets:read" },
  ]];

  const tree = composeNav(base, {
    rename: { a: "First" },                                   // relabel by id
    groups: [{ icon: "i-box", id: "grp", label: "Group", open: true, children: ["b", "c"] }], // wrap b+c
    order: ["grp", "a"],                                     // grp before the lone a
    hide: ["c"],                                             // remove c from inside the group
  }, viewer("secrets:read"));

  // grp emitted (b only, c hidden), reordered before a; Secret kept now that permission "secrets:read" is present.
  assert.deepEqual(tree, [
    { icon: "i-box", label: "Group", open: true, children: [{ href: "/b", label: "Beta" }] },
    { href: "/a", label: "First" },
    { href: "/secret", label: "Secret" },
  ]);
});
