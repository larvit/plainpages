// Direct units for the admin plugin's shared nav + auth helpers. They're security-critical
// (requirePermission/guardedForm gate every admin write) and reused across all four screens, so pin the
// contract here in isolation; the HTTP routing/gate/CSRF is exercised end-to-end in src/http/app.test.ts.
// Import only from the #plugin-api barrel — the same contract boundary the plugin code uses.
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { GuardError, isValidPermissionName, type Log, type PageChrome, type RequestContext, type User } from "#plugin-api";
import { ADMIN_EN, ADMIN_NAV, ADMIN_USERS_BASE, actionForMethod, buildConfirmModel, guardedForm, permissionName, requirePermission } from "./admin-shared.ts";

const reader: User = { email: "ada@x.io", id: "u1", permissions: ["users:read"] };
const writer: User = { email: "cy@x.io", id: "u3", permissions: ["users:read", "users:write"] };
const member: User = { email: "bo@x.io", id: "u2", permissions: ["scheduling:read"] };
const CHROME = { brand: { name: "Test" }, csrfToken: "tok", nav: [], signInHref: "/login", user: { email: "", initials: "T", name: "Tester" } } as PageChrome;

function fakeCtx(opts: { body?: string; method?: string; user?: User | null; verifyCsrf?: (s: string | null | undefined) => boolean } = {}): RequestContext {
  const url = new URL("http://localhost/admin/users");
  const req = Readable.from(opts.body != null ? [Buffer.from(opts.body)] : []) as unknown as IncomingMessage;
  req.method = opts.method ?? "GET";
  return {
    chrome: CHROME, declaredPermissions: [], user: opts.user ?? null, locale: "en-US", localeHref: (href) => href, locales: ["en-US"], log: {} as Log, params: {},
    query: url.searchParams, req, res: {} as ServerResponse, permissions: opts.user?.permissions ?? [], t: ADMIN_EN, url,
    verifyCsrf: opts.verifyCsrf ?? (() => true),
  };
}

// ---- nav fragment ----

test("ADMIN_NAV: an ungated Admin header whose three screens each gate on their own read permission", () => {
  assert.equal(ADMIN_NAV.id, "admin");
  // No gate on the header: a user may hold one screen's permission and not another's. composeNav
  // drops a header left with no visible children, so holding none of the four hides the section.
  // Both halves matter — give the header an `href` and it survives the filter as a visible leaf,
  // ungated, for anonymous visitors included.
  assert.equal(ADMIN_NAV.permission, undefined);
  assert.equal(ADMIN_NAV.href, undefined);
  assert.equal(ADMIN_NAV.open, undefined); // the host current-marks + opens; the fragment stays static
  assert.deepEqual(ADMIN_NAV.children?.map((c) => c.href), ["/admin/users", "/admin/groups", "/admin/clients"]);
  assert.deepEqual(ADMIN_NAV.children?.map((c) => c.permission), ["users:read", "groups:read", "oauth2-clients:read"]);
  // Labels are catalog keys; the host translates them with this plugin's catalog when it composes
  // the menu, so what a visitor sees is the en-US (or sv-SE …) wording behind these keys.
  assert.deepEqual(ADMIN_NAV.children?.map((c) => c.label), ["admin.nav.users", "admin.nav.groups", "admin.nav.clients"]);
  assert.deepEqual(ADMIN_NAV.children?.map((c) => ADMIN_EN(c.label)), ["Users", "Groups", "OAuth2 clients"]);
  assert.ok(ADMIN_NAV.children?.every((c) => c.current === undefined));
});

// ---- permission naming ----

test("permissionName builds <resource>:<action>, and the host agrees the result is well-formed", () => {
  assert.equal(permissionName("users", "read"), "users:read");
  assert.equal(permissionName("oauth2-clients", "write"), "oauth2-clients:write");
  assert.ok(isValidPermissionName(permissionName("oauth2-clients", "write"))); // the rule discovery enforces
});

test("actionForMethod: read for GET/HEAD, write for every mutation", () => {
  assert.equal(actionForMethod("GET"), "read");
  assert.equal(actionForMethod("HEAD"), "read"); // a GET route also answers HEAD
  assert.equal(actionForMethod("POST"), "write");
  assert.equal(actionForMethod("DELETE"), "write"); // anything that isn't a read is a write
  assert.equal(actionForMethod("get"), "read"); // method case is the caller's
});

// ---- auth gates ----

test("requirePermission: anonymous → 401→/login, wrong permission → 403, and read never grants write", () => {
  assert.throws(() => requirePermission(fakeCtx({ user: null }), "users"), (e: unknown) => e instanceof GuardError && e.status === 401 && e.location === "/login?return_to=%2Fadmin%2Fusers"); // bounce remembers the page
  assert.throws(() => requirePermission(fakeCtx({ user: member }), "users"), (e: unknown) => e instanceof GuardError && e.status === 403);
  assert.equal(requirePermission(fakeCtx({ user: reader }), "users"), reader);
  // The whole point of the split: users:read opens the list but not the create/delete POSTs.
  assert.throws(() => requirePermission(fakeCtx({ method: "POST", user: reader }), "users"), (e: unknown) => e instanceof GuardError && e.status === 403);
  assert.equal(requirePermission(fakeCtx({ method: "POST", user: writer }), "users"), writer);
  // Resources don't leak into each other: a users holder is not a groups holder.
  assert.throws(() => requirePermission(fakeCtx({ user: writer }), "groups"), (e: unknown) => e instanceof GuardError && e.status === 403);
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
