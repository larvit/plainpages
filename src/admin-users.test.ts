// Built-in Users admin screen (§5): the pure view-model + Kratos-payload builders. The HTTP
// routing/gate/CSRF + live Kratos calls are exercised over HTTP in app.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildUserFormModel,
  buildUsersListModel,
  createIdentityPayload,
  setStatePayload,
  toUserView,
  updateIdentityPayload,
} from "./admin-users.ts";
import type { Identity } from "./kratos-admin.ts";

const id = (n: number) => `01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b${String(n).padStart(2, "0")}`;
const identity = (n: number, over: Partial<Identity> = {}): Identity => ({
  id: id(n),
  schema_id: "default",
  state: "active",
  traits: { email: `user${n}@example.com`, name: { first: `First${n}`, last: `Last${n}` } },
  ...over,
});

test("toUserView maps traits → name/initials/email/state; falls back to the email local part", () => {
  const named = toUserView(identity(1));
  assert.equal(named.name, "First1 Last1");
  assert.equal(named.initials, "FL");
  assert.equal(named.email, "user1@example.com");
  assert.equal(named.state, "active");

  // No name trait → derive from the email local part.
  const bare = toUserView({ id: id(2), state: "inactive", traits: { email: "ada.lovelace@example.com" } });
  assert.equal(bare.name, "ada.lovelace");
  assert.equal(bare.initials, "AD");
  assert.equal(bare.state, "inactive");
});

test("buildUsersListModel filters by search + status, sorts, and paginates", () => {
  const people = Array.from({ length: 30 }, (_, i) => identity(i + 1, { state: i % 2 ? "inactive" : "active" }));

  const all = buildUsersListModel({ identities: people, url: "http://x/admin/users" });
  assert.equal(all.pagination.summary.total, 30);
  assert.equal(all.table.rows.length, 25); // default page size
  assert.equal(all.shell.title, "Users");

  // Search narrows to one and shows a pill.
  const one = buildUsersListModel({ identities: people, url: "http://x/admin/users?q=user7%40example.com" });
  assert.equal(one.pagination.summary.total, 1);
  assert.deepEqual(one.filterBar.pills.map((p) => p.label), ["Search"]);

  // Status filter keeps only inactive identities.
  const inactive = buildUsersListModel({ identities: people, url: "http://x/admin/users?status=inactive" });
  assert.equal(inactive.pagination.summary.total, 15);
  assert.deepEqual(inactive.filterBar.pills.map((p) => p.label), ["Status"]);

  // Sort by email descending reverses the order.
  const emailOf = (m: ReturnType<typeof buildUsersListModel>, i: number) => (m.table.rows[i]!.cells[1]) as string;
  const desc = buildUsersListModel({ identities: people, url: "http://x/admin/users?sort=-email" });
  assert.ok(emailOf(desc, 0) > emailOf(desc, 1));

  // Edit link points at the per-identity route.
  assert.match(all.table.rows[0]!.actions![0]!.href!, new RegExp(`/admin/users/${people[0]!.id}$`));
});

test("buildUserFormModel: create mode has an editable email + password, no edit actions", () => {
  const m = buildUserFormModel({ csrfToken: "tok.sig" });
  assert.equal(m.shell.title, "New user");
  assert.equal(m.form.action, "/admin/users");
  assert.equal(m.form.submitLabel, "Create user");
  assert.equal(m.form.csrfToken, "tok.sig");
  const names = m.form.fields.map((f) => f.name);
  assert.deepEqual(names, ["email", "first", "last", "password"]);
  assert.equal(m.form.fields.find((f) => f.name === "email")!.readonly, undefined); // editable on create
  assert.equal(m.edit, undefined);
});

test("buildUserFormModel: edit mode prefills, locks email, and exposes state/delete/recovery actions", () => {
  const m = buildUserFormModel({ identity: identity(3) });
  assert.equal(m.shell.title, "Edit user");
  assert.equal(m.form.action, `/admin/users/${id(3)}`);
  assert.equal(m.form.submitLabel, "Save changes");
  const email = m.form.fields.find((f) => f.name === "email")!;
  assert.equal(email.value, "user3@example.com");
  assert.equal(email.readonly, true);
  assert.ok(!m.form.fields.some((f) => f.name === "password")); // no password field when editing
  assert.equal(m.form.fields.find((f) => f.name === "first")!.value, "First3");
  assert.equal(m.edit!.nextLabel, "Deactivate"); // active → offers Deactivate
  assert.match(m.edit!.deleteAction, /\/delete$/);
  assert.match(m.edit!.recoveryAction, /\/recovery$/);

  // An inactive identity offers Reactivate.
  assert.equal(buildUserFormModel({ identity: identity(4, { state: "inactive" }) }).edit!.nextLabel, "Reactivate");
});

test("createIdentityPayload: schema/state/traits, name only when given, password only when set", () => {
  assert.deepEqual(createIdentityPayload({ email: "a@b.c", first: "Ada", last: "Lovelace", password: "" }), {
    schema_id: "default",
    state: "active",
    traits: { email: "a@b.c", name: { first: "Ada", last: "Lovelace" } },
  });
  // No name parts → omit the name trait; a password → credentials.
  assert.deepEqual(createIdentityPayload({ email: "a@b.c", first: "", last: "", password: "s3cret" }), {
    credentials: { password: { config: { password: "s3cret" } } },
    schema_id: "default",
    state: "active",
    traits: { email: "a@b.c" },
  });
});

test("updateIdentityPayload preserves email/schema/state and rewrites the name; setStatePayload flips state", () => {
  const existing = identity(5);
  assert.deepEqual(updateIdentityPayload(existing, { email: "ignored@x", first: "New", last: "Name", password: "" }), {
    schema_id: "default",
    state: "active",
    traits: { email: "user5@example.com", name: { first: "New", last: "Name" } }, // email kept, not the submitted one
  });
  // Clearing both name parts drops the name trait.
  assert.deepEqual(updateIdentityPayload(existing, { email: "", first: "", last: "", password: "" }).traits, { email: "user5@example.com" });

  assert.deepEqual(setStatePayload(existing, "inactive"), {
    schema_id: "default",
    state: "inactive",
    traits: { email: "user5@example.com", name: { first: "First5", last: "Last5" } },
  });
});
