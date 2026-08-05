// Built-in Roles admin screen: the pure view-model + Keto builders. A permission is a
// Keto subject set (Permission:<name>#members); members are users (subject_id) or groups (subject_set) —
// "assign permissions to users/groups". The "effective access" view flattens a Keto `expand` tree into the
// distinct set of users who hold the permission directly or transitively via a group. The HTTP
// routing/gate/CSRF + live Keto/Kratos calls are exercised over HTTP in app.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { memberView } from "./admin-groups.ts";
import {
  buildPermissionDetailModel,
  buildPermissionFormModel,
  buildPermissionsListModel,
  expandToEffectiveUsers,
  isPermissionPathSegment,
  isValidPermissionName,
  permissionGrantTuple,
} from "./admin-permissions.ts";
import type { ExpandTree, RelationTuple } from "#plugin-api";

const uid = (n: number) => `01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b${String(n).padStart(2, "0")}`;
const userTuple = (permission: string, n: number): RelationTuple =>
  ({ namespace: "Permission", object: permission, relation: "granted", subject_id: `user:${uid(n)}` });
const groupTuple = (permission: string, group: string): RelationTuple =>
  ({ namespace: "Permission", object: permission, relation: "granted", subject_set: { namespace: "Group", object: group, relation: "members" } });

test("isValidPermissionName requires <resource>:<action> so the convention holds for anything created here", () => {
  for (const ok of ["users:read", "scheduling:write", "oauth2-clients:read", "team-a:a1_b9"]) assert.equal(isValidPermissionName(ok), true, ok);
  // A bare word is what this rule exists to stop — "admin" says who you are, not what you may do.
  for (const bad of ["admin", "", "Users:read", "users:", ":read", "users:read:extra", "a b:read", "-bad:read", `${"a".repeat(60)}:read`]) {
    assert.equal(isValidPermissionName(bad), false, bad);
  }
});

test("isPermissionPathSegment stays loose enough to address a permission that predates the rule", () => {
  // Addressing is not creating: an "admin" tuple left in Keto must still open and delete, or it is
  // stranded. It only has to be a safe URL/Keto object name.
  for (const ok of ["admin", "users:read", "legacy_name"]) assert.equal(isPermissionPathSegment(ok), true, ok);
  for (const bad of ["", "Admin", "a b", "-bad", "a/b", "a".repeat(65)]) assert.equal(isPermissionPathSegment(bad), false, bad);
});

test("permissionGrantTuple maps the form value to a Permission tuple over a user/group (else null)", () => {
  assert.deepEqual(permissionGrantTuple("things:read", `user:${uid(2)}`), { namespace: "Permission", object: "things:read", relation: "granted", subject_id: `user:${uid(2)}` });
  assert.deepEqual(permissionGrantTuple("things:read", "group:eng"), { namespace: "Permission", object: "things:read", relation: "granted", subject_set: { namespace: "Group", object: "eng", relation: "members" } });
  for (const bad of ["", "user:not-a-uuid", "group:Bad Name", "nope:x"]) assert.equal(permissionGrantTuple("things:read", bad), null, bad);
});

test("expandToEffectiveUsers flattens an expand tree → sorted distinct user ids, transitive through groups", () => {
  // The subject rides on each node's `tuple` (Keto v26.2.0 shape, verified live).
  const leaf = (n: number): ExpandTree => ({ tuple: { namespace: "", object: "", relation: "", subject_id: `user:${uid(n)}` }, type: "leaf" });
  const tree: ExpandTree = {
    children: [
      leaf(1), // direct
      {
        children: [leaf(2), leaf(1)], // via group + dup
        tuple: { namespace: "", object: "", relation: "", subject_set: { namespace: "Group", object: "eng", relation: "members" } }, // a member group, not a user
        type: "union",
      },
    ],
    tuple: { namespace: "", object: "", relation: "", subject_set: { namespace: "Permission", object: "admin", relation: "granted" } },
    type: "union",
  };
  assert.deepEqual(expandToEffectiveUsers(tree), [uid(1), uid(2)]);
  assert.deepEqual(expandToEffectiveUsers(null), []);
  assert.deepEqual(expandToEffectiveUsers({ type: "leaf" }), []); // an empty permission
});

