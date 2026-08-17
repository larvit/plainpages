// The pure half of permission granting: what a submitted checkbox set changes, and the picker the
// two screens render from it. The Keto writes and the HTTP round trip are covered in app.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PermissionDecl } from "@plainpages/plugin-api";
import { buildPermissionPicker, grantDiff, grantTuple, groupSubject, userSubject } from "./admin-grants.ts";

const declared: PermissionDecl[] = [
  { description: "View users", name: "users:read" },
  { description: "Edit users", name: "users:write" },
  { name: "groups:read" },
];

test("grantTuple targets a user by subject_id and a group by subject_set", () => {
  assert.deepEqual(grantTuple("users:read", userSubject("u1")), { namespace: "Permission", object: "users:read", relation: "granted", subject_id: "user:u1" });
  assert.deepEqual(grantTuple("users:read", groupSubject("eng")), {
    namespace: "Permission", object: "users:read", relation: "granted",
    subject_set: { namespace: "Group", object: "eng", relation: "members" },
  });
});

test("grantDiff: the submitted set is the desired state — tick grants, untick revokes, unchanged is a no-op", () => {
  assert.deepEqual(grantDiff(declared, ["users:read"], ["users:read", "users:write"]), { grant: ["users:write"], revoke: [] });
  assert.deepEqual(grantDiff(declared, ["users:read", "users:write"], ["users:read"]), { grant: [], revoke: ["users:write"] });
  assert.deepEqual(grantDiff(declared, ["users:read"], ["users:read"]), { grant: [], revoke: [] });
  assert.deepEqual(grantDiff(declared, ["users:read"], []), { grant: [], revoke: ["users:read"] }); // every box cleared
});

test("grantDiff ignores anything the plugins don't declare, in both directions", () => {
  // A crafted POST can't grant a name no plugin gates on…
  assert.deepEqual(grantDiff(declared, [], ["superuser:all"]), { grant: [], revoke: [] });
  // …and a held name that is no longer declared (its plugin was uninstalled) is left alone rather
  // than silently revoked by an unrelated save — this screen only speaks for what it offered.
  assert.deepEqual(grantDiff(declared, ["legacy:thing"], ["users:read"]), { grant: ["users:read"], revoke: [] });
});

test("buildPermissionPicker ticks what is held and carries each declaration's description", () => {
  const picker = buildPermissionPicker({ action: "/admin/users/u1/permissions", declared, direct: ["users:write"] });
  assert.equal(picker.action, "/admin/users/u1/permissions");
  assert.deepEqual(picker.choices.map((c) => c.name), ["users:read", "users:write", "groups:read"]);
  assert.deepEqual(picker.choices.map((c) => c.checked), [false, true, false]);
  assert.equal(picker.choices[0]?.description, "View users");
  assert.equal(picker.choices[2]?.description, ""); // a declaration may omit one
  assert.equal(picker.empty, undefined);
  assert.equal(picker.readOnly, false);
  assert.equal(picker.inheritedNote, undefined); // nothing is group-held here
});

// An inherited permission rendered unticked would say "not held" about a grant that reaches the JWT,
// and unticking it writes nothing, reading as a successful revoke. So inherited rows are ticked,
// disabled, and never posted.
test("buildPermissionPicker distinguishes a direct grant from one inherited through a group", () => {
  const picker = buildPermissionPicker({ action: "/x", declared, direct: ["users:write"], effective: ["users:read", "users:write"] });
  assert.deepEqual(picker.choices.map((c) => [c.name, c.checked, c.inherited]), [
    ["users:read", true, true], // effective but not direct → shown as held, not editable here
    ["users:write", true, false], // direct → editable
    ["groups:read", false, false],
  ]);
  assert.ok(picker.inheritedNote, "the disabled row needs an explanation");
});

test("buildPermissionPicker in read-only mode still shows the state, and marks itself unwritable", () => {
  const picker = buildPermissionPicker({ action: "/x", declared, direct: ["users:read"], effective: ["users:read", "groups:read"], readOnly: true });
  assert.equal(picker.readOnly, true);
  assert.deepEqual(picker.choices.map((c) => c.checked), [true, false, true]); // a reader still sees who holds what
  // Every row renders disabled for a reader, so the writable copy would be wrong twice over: "tick to
  // grant" is false, and "greyed-out means group-held" would misattribute the direct grant.
  assert.equal(picker.inheritedNote, undefined);
  assert.notEqual(picker.hint, buildPermissionPicker({ action: "/x", declared, direct: [] }).hint);
});

test("buildPermissionPicker notes the transitive lag for a group, and stays quiet for a user", () => {
  // A group's members inherit, so the change reaches them at their next re-mint; a user's own grant
  // change revokes their live tokens, so there is nothing to warn about.
  assert.ok(buildPermissionPicker({ action: "/x", declared, direct: [], transitive: true }).pending);
  assert.equal(buildPermissionPicker({ action: "/x", declared, direct: [] }).pending, undefined);
});

test("buildPermissionPicker says so when no plugin declares a permission, rather than rendering an empty box", () => {
  const picker = buildPermissionPicker({ action: "/x", declared: [], direct: [] });
  assert.deepEqual(picker.choices, []);
  assert.ok(picker.empty);
});
