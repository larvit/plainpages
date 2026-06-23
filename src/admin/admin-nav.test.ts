// Direct units for the admin section's pure nav + auth helpers. They're security-critical
// (requireAdmin/guardedForm gate every admin write) and reused across all four admin screens, so pin
// the contract here in isolation — the admin-*.test.ts HTTP tests exercise them only end-to-end.
import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { test } from "node:test";
import {
  ADMIN_PERMISSION, ADMIN_USERS_BASE, adminSection, buildConfirmModel, guardedForm, requireAdmin,
} from "./admin-nav.ts";
import { buildContext, type RequestContext, type User } from "../http/context.ts";
import { CSRF_COOKIE, CSRF_FIELD, issueCsrfToken } from "../auth/csrf.ts";
import { GuardError } from "../auth/guards.ts";
import { DEFAULT_MENU } from "../ui/menu-config.ts";

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

// (The in-screen admin sidebar is gone in — every page renders the one global menu, built by
// buildPluginChrome; see chrome.test.ts. adminSection above is that menu's gated Admin fragment.)

// ---- auth gates ----

test("requireAdmin: anonymous → 401→/login, signed-in non-admin → 403, admin → the user", () => {
  assert.throws(() => requireAdmin(reqCtx({ user: null })), (e: unknown) => e instanceof GuardError && e.status === 401 && e.location === "/login?return_to=%2Fadmin%2Fusers"); // anonymous bounce remembers the page
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

test("buildConfirmModel wires the danger action, message, passed-in nav and shell", () => {
  const nav = [{ label: "Dashboard" }, { label: "Admin" }];
  const model = buildConfirmModel({
    breadcrumbs: [{ href: ADMIN_USERS_BASE, label: "Users" }, { label: "Delete" }],
    cancelHref: ADMIN_USERS_BASE, confirmAction: `${ADMIN_USERS_BASE}/u1/delete`, confirmLabel: "Delete user",
    csrfToken: "tok", menu: DEFAULT_MENU, message: "Delete ada@x.io?", nav, title: "Delete user", user: admin,
  });
  assert.deepEqual(model.confirm, { action: `${ADMIN_USERS_BASE}/u1/delete`, label: "Delete user" });
  assert.equal(model.message, "Delete ada@x.io?");
  assert.equal(model.cancelHref, ADMIN_USERS_BASE);
  assert.equal(model.nav, nav); // the host's one global menu, passed through verbatim
  assert.equal(model.shell.title, "Delete user");
});
