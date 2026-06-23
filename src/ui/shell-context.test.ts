import assert from "node:assert/strict";
import { test } from "node:test";
import { buildShellContext, shellUser } from "./shell-context.ts";

test("shellUser derives the profile from the real user; anonymous → Guest", () => {
  assert.deepEqual(shellUser(null), { email: "", initials: "G", name: "Guest" });
  // Real user: name = email local part, email kept, initials = first two letters of the local part.
  assert.deepEqual(shellUser({ email: "ada@example.com", id: "u1", roles: [] }), { email: "ada@example.com", initials: "AD", name: "ada" });
});

test("buildShellContext maps branding + breadcrumbs, omitting unset optional fields", () => {
  const bare = buildShellContext({ menu: { branding: { name: "Plainpages" }, override: {} }, title: "Users" });
  assert.deepEqual(bare.brand, { name: "Plainpages" }); // no logo/sub when unset
  assert.equal(bare.theme, undefined);
  assert.equal(bare.csrfToken, "");
  assert.equal(bare.user.name, "Guest");
  assert.equal(bare.signInHref, undefined); // omitted unless supplied (a public built-in screen would set it)

  const full = buildShellContext({
    breadcrumbs: [{ href: "/", label: "Home" }, { label: "Users" }],
    csrfToken: "tok.sig",
    menu: { branding: { logo: "/l.svg", name: "Acme", sub: "Ops", theme: "dark" }, override: {} },
    signInHref: "/login?return_to=%2Fx",
    title: "Users",
    user: { email: "a@b.c", id: "u1", roles: ["admin"] },
  });
  assert.deepEqual(full.brand, { logo: "/l.svg", name: "Acme", sub: "Ops" });
  assert.equal(full.theme, "dark");
  assert.equal(full.csrfToken, "tok.sig");
  assert.equal(full.breadcrumbs?.length, 2);
  assert.equal(full.signInHref, "/login?return_to=%2Fx");
});
