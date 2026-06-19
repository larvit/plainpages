// Direct units for the admin section's pure nav + auth helpers (todo §8). They're security-critical
// (requireAdmin/guardedForm gate every admin write) and reused across all four admin screens, so pin
// the contract here in isolation — the admin-*.test.ts HTTP tests exercise them only end-to-end.
import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { test } from "node:test";
import {
  ADMIN_PERMISSION, ADMIN_USERS_BASE, adminNav, adminSection, buildConfirmModel, guardedForm, requireAdmin,
} from "./admin-nav.ts";
import { buildContext, type RequestContext, type User } from "./context.ts";
import { CSRF_COOKIE, CSRF_FIELD, issueCsrfToken } from "./csrf.ts";
import { GuardError } from "./guards.ts";
import { DEFAULT_MENU } from "./menu-config.ts";

const admin: User = { email: "ada@x.io", id: "u1", roles: ["admin"] };
const member: User = { email: "bo@x.io", id: "u2", roles: ["scheduling:read"] };

function reqCtx(opts: { body?: string; cookie?: string; method?: string; user?: User | null } = {}): RequestContext {
  const req = new IncomingMessage(new Socket());
  req.method = opts.method ?? "GET";
  req.url = "/admin/users";
  if (opts.cookie) req.headers.cookie = opts.cookie;
  req.push(opts.body ?? null);
  if (opts.body != null) req.push(null);
  return buildContext(req, new ServerResponse(req), { user: opts.user ?? null });
}

const labels = (nodes: { label: string }[]): string[] => nodes.map((n) => n.label);

// ---- nav helpers ----

test("adminSection: gated Admin header over the four screens; current marks the item + opens the header", () => {
  const plain = adminSection();
  assert.equal(plain.id, "admin");
  assert.equal(plain.permission, ADMIN_PERMISSION); // gate on the header ⇒ composeNav drops the whole subtree for a non-admin
  assert.equal(plain.open, undefined);
  assert.deepEqual(plain.children?.map((c) => c.href), ["/admin/users", "/admin/groups", "/admin/roles", "/admin/clients"]);
  assert.deepEqual(labels(plain.children ?? []), ["Users", "Groups", "Roles", "OAuth2 clients"]);
  assert.ok(plain.children?.every((c) => c.current === undefined)); // nothing active

  const onRoles = adminSection("roles");
  assert.equal(onRoles.open, true);
  assert.equal(onRoles.children?.find((c) => c.id === "roles")?.current, true);
  assert.equal(onRoles.children?.find((c) => c.id === "users")?.current, undefined);
});

test("adminNav: prepends Dashboard and role-filters the section (admin sees it, others get only Dashboard)", () => {
  const forAdmin = adminNav(admin.roles, DEFAULT_MENU, "users");
  assert.deepEqual(labels(forAdmin), ["Dashboard", "Admin"]);
  // composeNav strips `id` from rendered nodes but keeps `current`/`href`, so match the active item by href.
  assert.equal(forAdmin.find((n) => n.label === "Admin")!.children?.find((c) => c.href === ADMIN_USERS_BASE)?.current, true);

  assert.deepEqual(labels(adminNav(member.roles, DEFAULT_MENU, "users")), ["Dashboard"]); // non-admin → gated section dropped
  assert.deepEqual(labels(adminNav([], DEFAULT_MENU, "users")), ["Dashboard"]); // anonymous too
});

// ---- auth gates ----

test("requireAdmin: anonymous → 401→/login, signed-in non-admin → 403, admin → the user", () => {
  assert.throws(() => requireAdmin(reqCtx({ user: null })), (e: unknown) => e instanceof GuardError && e.status === 401 && e.location === "/login");
  assert.throws(() => requireAdmin(reqCtx({ user: member })), (e: unknown) => e instanceof GuardError && e.status === 403);
  assert.equal(requireAdmin(reqCtx({ user: admin })), admin);
});

test("guardedForm: valid double-submit → the parsed body, bad/missing token → 403, non-POST → undefined", async () => {
  const secret = "test-secret";
  const token = issueCsrfToken(secret);
  const post = (over: { body?: string; cookie?: string }) => reqCtx({ method: "POST", ...over });

  // cookie token === submitted field, both a genuine signature → the form is returned
  const ok = await guardedForm(post({ body: `${CSRF_FIELD}=${encodeURIComponent(token)}&name=Bo`, cookie: `${CSRF_COOKIE}=${token}` }), secret);
  assert.equal(ok?.get("name"), "Bo");

  await assert.rejects(guardedForm(post({ body: `${CSRF_FIELD}=${encodeURIComponent(token)}` }), secret), // no cookie
    (e: unknown) => e instanceof GuardError && e.status === 403);
  await assert.rejects(guardedForm(post({ body: `${CSRF_FIELD}=nope`, cookie: `${CSRF_COOKIE}=${token}` }), secret), // field ≠ cookie
    (e: unknown) => e instanceof GuardError && e.status === 403);

  assert.equal(await guardedForm(reqCtx({ method: "GET" }), secret), undefined); // not a mutation → no gate, no body read
});

// ---- confirm-page model ----

test("buildConfirmModel wires the danger action, message, role-filtered nav and shell", () => {
  const model = buildConfirmModel({
    breadcrumbs: [{ href: ADMIN_USERS_BASE, label: "Users" }, { label: "Delete" }],
    cancelHref: ADMIN_USERS_BASE, confirmAction: `${ADMIN_USERS_BASE}/u1/delete`, confirmLabel: "Delete user",
    csrfToken: "tok", current: "users", menu: DEFAULT_MENU, message: "Delete ada@x.io?", title: "Delete user", user: admin,
  });
  assert.deepEqual(model.confirm, { action: `${ADMIN_USERS_BASE}/u1/delete`, label: "Delete user" });
  assert.equal(model.message, "Delete ada@x.io?");
  assert.equal(model.cancelHref, ADMIN_USERS_BASE);
  assert.ok(labels(model.nav).includes("Admin")); // admin user ⇒ section present in the in-screen sidebar
  assert.equal(model.shell.title, "Delete user");
});
