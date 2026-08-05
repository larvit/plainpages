import assert from "node:assert/strict";
import { test } from "node:test";
import { composeNav, type NavNode } from "./nav.ts";

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
  const tree = composeNav(fragments, {}, ["scheduling:read"]);

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
  assert.deepEqual(composeNav(gatedHeader, {}, []), [
    { label: "Free", children: [{ href: "/d", label: "Docs" }] },
  ]);

  // A pure header whose children are all filtered is dropped; a header with an href survives as a leaf.
  const emptyHeader: NavNode[][] = [[
    { id: "sec", label: "Section", children: [{ href: "/x", id: "x", label: "X", permission: "x:read" }] },
    { href: "/hub", id: "hub", label: "Hub", children: [{ href: "/y", id: "y", label: "Y", permission: "y:read" }] },
  ]];
  assert.deepEqual(composeNav(emptyHeader, {}, []), [{ href: "/hub", label: "Hub" }]);

  // No fragments / no permissions → empty tree, never throws.
  assert.deepEqual(composeNav(), []);
});

test("composeNav keeps a node marked public for everyone — the blessed public alias", () => {
  // A header with one public child + one gated child: with no permissions, the public child keeps the
  // header alive (the gated child is filtered out) — so a plugin can show a public menu option to all.
  const frag: NavNode[][] = [[{
    icon: "i-cal", id: "sched", label: "Scheduling",
    children: [
      { href: "/scheduling", id: "overview", label: "Overview", public: true },
      { href: "/scheduling/shifts", id: "shifts", label: "Shifts", permission: "scheduling:read" },
    ],
  }]];
  // `public` is filter-only (like id/permission) — never rendered into the output node.
  assert.deepEqual(composeNav(frag, {}, []), [
    { icon: "i-cal", label: "Scheduling", children: [{ href: "/scheduling", label: "Overview" }] },
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
  }, ["secrets:read"]);

  // grp emitted (b only, c hidden), reordered before a; Secret kept now that permission "secrets:read" is present.
  assert.deepEqual(tree, [
    { icon: "i-box", label: "Group", open: true, children: [{ href: "/b", label: "Beta" }] },
    { href: "/a", label: "First" },
    { href: "/secret", label: "Secret" },
  ]);
});
