// The pure half of permission granting: what a submitted checkbox set changes, and the picker the
// two screens render from it. The Keto writes and the HTTP round trip are covered in src/http/app-admin.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PermissionDecl } from "@plainpages/plugin-api";
import type { KetoClient } from "@plainpages/plugin-api";
import { applyGrants, baselineToken, buildPermissionPicker, grantDiff, grantTuple, groupSubject, isStale, removeUndeclaredGrant, userSubject } from "./admin-grants.ts";

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
  const picker = buildPermissionPicker({ action: "/auth-admin/users/u1/permissions", declared, direct: ["users:write"] });
  assert.equal(picker.action, "/auth-admin/users/u1/permissions");
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

test("baselineToken depends on the offered grants held, not on their order or on undeclared ones", () => {
  const token = baselineToken(declared, ["users:read", "users:write"]);
  assert.match(token, /^[0-9a-f]+$/);
  assert.equal(baselineToken(declared, ["users:write", "users:read"]), token);
  assert.equal(baselineToken(declared, ["users:read", "users:write", "legacy:thing"]), token); // undeclared: never shown, never saved
  assert.notEqual(baselineToken(declared, ["users:read"]), token);
  assert.notEqual(baselineToken(declared, []), token);
  assert.notEqual(baselineToken(declared, []), ""); // an empty set is a state too, not an absent token
  assert.equal(buildPermissionPicker({ action: "/x", declared, direct: ["users:read", "users:write"] }).baseline, token);
});

test("isStale refuses a missing or old token, but only for a save that would change something", () => {
  const held = ["users:read"];
  const change = grantDiff(declared, held, ["users:read", "users:write"]);
  const nothing = grantDiff(declared, held, ["users:read"]);
  const current = new URLSearchParams({ baseline: baselineToken(declared, held) });
  const old = new URLSearchParams({ baseline: baselineToken(declared, []) });
  assert.equal(isStale(current, declared, held, change), false);
  assert.equal(isStale(old, declared, held, change), true);
  assert.equal(isStale(new URLSearchParams(), declared, held, change), true); // no token at all
  assert.equal(isStale(old, declared, held, nothing), false); // a repeated save has nothing to refuse
});

test("applyGrants sends the whole change as one Keto transaction, and a failure applies none of it", async () => {
  const calls: { delete: string[]; insert: string[] }[] = [];
  const keto = (fail = false): KetoClient => ({
    check: async () => false,
    deleteTuple: async () => { throw new Error("unused"); },
    expand: async () => ({ type: "leaf" }),
    listRelations: async () => ({ nextPageToken: null, tuples: [] }),
    transactTuples: async (c) => {
      if (fail) throw new Error("boom");
      calls.push({ delete: c.delete.map((tp) => tp.object), insert: c.insert.map((tp) => tp.object) });
    },
    writeTuple: async () => { throw new Error("unused"); },
  });
  const diff = { grant: ["a:read", "b:read"], revoke: ["c:read"] };

  await applyGrants(keto(), userSubject("u1"), diff);
  assert.deepEqual(calls, [{ delete: ["c:read"], insert: ["a:read", "b:read"] }]);
  await assert.rejects(applyGrants(keto(true), userSubject("u1"), diff), /boom/);
});

// grantDiff never touches a held name nobody declares, so the picker lists them apart and offers a
// Remove for each. A reader is told what is held but offered no button.
test("buildPermissionPicker lists direct grants no plugin declares, with a remove action only for a writer", () => {
  const direct = ["zed:read", "users:read", "old:write"];
  const picker = buildPermissionPicker({ action: "/auth-admin/users/u1/permissions", declared, direct });
  assert.deepEqual(picker.undeclared?.names, ["old:write", "zed:read"]);
  assert.equal(picker.undeclared?.action, "/auth-admin/users/u1/permissions/remove");
  assert.ok(picker.undeclared?.remove);
  assert.equal(buildPermissionPicker({ action: "/x", declared, direct, readOnly: true }).undeclared?.remove, undefined);
  assert.equal(buildPermissionPicker({ action: "/x", declared, direct: ["users:read"] }).undeclared, undefined);
  assert.equal(picker.baseline, buildPermissionPicker({ action: "/x", declared, direct: ["users:read"] }).baseline, "an undeclared grant doesn't make a form stale");
});

test("removeUndeclaredGrant deletes one held, undeclared grant and refuses anything else", async () => {
  const subject = userSubject("u1");
  const tuples = [grantTuple("old:write", subject), grantTuple("users:read", subject), grantTuple("old:write", userSubject("u2"))];
  const deleted: string[] = [];
  const keto: KetoClient = {
    check: async () => false,
    deleteTuple: async (tp) => { deleted.push(`${tp.object} ${tp.subject_id}`); },
    expand: async () => ({ type: "leaf" }),
    listRelations: async (q = {}) => ({ nextPageToken: null, tuples: tuples.filter((tp) => tp.subject_id === q.subject_id) }),
    transactTuples: async () => { throw new Error("unused"); },
    writeTuple: async () => { throw new Error("unused"); },
  };
  assert.equal(await removeUndeclaredGrant(keto, subject, declared, "old:write"), "old:write");
  assert.deepEqual(deleted, ["old:write user:u1"]);
  assert.equal(await removeUndeclaredGrant(keto, subject, declared, "users:read"), undefined, "a declared name is the picker's to change");
  assert.equal(await removeUndeclaredGrant(keto, subject, declared, "never:held"), undefined);
  assert.equal(await removeUndeclaredGrant(keto, subject, declared, null), undefined);
  assert.deepEqual(deleted, ["old:write user:u1"]);
});
