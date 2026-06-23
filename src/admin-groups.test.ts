// Built-in Groups admin screen: the pure view-model + Keto-tuple builders. A group is a
// Keto subject set (Group:<name>#members); membership tuples carry users (subject_id) or nested
// groups (subject_set). The HTTP routing/gate/CSRF + live Keto/Kratos calls are exercised over
// HTTP in app.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGroupDetailModel,
  buildGroupFormModel,
  buildGroupsListModel,
  groupsFromTuples,
  isValidGroupName,
  memberTuple,
  memberView,
  parseSubject,
} from "./admin-groups.ts";
import type { RelationTuple } from "./keto-client.ts";

const uid = (n: number) => `01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b${String(n).padStart(2, "0")}`;
const userTuple = (group: string, n: number): RelationTuple =>
  ({ namespace: "Group", object: group, relation: "members", subject_id: `user:${uid(n)}` });
const groupTuple = (group: string, child: string): RelationTuple =>
  ({ namespace: "Group", object: group, relation: "members", subject_set: { namespace: "Group", object: child, relation: "members" } });

test("isValidGroupName accepts URL-safe names, rejects empties/spaces/uppercase/leading punctuation", () => {
  for (const ok of ["eng", "team-a", "a1_b9", "x"]) assert.equal(isValidGroupName(ok), true, ok);
  for (const bad of ["", "Eng", "a b", "-bad", "_bad", "a/b", "a".repeat(65)]) assert.equal(isValidGroupName(bad), false, bad);
});

test("parseSubject + memberTuple map the form value to the user/nested-group subject (else null)", () => {
  assert.deepEqual(parseSubject(`user:${uid(1)}`), { subject_id: `user:${uid(1)}` });
  assert.deepEqual(parseSubject("group:eng"), { subject_set: { namespace: "Group", object: "eng", relation: "members" } });
  // Both forms are validated: a non-UUID user / invalid group name is rejected, not written blindly.
  for (const bad of ["", "user:", "user:not-a-uuid", "group:", "group:Bad Name", "nope:x", "plain"]) assert.equal(parseSubject(bad), null, bad);

  assert.deepEqual(memberTuple("design", `user:${uid(2)}`), { namespace: "Group", object: "design", relation: "members", subject_id: `user:${uid(2)}` });
  assert.deepEqual(memberTuple("design", "group:eng"), { namespace: "Group", object: "design", relation: "members", subject_set: { namespace: "Group", object: "eng", relation: "members" } });
  assert.equal(memberTuple("design", "bad"), null);
});

test("groupsFromTuples collapses membership tuples → distinct groups + member counts, sorted by name", () => {
  const tuples = [userTuple("eng", 1), userTuple("eng", 2), groupTuple("eng", "design"), userTuple("design", 3)];
  assert.deepEqual(groupsFromTuples(tuples), [
    { memberCount: 1, name: "design" },
    { memberCount: 3, name: "eng" },
  ]);
});

test("memberView resolves a user subject to its email (else the raw id) and a subject_set to the group", () => {
  const emails = new Map([[uid(1), "ada@example.com"]]);
  assert.deepEqual(memberView(userTuple("eng", 1), emails), { kind: "user", label: "ada@example.com", subject: `user:${uid(1)}` });
  assert.deepEqual(memberView(userTuple("eng", 9), emails), { kind: "user", label: `user:${uid(9)}`, subject: `user:${uid(9)}` });
  assert.deepEqual(memberView(groupTuple("eng", "design"), emails), { kind: "group", label: "design", subject: "group:design" });
});

test("buildGroupsListModel filters by search, sorts, paginates; the name links to the detail page", () => {
  const groups = Array.from({ length: 30 }, (_, i) => ({ memberCount: i + 1, name: `team-${String(i).padStart(2, "0")}` }));

  const all = buildGroupsListModel({ groups, url: "http://x/admin/groups" });
  assert.equal(all.pagination.summary.total, 30);
  assert.equal(all.table.rows.length, 25); // default page size
  assert.equal(all.shell.title, "Groups");
  // The group name is the row header, linking to its detail page.
  const first = all.table.rows[0]!.cells[0] as { rowHeader: { href: string; text: string } };
  assert.equal(first.rowHeader.text, "team-00");
  assert.equal(first.rowHeader.href, "/admin/groups/team-00");

  // Search narrows + shows a pill.
  const one = buildGroupsListModel({ groups, url: "http://x/admin/groups?q=team-07" });
  assert.equal(one.pagination.summary.total, 1);
  assert.deepEqual(one.filterBar.pills.map((p) => p.label), ["Search"]);

  // Sort by members descending puts the biggest group first.
  const desc = buildGroupsListModel({ groups, url: "http://x/admin/groups?sort=-members" });
  assert.equal((desc.table.rows[0]!.cells[0] as { rowHeader: { text: string } }).rowHeader.text, "team-29");
});

test("buildGroupFormModel: a create form with a required name field + member options, no group of its own", () => {
  const options = [{ label: "ada@example.com", value: `user:${uid(1)}` }, { label: "eng (group)", value: "group:eng" }];
  const m = buildGroupFormModel({ csrfToken: "tok.sig", memberOptions: options });
  assert.equal(m.shell.title, "New group");
  assert.equal(m.form.action, "/admin/groups");
  assert.equal(m.form.submitLabel, "Create group");
  assert.equal(m.form.csrfToken, "tok.sig");
  assert.equal(m.form.nameField.name, "name");
  assert.equal(m.form.nameField.required, true);
  assert.deepEqual(m.form.memberOptions, options);

  // An error (e.g. a taken/invalid name) re-renders with the submitted values.
  const err = buildGroupFormModel({ error: "That name is taken.", memberOptions: options, values: { member: "group:eng", name: "Eng" } });
  assert.equal(err.error, "That name is taken.");
  assert.equal(err.form.nameField.value, "Eng");
  assert.equal(err.form.selectedMember, "group:eng");
});

test("buildGroupDetailModel: members → rows, add-options exclude current members + the group itself, delete/remove wired", () => {
  const members = [memberView(userTuple("eng", 1), new Map([[uid(1), "ada@example.com"]])), memberView(groupTuple("eng", "design"), new Map())];
  const candidates = [
    { label: "ada@example.com", value: `user:${uid(1)}` }, // already a member → excluded
    { label: "grace@example.com", value: `user:${uid(2)}` },
    { label: "design (group)", value: "group:design" }, // already a member → excluded
    { label: "eng (group)", value: "group:eng" }, // the group itself → excluded
    { label: "ops (group)", value: "group:ops" },
  ];
  const m = buildGroupDetailModel({ candidates, group: { name: "eng" }, members });
  assert.equal(m.shell.title, "eng");
  assert.equal(m.members.rows.length, 2);
  assert.equal(m.members.action, "/admin/groups/eng/members/delete");
  assert.equal(m.add.action, "/admin/groups/eng/members");
  assert.deepEqual(m.add.options.map((o) => o.value), [`user:${uid(2)}`, "group:ops"]);
  assert.equal(m.delete.action, "/admin/groups/eng/delete");
});