test("buildPermissionsListModel filters by search, sorts, paginates; the name links to the detail page", () => {
  const permissions = Array.from({ length: 30 }, (_, i) => ({ memberCount: i + 1, name: `permission-${String(i).padStart(2, "0")}` }));

  const all = buildPermissionsListModel({ permissions, url: "http://x/admin/permissions" });
  assert.equal(all.pagination.summary.total, 30);
  assert.equal(all.table.rows.length, 25); // default page size
  assert.equal(all.title, "Permissions");
  const first = all.table.rows[0]!.cells[0] as { rowHeader: { href: string; text: string } };
  assert.equal(first.rowHeader.text, "permission-00");
  assert.equal(first.rowHeader.href, "/admin/permissions/permission-00");

  const one = buildPermissionsListModel({ permissions, url: "http://x/admin/permissions?q=permission-07" });
  assert.equal(one.pagination.summary.total, 1);
  assert.deepEqual(one.filterBar.pills.map((p) => p.label), ["Search"]);

  const desc = buildPermissionsListModel({ permissions, url: "http://x/admin/permissions?sort=-members" });
  assert.equal((desc.table.rows[0]!.cells[0] as { rowHeader: { text: string } }).rowHeader.text, "permission-29");
});

test("buildPermissionFormModel: a create form with a required name field + member options (user or group)", () => {
  const options = [{ label: "ada@example.com", value: `user:${uid(1)}` }, { label: "eng (group)", value: "group:eng" }];
  const m = buildPermissionFormModel({ csrfToken: "tok.sig", memberOptions: options });
  assert.equal(m.title, "New permission");
  assert.equal(m.form.action, "/admin/permissions");
  assert.equal(m.form.submitLabel, "Create permission");
  assert.equal(m.form.csrfToken, "tok.sig");
  assert.equal(m.form.nameField.required, true);
  assert.deepEqual(m.form.memberOptions, options);

  const err = buildPermissionFormModel({ error: "That name is taken.", memberOptions: options, values: { member: "group:eng", name: "Admin" } });
  assert.equal(err.error, "That name is taken.");
  assert.equal(err.form.nameField.value, "Admin");
  assert.equal(err.form.selectedMember, "group:eng");
});

test("buildPermissionDetailModel: members → rows, add-options exclude current members, effective access listed, actions wired", () => {
  const members = [memberView(userTuple("users:read", 1), new Map([[uid(1), "ada@example.com"]])), memberView(groupTuple("users:read", "eng"), new Map())];
  const candidates = [
    { label: "ada@example.com", value: `user:${uid(1)}` }, // already a member → excluded
    { label: "grace@example.com", value: `user:${uid(2)}` },
    { label: "eng (group)", value: "group:eng" }, // already a member → excluded
    { label: "ops (group)", value: "group:ops" },
  ];
  const effective = [{ label: "ada@example.com" }, { label: "grace@example.com" }]; // ada direct, grace via eng
  const m = buildPermissionDetailModel({ candidates, effective, members, permission: { name: "users:read" } });
  assert.equal(m.title, "users:read");
  assert.equal(m.members.rows.length, 2);
  // Every permission name now carries a colon, so the percent-encoding in these action URLs is
  // load-bearing: the host's router decodes the segment back to "users:read" for ctx.params.
  assert.equal(m.members.action, "/admin/permissions/users%3Aread/members/delete");
  assert.equal(m.add.action, "/admin/permissions/users%3Aread/members");
  assert.deepEqual(m.add.options.map((o) => o.value), [`user:${uid(2)}`, "group:ops"]);
  assert.deepEqual(m.effective.map((e) => e.label), ["ada@example.com", "grace@example.com"]);
  assert.equal(m.delete.action, "/admin/permissions/users%3Aread/delete");
});
