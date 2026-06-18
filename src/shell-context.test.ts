import assert from "node:assert/strict";
import { test } from "node:test";
import { buildShellContext, shellUser } from "./shell-context.ts";

test("shellUser derives the profile from the real user; anonymous → Guest", () => {
  assert.deepEqual(shellUser(null), { email: "", initials: "G", name: "Guest" });
  // Real user: name = email, initials = first two letters of the local part, upper-cased.
  assert.deepEqual(shellUser({ email: "ada@example.com", id: "u1", roles: [] }), { email: "", initials: "AD", name: "ada@example.com" });
});

test("buildShellContext maps branding + breadcrumbs, omitting unset optional fields", () => {
  const bare = buildShellContext({ menu: { branding: { name: "Plainpages" }, override: {} }, title: "Users" });
  assert.deepEqual(bare.brand, { name: "Plainpages" }); // no logo/sub when unset
  assert.equal(bare.theme, undefined);
  assert.equal(bare.csrfToken, "");
  assert.equal(bare.user.name, "Guest");

  const full = buildShellContext({
    breadcrumbs: [{ href: "/", label: "Home" }, { label: "Users" }],
    csrfToken: "tok.sig",
    menu: { branding: { logo: "/l.svg", name: "Acme", sub: "Ops", theme: "dark" }, override: {} },
    title: "Users",
    user: { email: "a@b.c", id: "u1", roles: ["admin"] },
  });
  assert.deepEqual(full.brand, { logo: "/l.svg", name: "Acme", sub: "Ops" });
  assert.equal(full.theme, "dark");
  assert.equal(full.csrfToken, "tok.sig");
  assert.equal(full.breadcrumbs?.length, 2);
});
