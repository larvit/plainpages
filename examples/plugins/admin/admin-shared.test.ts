// Direct units for the admin plugin's shared nav + auth helpers. They're security-critical
// (requireAdmin/guardedForm gate every admin write) and reused across all four screens, so pin the
// contract here in isolation; the HTTP routing/gate/CSRF is exercised end-to-end in src/http/app.test.ts.
// Import only from the #plugin-api barrel — the same contract boundary the plugin code uses.
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { GuardError, type Log, type PageChrome, type RequestContext, type User } from "#plugin-api";
import { ADMIN_NAV, ADMIN_PERMISSION, ADMIN_USERS_BASE, buildConfirmModel, guardedForm, requireAdmin } from "./admin-shared.ts";

const admin: User = { email: "ada@x.io", id: "u1", roles: ["admin"] };
const member: User = { email: "bo@x.io", id: "u2", roles: ["scheduling:read"] };
const CHROME = { brand: { name: "Test" }, csrfToken: "tok", nav: [], signInHref: "/login", user: { email: "", initials: "T", name: "Tester" } } as PageChrome;

function fakeCtx(opts: { body?: string; method?: string; user?: User | null; verifyCsrf?: (s: string | null | undefined) => boolean } = {}): RequestContext {
  const url = new URL("http://localhost/admin/users");
  const req = Readable.from(opts.body != null ? [Buffer.from(opts.body)] : []) as unknown as IncomingMessage;
  req.method = opts.method ?? "GET";
  return {
    chrome: CHROME, log: {} as Log, params: {}, query: url.searchParams, req, res: {} as ServerResponse,
    roles: opts.user?.roles ?? [], url, user: opts.user ?? null, verifyCsrf: opts.verifyCsrf ?? (() => true),
  };
}

// ---- nav fragment ----

test("ADMIN_NAV: a gated Admin header over the four screens; no per-request current/open state", () => {
  assert.equal(ADMIN_NAV.id, "admin");
  assert.equal(ADMIN_NAV.permission, ADMIN_PERMISSION); // gate on the header ⇒ composeNav drops the whole subtree for a non-admin
  assert.equal(ADMIN_NAV.open, undefined); // the host current-marks + opens; the fragment stays static
  assert.deepEqual(ADMIN_NAV.children?.map((c) => c.href), ["/admin/users", "/admin/groups", "/admin/roles", "/admin/clients"]);
  assert.deepEqual(ADMIN_NAV.children?.map((c) => c.label), ["Users", "Groups", "Roles", "OAuth2 clients"]);
  assert.ok(ADMIN_NAV.children?.every((c) => c.current === undefined && c.permission === undefined)); // the header's gate covers the subtree
});

// ---- auth gates ----

test("requireAdmin: anonymous → 401→/login, signed-in non-admin → 403, admin → the user", () => {
  assert.throws(() => requireAdmin(fakeCtx({ user: null })), (e: unknown) => e instanceof GuardError && e.status === 401 && e.location === "/login?return_to=%2Fadmin%2Fusers"); // bounce remembers the page
  assert.throws(() => requireAdmin(fakeCtx({ user: member })), (e: unknown) => e instanceof GuardError && e.status === 403);
  assert.equal(requireAdmin(fakeCtx({ user: admin })), admin);
});

test("guardedForm: valid double-submit → the parsed body, bad token → 403, non-POST → undefined", async () => {
  const post = (over: { body?: string; verifyCsrf?: (s: string | null | undefined) => boolean }) => fakeCtx({ method: "POST", ...over });

  const ok = await guardedForm(post({ body: "_csrf=tok&name=Bo", verifyCsrf: () => true }));
  assert.equal(ok?.get("name"), "Bo");

  await assert.rejects(guardedForm(post({ body: "_csrf=nope&name=Bo", verifyCsrf: () => false })), // ctx.verifyCsrf rejects
    (e: unknown) => e instanceof GuardError && e.status === 403);

  assert.equal(await guardedForm(fakeCtx({ method: "GET" })), undefined); // not a mutation → no gate, no body read
});

// ---- confirm-page model ----

test("buildConfirmModel wires the danger action, message, breadcrumbs and title (shell comes from ctx.chrome)", () => {
  const model = buildConfirmModel({
    breadcrumbs: [{ href: ADMIN_USERS_BASE, label: "Users" }, { label: "Delete" }],
    cancelHref: ADMIN_USERS_BASE, confirmAction: `${ADMIN_USERS_BASE}/u1/delete`, confirmLabel: "Delete user",
    message: "Delete ada@x.io?", title: "Delete user",
  });
  assert.deepEqual(model.confirm, { action: `${ADMIN_USERS_BASE}/u1/delete`, label: "Delete user" });
  assert.equal(model.message, "Delete ada@x.io?");
  assert.equal(model.cancelHref, ADMIN_USERS_BASE);
  assert.equal(model.title, "Delete user");
  assert.deepEqual(model.breadcrumbs.at(-1), { label: "Delete" });
});
