import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp, type AppOptions } from "./app.ts";
import { createDenylist } from "../auth/denylist.ts";
import { CSRF_COOKIE, issueCsrfToken } from "../auth/csrf.ts";
import { staticJwks } from "../auth/jwks.ts";
import type { OAuth2Client } from "../auth/hydra-admin.ts";
import type { RelationTuple } from "../auth/keto-client.ts";
import type { Identity } from "../auth/kratos-admin.ts";
import { SESSION_COOKIE } from "../auth/login.ts";
import type { Plugin } from "../plugin-host/plugin.ts";
import adminManifest from "../../examples/plugins/admin/plugin.ts";
import { createI18n } from "../i18n/runtime.ts";
import { loadI18n } from "../i18n/load.ts";
import { ecJwk, fakeKeto, matchesTuple, mintJwt, stubAdmin, stubHydra } from "./app-harness.ts";

// The HTTP-level admin tests mount the example plugin via createApp — stub Ory clients on
// ctx.system, views from examples/plugins — exactly as an operator would after copying it in.
const examplesPluginsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "examples", "plugins");
const adminPlugin: Plugin = { ...adminManifest, id: "admin" };

// Shared harness for the admin-screen HTTP tests: an app on a random port with an admin JWT +
// CSRF cookie. get(path, permissions)/post(path, body) carry them; `token` is the matching CSRF field.
const ADMIN_CSRF = "admin-secret";
async function adminHarness(t: TestContext, opts: AppOptions = {}, sub = "admin1") {
  // Mount the plugin's catalogs the way server.ts does, so its screens render words, not keys.
  const i18n = createI18n(await loadI18n({ pluginIds: [adminPlugin.id], pluginsDir: examplesPluginsDir }));
  const app = createApp({ csrfSecret: ADMIN_CSRF, i18n, jwks: staticJwks([ecJwk]), pluginsDir: examplesPluginsDir, plugins: [adminPlugin], ...opts });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  const url = `http://localhost:${(app.address() as AddressInfo).port}`;
  const token = issueCsrfToken(ADMIN_CSRF);
  const nowSec = Math.floor(Date.now() / 1000);
  const cookie = (permissions: string[]) => `${SESSION_COOKIE}=${mintJwt({ email: "admin@x", exp: nowSec + 600, permissions, sub })}; ${CSRF_COOKIE}=${token}`;
  const get = (path: string, permissions: string[] = ADMIN_ALL) => fetch(url + path, { headers: { cookie: cookie(permissions) }, redirect: "manual" });
  const post = (path: string, body: string) =>
    fetch(url + path, { body, headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie(ADMIN_ALL) }, method: "POST", redirect: "manual" });
  return { get, post, token, url };
}
// What the plugin itself declares — the harness holds every screen's read and write, so a screen
// test exercises the screen rather than the gate. assertAdminGate covers the refusals.
const ADMIN_ALL = (adminManifest.permissions ?? []).map((p) => p.name);
// The permission form's concurrency token, read off the page the way a browser would post it back.
const baselineOf = (html: string): string => /name="baseline" value="([0-9a-f]+)"/.exec(html)?.[1] ?? "";
// Every admin route is gated: anonymous → /login, a signed-in non-admin → 403.
async function assertAdminGate(url: string, get: (path: string, permissions?: string[]) => Promise<Response>, path: string) {
  const anon = await fetch(url + path, { redirect: "manual" });
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.get("location"), `/login?return_to=${encodeURIComponent(path)}`); // remembers the page
  assert.equal((await get(path, [])).status, 403);
}


// Built-in Users admin screen: gate + every CRUD action over HTTP against a mock Kratos admin.
test("admin Users screen: gate, list/filter, create, edit, deactivate, delete, recovery (CSRF-guarded)", async (t) => {
  const mk = (email: string, over: Partial<Identity> = {}): Identity =>
    ({ id: randomUUID(), schema_id: "default", state: "active", traits: { email, name: { first: "Ada", last: "Lovelace" } }, ...over });
  const store: Identity[] = [mk("ada@example.com"), mk("babbage@example.com", { state: "inactive" }), mk("you@example.com", { id: "admin1" })];
  let lastCreate: { traits?: unknown } | undefined;
  const kratosAdmin = stubAdmin({
    createIdentity: async (payload) => { lastCreate = payload as { traits?: unknown }; const created = mk("grace@example.com"); store.push(created); return created; },
    createRecoveryCode: async (id) => ({ code: "123456", link: `http://kratos/self-service/recovery?code=123456&id=${id}` }),
    deleteIdentity: async (id) => { const i = store.findIndex((x) => x.id === id); if (i >= 0) store.splice(i, 1); },
    getIdentity: async (id) => store.find((x) => x.id === id) ?? null,
    listIdentities: async () => ({ identities: store, nextPageToken: null }),
    updateIdentity: async (id, payload) => { const it = store.find((x) => x.id === id)!; Object.assign(it, payload); return it; },
  });
  const denylist = createDenylist(); // a deactivate/delete should revoke the target's live tokens instantly
  const { get, post, token, url } = await adminHarness(t, { denylist, kratosAdmin });

  await assertAdminGate(url, get, "/admin/users");

  // Nav: the admin plugin's section composes into the one global menu, and each screen is filtered
  // by its own read permission — proving the drop-in nav fragment. A user holding only users:read
  // sees Users and nothing else; holding none of the three, composeNav drops the emptied header.
  assert.match(await (await get("/dashboard")).text(), /href="\/admin\/users"/);
  const usersOnlyNav = await (await get("/dashboard", ["users:read"])).text();
  assert.match(usersOnlyNav, /href="\/admin\/users"/);
  assert.doesNotMatch(usersOnlyNav, /href="\/admin\/groups"/);
  assert.doesNotMatch(await (await get("/dashboard", ["scheduling:read"])).text(), /href="\/admin\/users"/);

  // The read/write split: users:read opens the list but is refused on every mutation, and the
  // resources don't leak — a users holder is not a groups holder.
  assert.equal((await get("/admin/users", ["users:read"])).status, 200);
  assert.equal((await get("/admin/groups", ["users:read", "users:write"])).status, 403);
  const readOnlyPost = await fetch(url + "/admin/users", {
    body: `_csrf=${token}&email=nope@example.com`,
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${SESSION_COOKIE}=${mintJwt({ email: "r@x", exp: Math.floor(Date.now() / 1000) + 600, permissions: ["users:read"], sub: "reader1" })}; ${CSRF_COOKIE}=${token}` },
    method: "POST",
    redirect: "manual",
  });
  assert.equal(readOnlyPost.status, 403);
  assert.equal(store.some((i) => i.traits?.email === "nope@example.com"), false);

  // List: the admin sees the rows + the "add" link; the status filter narrows server-side.
  const listHtml = await (await get("/admin/users")).text();
  assert.match(listHtml, /ada@example\.com/);
  assert.match(listHtml, /href="\/admin\/users\/new"/);
  assert.doesNotMatch(await (await get("/admin/users?status=inactive")).text(), /ada@example\.com/);

  // Create: the form renders; a valid post creates the identity and redirects to the list.
  assert.match(await (await get("/admin/users/new")).text(), /Create user/);
  const created = await post("/admin/users", `_csrf=${token}&email=grace%40example.com&first=Grace&last=Hopper&password=`);
  assert.equal(created.status, 303);
  assert.equal(created.headers.get("location"), "/admin/users");
  assert.deepEqual(lastCreate?.traits, { email: "grace@example.com", name: { first: "Grace", last: "Hopper" } });

  // A create with no CSRF token is refused and creates nothing.
  const before = store.length;
  assert.equal((await post("/admin/users", "email=x%40y.z")).status, 403);
  assert.equal(store.length, before);

  // CSRF also guards a POST to an *existing* target (the per-route :id handlers), not just the
  // collection: a delete with no token is refused (403) and removes nothing.
  assert.equal((await post(`/admin/users/${store[1]!.id}/delete`, "")).status, 403);
  assert.ok(store.some((x) => x.id === store[1]!.id));

  // Edit: email is read-only + prefilled; a post rewrites the name.
  const target = store[0]!;
  const editHtml = await (await get(`/admin/users/${target.id}`)).text();
  assert.match(editHtml, /name="email"[^>]*readonly/);
  assert.match(editHtml, /value="ada@example\.com"/);
  const updated = await post(`/admin/users/${target.id}`, `_csrf=${token}&first=Ada&last=King`);
  assert.equal(updated.status, 303);
  assert.deepEqual((target.traits as { name: unknown }).name, { first: "Ada", last: "King" });

  // Deactivate (state toggle): active → inactive, and the target's live tokens are revoked at once.
  await post(`/admin/users/${target.id}/state`, `_csrf=${token}`);
  assert.equal(target.state, "inactive");
  assert.equal(denylist.isRevoked(target.id, 0), true);

  // Recovery: renders the edit page (200) showing the generated code (code-based; no admin-host link).
  const rec = await post(`/admin/users/${target.id}/recovery`, `_csrf=${token}`);
  assert.equal(rec.status, 200);
  const recHtml = await rec.text();
  assert.match(recHtml, /Recovery code generated/);
  assert.match(recHtml, /<code>123456<\/code>/);
  assert.doesNotMatch(recHtml, /self-service\/recovery\?code=/); // the unreachable admin-API link is gone

  // Delete needs a deliberate confirm step (zero-JS): GET renders the interstitial, POST performs it.
  const confirm = await (await get(`/admin/users/${target.id}/delete`)).text();
  assert.match(confirm, /Cancel/);
  assert.match(confirm, new RegExp(`action="/admin/users/${target.id}/delete"`));
  const del = await post(`/admin/users/${target.id}/delete`, `_csrf=${token}`);
  assert.equal(del.status, 303);
  assert.ok(!store.some((x) => x.id === target.id));

  // Self-protection: an admin can't delete or deactivate their own account (JWT sub = admin1).
  assert.equal((await post(`/admin/users/admin1/delete`, `_csrf=${token}`)).status, 400);
  assert.ok(store.some((x) => x.id === "admin1"));
  assert.equal((await post(`/admin/users/admin1/state`, `_csrf=${token}`)).status, 400);
  assert.equal(store.find((x) => x.id === "admin1")!.state, "active");

  // Unknown id → 404; malformed %-encoding → 404 (not a 500), matching groups/permissions/clients.
  assert.equal((await get(`/admin/users/${randomUUID()}`)).status, 404);
  assert.equal((await get("/admin/users/%ZZ")).status, 404);
});

// Built-in Groups admin screen: gate + list/create/membership/delete over HTTP against a
// fakeKeto (tuples are the only state) and a stub Kratos admin (resolves member emails).
test("admin Groups screen: gate, list, create, detail/membership, delete (CSRF-guarded)", async (t) => {
  const ada = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b01";
  const grace = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b02";
  const identities: Identity[] = [
    { id: ada, schema_id: "default", state: "active", traits: { email: "ada@example.com" } },
    { id: grace, schema_id: "default", state: "active", traits: { email: "grace@example.com" } },
  ];
  const tuples: RelationTuple[] = [{ namespace: "Group", object: "eng", relation: "members", subject_id: `user:${ada}` }];
  const keto = fakeKeto(tuples);
  const kratosAdmin = stubAdmin({ listIdentities: async () => ({ identities, nextPageToken: null }) });
  const { get, post, token, url } = await adminHarness(t, { keto, kratosAdmin });

  await assertAdminGate(url, get, "/admin/groups");

  // List: the existing group shows + the "add" link.
  const listHtml = await (await get("/admin/groups")).text();
  assert.match(listHtml, /href="\/admin\/groups\/eng"/);
  assert.match(listHtml, /href="\/admin\/groups\/new"/);

  // Create: the form renders; a valid post writes the first-member tuple and redirects to the detail.
  assert.match(await (await get("/admin/groups/new")).text(), /Create group/);
  const created = await post("/admin/groups", `_csrf=${token}&name=design&member=user:${grace}`);
  assert.equal(created.status, 303);
  assert.equal(created.headers.get("location"), "/admin/groups/design");
  assert.ok(tuples.some((tp) => tp.object === "design" && tp.subject_id === `user:${grace}`));

  // An invalid name, a duplicate name, or a missing CSRF token are all refused, nothing written.
  const before = tuples.length;
  assert.equal((await post("/admin/groups", `_csrf=${token}&name=Bad Name&member=user:${grace}`)).status, 400);
  assert.equal((await post("/admin/groups", `_csrf=${token}&name=eng&member=user:${grace}`)).status, 400); // already exists
  assert.equal((await post("/admin/groups", `name=x&member=user:${grace}`)).status, 403);
  assert.equal(tuples.length, before);

  // Detail: lists the current member by email.
  assert.match(await (await get("/admin/groups/eng")).text(), /ada@example\.com/);

  // Add a member, then remove it.
  await post("/admin/groups/eng/members", `_csrf=${token}&member=user:${grace}`);
  assert.ok(tuples.some((tp) => tp.object === "eng" && tp.subject_id === `user:${grace}`));
  await post("/admin/groups/eng/members/delete", `_csrf=${token}&member=user:${grace}`);
  assert.ok(!tuples.some((tp) => tp.object === "eng" && tp.subject_id === `user:${grace}`));

  // Give it a permission first, so the delete below has an orphan to avoid leaving behind.
  const permissionsBaseline = baselineOf(await (await get("/admin/groups/eng")).text());
  await post("/admin/groups/eng/permissions", `_csrf=${token}&baseline=${permissionsBaseline}&permission=users%3Aread`);
  assert.ok(tuples.some((tp) => tp.namespace === "Permission" && tp.object === "users:read" && tp.subject_set?.object === "eng"));

  // Delete the group: a confirm step (GET) then the POST removes every member tuple, back to the list.
  assert.match(await (await get("/admin/groups/eng/delete")).text(), /Cancel/);
  const del = await post("/admin/groups/eng/delete", `_csrf=${token}`);
  assert.equal(del.status, 303);
  assert.equal(del.headers.get("location"), "/admin/groups");
  assert.ok(!tuples.some((tp) => tp.object === "eng"));
  // …and the permissions it held go with it. A Keto set exists only through its tuples, so an
  // orphaned grant would resurrect the moment someone re-created a group with the same name.
  assert.ok(!tuples.some((tp) => tp.namespace === "Permission" && tp.subject_set?.object === "eng"));

  // An invalid group name in the path → 404; malformed %-encoding doesn't 500.
  assert.equal((await get("/admin/groups/Bad%20Name")).status, 404);
  assert.equal((await get("/admin/groups/%ZZ")).status, 404);
});

// Granting permissions over HTTP. The offered set is the host's catalog (ctx.declaredPermissions),
// so the checkboxes are a fixed list and the POST is the desired state.
test("admin permission grants: the picker offers the declared catalog, and a save is the desired set", async (t) => {
  const ada = randomUUID();
  const identities: Identity[] = [{ id: ada, traits: { email: "ada@example.com" } }];
  const tuples: RelationTuple[] = [{ namespace: "Permission", object: "users:read", relation: "granted", subject_id: `user:${ada}` }];
  const keto = fakeKeto(tuples);
  const kratosAdmin = stubAdmin({ getIdentity: async (id) => identities.find((i) => i.id === id) ?? null, listIdentities: async () => ({ identities, nextPageToken: null }) });
  const denylist = createDenylist();
  const { get, post, token } = await adminHarness(t, { denylist, keto, kratosAdmin });

  // The user edit page renders one checkbox per declared permission, ticked where already held.
  const edit = await (await get(`/admin/users/${ada}`)).text();
  for (const name of ["users:read", "users:write", "groups:read", "groups:write", "oauth2-clients:read", "oauth2-clients:write"]) {
    assert.match(edit, new RegExp(`value="${name.replace(":", ":")}"`), name);
  }
  assert.match(edit, /value="users:read"[^>]*checked/); // held → ticked
  assert.doesNotMatch(edit, /value="groups:write"[^>]*checked/); // not held → unticked
  assert.doesNotMatch(edit, /Permissions saved/); // no confirmation before a save

  // Save a new set: users:write is added, users:read is dropped — the POST is the whole truth.
  const baseline = baselineOf(edit);
  const saved = await post(`/admin/users/${ada}/permissions`, `_csrf=${token}&baseline=${baseline}&permission=users%3Awrite&permission=groups%3Aread`);
  assert.equal(saved.status, 303);
  assert.deepEqual(
    tuples.filter((tp) => tp.subject_id === `user:${ada}`).map((tp) => tp.object).sort(),
    ["groups:read", "users:write"],
  );
  assert.equal(denylist.isRevoked(ada, 0), true); // a change to your own grants revokes live tokens

  // The redirect lands on a page that confirms the save, and shows the new state.
  const landing = saved.headers.get("location") ?? "";
  assert.match(landing, new RegExp(`^/admin/users/${ada}\\?info-msg=permissions-saved$`));
  const confirmed = await (await get(landing)).text();
  assert.match(confirmed, /Permissions saved/);
  assert.match(confirmed, /value="users:write"[^>]*checked/);

  // A crafted POST can't grant something no plugin declares.
  await post(`/admin/users/${ada}/permissions`, `_csrf=${token}&baseline=${baselineOf(confirmed)}&permission=users%3Awrite&permission=superuser%3Aall`);
  assert.ok(!tuples.some((tp) => tp.object === "superuser:all"));

  // The same picker on a group writes the group's subject_set, which Keto resolves transitively.
  tuples.push({ namespace: "Group", object: "eng", relation: "members", subject_id: `user:${ada}` });
  const groupBaseline = baselineOf(await (await get("/admin/groups/eng")).text());
  const groupSaved = await post("/admin/groups/eng/permissions", `_csrf=${token}&baseline=${groupBaseline}&permission=groups%3Aread`);
  assert.equal(groupSaved.headers.get("location"), "/admin/groups/eng?info-msg=permissions-saved");
  assert.ok(tuples.some((tp) => tp.namespace === "Permission" && tp.object === "groups:read" && tp.subject_set?.object === "eng"));
});

// Two admins open the same page; the second save would silently undo the first.
test("admin permission grants: a save from a stale page is refused, and the page re-renders the current state", async (t) => {
  const ada = randomUUID();
  const identities: Identity[] = [{ id: ada, traits: { email: "ada@example.com" } }];
  const tuples: RelationTuple[] = [{ namespace: "Permission", object: "users:read", relation: "granted", subject_id: `user:${ada}` }];
  const keto = fakeKeto(tuples);
  const kratosAdmin = stubAdmin({ getIdentity: async (id) => identities.find((i) => i.id === id) ?? null, listIdentities: async () => ({ identities, nextPageToken: null }) });
  const { get, post, token } = await adminHarness(t, { keto, kratosAdmin });
  const stale = baselineOf(await (await get(`/admin/users/${ada}`)).text());

  // Another admin grants users:write while this page is open.
  tuples.push({ namespace: "Permission", object: "users:write", relation: "granted", subject_id: `user:${ada}` });
  const before = JSON.stringify(tuples);
  const refused = await post(`/admin/users/${ada}/permissions`, `_csrf=${token}&baseline=${stale}&permission=users%3Aread&permission=groups%3Aread`);
  assert.equal(refused.status, 409);
  const page = await refused.text();
  assert.match(page, /changed while you had the page open/);
  assert.equal(JSON.stringify(tuples), before, "nothing was applied");
  assert.match(page, /value="users:write"[^>]*checked/); // the re-render shows the other admin's grant
  assert.notEqual(baselineOf(page), stale);

  // Saving from the re-rendered page goes through.
  const retried = await post(`/admin/users/${ada}/permissions`, `_csrf=${token}&baseline=${baselineOf(page)}&permission=users%3Aread&permission=users%3Awrite&permission=groups%3Aread`);
  assert.equal(retried.status, 303);
  assert.ok(tuples.some((tp) => tp.object === "groups:read" && tp.subject_id === `user:${ada}`));

  // A POST with no token at all (a crafted request, or a form rendered before this check existed) is stale too.
  assert.equal((await post(`/admin/users/${ada}/permissions`, `_csrf=${token}&permission=users%3Aread`)).status, 409);

  // Groups are checked the same way.
  tuples.push({ namespace: "Group", object: "eng", relation: "members", subject_id: `user:${ada}` });
  const groupStale = baselineOf(await (await get("/admin/groups/eng")).text());
  tuples.push({ namespace: "Permission", object: "groups:read", relation: "granted", subject_set: { namespace: "Group", object: "eng", relation: "members" } });
  const groupRefused = await post("/admin/groups/eng/permissions", `_csrf=${token}&baseline=${groupStale}&permission=users%3Aread`);
  assert.equal(groupRefused.status, 409);
  assert.match(await groupRefused.text(), /changed while you had the page open/);
  assert.ok(tuples.some((tp) => tp.object === "groups:read" && tp.subject_set?.object === "eng"), "the group keeps its grant");
});

// A Keto error midway leaves some changes applied; the save says so and still revokes the user's live tokens.
test("admin permission grants: a Keto failure midway reports a partial save and keeps what was applied", async (t) => {
  const ada = randomUUID();
  const identities: Identity[] = [{ id: ada, traits: { email: "ada@example.com" } }];
  const tuples: RelationTuple[] = [];
  let writes = 0;
  const keto = fakeKeto(tuples, {
    writeTuple: async (tp) => {
      if (++writes === 2) throw new Error("keto unreachable");
      tuples.push(tp);
    },
  });
  const kratosAdmin = stubAdmin({ getIdentity: async (id) => identities.find((i) => i.id === id) ?? null, listIdentities: async () => ({ identities, nextPageToken: null }) });
  const denylist = createDenylist();
  const { get, post, token } = await adminHarness(t, { denylist, keto, kratosAdmin });
  const baseline = baselineOf(await (await get(`/admin/users/${ada}`)).text());

  const res = await post(`/admin/users/${ada}/permissions`, `_csrf=${token}&baseline=${baseline}&permission=groups%3Aread&permission=users%3Aread&permission=users%3Awrite`);
  assert.equal(res.status, 502);
  const page = await res.text();
  assert.match(page, /stopped part-way/);
  assert.match(page, /value="groups:read"[^>]*checked/); // the first write landed, and the page shows what is stored
  assert.doesNotMatch(page, /value="users:write"[^>]*checked/);
  assert.deepEqual(tuples.map((tp) => tp.object), ["groups:read"]);
  assert.equal(denylist.isRevoked(ada, 0), true); // the half that was applied still revokes live tokens
});

// A double-clicked Save posts twice from one page; the second post finds the first one's result.
// A save that changes nothing has nothing to refuse and nothing to revoke.
test("admin permission grants: a save that changes nothing is not refused for a stale page and leaves live tokens alone", async (t) => {
  const ada = randomUUID();
  const identities: Identity[] = [{ id: ada, traits: { email: "ada@example.com" } }];
  const tuples: RelationTuple[] = [{ namespace: "Permission", object: "users:read", relation: "granted", subject_id: `user:${ada}` }];
  const kratosAdmin = stubAdmin({ getIdentity: async (id) => identities.find((i) => i.id === id) ?? null, listIdentities: async () => ({ identities, nextPageToken: null }) });
  const denylist = createDenylist();
  const { get, post, token } = await adminHarness(t, { denylist, keto: fakeKeto(tuples), kratosAdmin });
  const stale = baselineOf(await (await get(`/admin/users/${ada}`)).text());
  tuples.push({ namespace: "Permission", object: "users:write", relation: "granted", subject_id: `user:${ada}` });
  const before = JSON.stringify(tuples);

  const repeated = await post(`/admin/users/${ada}/permissions`, `_csrf=${token}&baseline=${stale}&permission=users%3Aread&permission=users%3Awrite`);
  assert.equal(repeated.status, 303);
  assert.equal(JSON.stringify(tuples), before);
  assert.equal(denylist.isRevoked(ada, 0), false);
});

// Keto answered the writes but not the re-read: the report must still reach the admin.
test("admin permission grants: a partial save is still reported when Keto cannot be read again", async (t) => {
  const ada = randomUUID();
  const identities: Identity[] = [{ id: ada, traits: { email: "ada@example.com" } }];
  const tuples: RelationTuple[] = [];
  let writes = 0;
  let down = false;
  let failureTakesKetoDown = true;
  const keto = fakeKeto(tuples, {
    listRelations: async (q = {}) => {
      if (down) throw new Error("keto unreachable");
      return { nextPageToken: null, tuples: tuples.filter((tp) => matchesTuple(tp, q)) };
    },
    writeTuple: async (tp) => {
      if (++writes === 2) { down = failureTakesKetoDown; throw new Error("keto unreachable"); }
      tuples.push(tp);
    },
  });
  const kratosAdmin = stubAdmin({ getIdentity: async (id) => identities.find((i) => i.id === id) ?? null, listIdentities: async () => ({ identities, nextPageToken: null }) });
  const { get, post, token } = await adminHarness(t, { keto, kratosAdmin });
  const baseline = baselineOf(await (await get(`/admin/users/${ada}`)).text());

  const res = await post(`/admin/users/${ada}/permissions`, `_csrf=${token}&baseline=${baseline}&permission=groups%3Aread&permission=users%3Aread`);
  assert.equal(res.status, 502);
  assert.match(await res.text(), /stopped part-way/);
  assert.deepEqual(tuples.map((tp) => tp.object), ["groups:read"]);

  // The same on a group, whose page needs Keto for its members as well.
  down = false;
  writes = 0;
  tuples.length = 0;
  tuples.push({ namespace: "Group", object: "eng", relation: "members", subject_id: `user:${ada}` });
  const groupBaseline = baselineOf(await (await get("/admin/groups/eng")).text());
  const groupRes = await post("/admin/groups/eng/permissions", `_csrf=${token}&baseline=${groupBaseline}&permission=groups%3Aread&permission=users%3Aread`);
  assert.equal(groupRes.status, 502);
  assert.match(await groupRes.text(), /stopped part-way/);
  assert.ok(tuples.some((tp) => tp.object === "groups:read" && tp.subject_set?.object === "eng"), "the first write landed");

  // With Keto still answering, the group page itself reports it and shows what is stored.
  failureTakesKetoDown = false;
  down = false;
  writes = 0;
  tuples.length = 1;
  const again = await post("/admin/groups/eng/permissions", `_csrf=${token}&baseline=${baselineOf(await (await get("/admin/groups/eng")).text())}&permission=groups%3Aread&permission=users%3Aread`);
  assert.equal(again.status, 502);
  const page = await again.text();
  assert.match(page, /stopped part-way/);
  assert.match(page, /value="groups:read"[^>]*checked/);
});

// Revoking your own grants can remove the last users:write on the deployment, and the instant-revoke
// hook lands it on the next request — recovery would be a curl against Keto. Guarded like
// self-deactivate and self-delete are. (`admin1` is the harness's own sub.)
test("admin permission grants: you can't revoke your own permissions, but you can still grant", async (t) => {
  const identities: Identity[] = [{ id: "admin1", traits: { email: "you@example.com" } }];
  const tuples: RelationTuple[] = [{ namespace: "Permission", object: "users:write", relation: "granted", subject_id: "user:admin1" }];
  const keto = fakeKeto(tuples);
  const kratosAdmin = stubAdmin({ getIdentity: async (id) => identities.find((i) => i.id === id) ?? null, listIdentities: async () => ({ identities, nextPageToken: null }) });
  const { get, post, token } = await adminHarness(t, { keto, kratosAdmin });
  const baseline = baselineOf(await (await get("/admin/users/admin1")).text());

  const refused = await post("/admin/users/admin1/permissions", `_csrf=${token}&baseline=${baseline}`); // every box cleared
  assert.equal(refused.status, 400);
  assert.match(await refused.text(), /lock yourself out/);
  assert.ok(tuples.some((tp) => tp.object === "users:write" && tp.subject_id === "user:admin1"), "nothing was revoked");

  // Granting yourself more is not a lockout, so it goes through.
  const granted = await post("/admin/users/admin1/permissions", `_csrf=${token}&baseline=${baseline}&permission=users%3Awrite&permission=groups%3Aread`);
  assert.equal(granted.status, 303);
  assert.ok(tuples.some((tp) => tp.object === "groups:read" && tp.subject_id === "user:admin1"));
});

// A check over the tuple array that expands nested groups.
function resolvingCheck(tuples: RelationTuple[]) {
  const reaches = (q: RelationTuple, ns: string, object: string, relation: string, seen: Set<string>): boolean => {
    const key = `${ns}:${object}#${relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return tuples.some((tp) => tp.namespace === ns && tp.object === object && tp.relation === relation && (
      (q.subject_id !== undefined && tp.subject_id === q.subject_id) ||
      (q.subject_set !== undefined && tp.subject_set?.namespace === q.subject_set.namespace && tp.subject_set.object === q.subject_set.object) ||
      (tp.subject_set !== undefined && reaches(q, tp.subject_set.namespace, tp.subject_set.object, tp.subject_set.relation, seen))));
  };
  return async (q: RelationTuple) => reaches(q, q.namespace, q.object, q.relation, new Set());
}

// A member value must be a UUID, so this test signs in as `you`.
test("admin groups: you can't take away permissions you hold only through a group you are in", async (t) => {
  const ada = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b01";
  const you = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b02";
  const identities: Identity[] = [{ id: you, traits: { email: "you@example.com" } }, { id: ada, traits: { email: "ada@example.com" } }];
  const member = (group: string, subject: string): RelationTuple => ({ namespace: "Group", object: group, relation: "members", subject_id: subject });
  const nested = (group: string, child: string): RelationTuple => ({ namespace: "Group", object: group, relation: "members", subject_set: { namespace: "Group", object: child, relation: "members" } });
  const grant = (permission: string, group: string): RelationTuple => ({ namespace: "Permission", object: permission, relation: "granted", subject_set: { namespace: "Group", object: group, relation: "members" } });
  const tuples: RelationTuple[] = [
    member("eng", `user:${you}`), member("eng", `user:${ada}`), grant("users:write", "eng"), grant("groups:write", "eng"),
    { namespace: "Permission", object: "groups:write", relation: "granted", subject_id: `user:${you}` }, // also held directly
    nested("leads", "eng"), grant("oauth2-clients:write", "leads"), // reached through eng
    member("social", `user:${you}`), // confers nothing
    member("design", `user:${ada}`), grant("users:write", "design"), // you are not in it
  ];
  const keto = fakeKeto(tuples, { check: resolvingCheck(tuples) });
  const kratosAdmin = stubAdmin({ getIdentity: async (id) => identities.find((i) => i.id === id) ?? null, listIdentities: async () => ({ identities, nextPageToken: null }) });
  const { get, post, token } = await adminHarness(t, { keto, kratosAdmin }, you);
  const baseline = baselineOf(await (await get("/admin/groups/eng")).text());
  // A refusal renders that group's own page and names what you would lose.
  const refusedWithMessage = async (res: Response, group: string, lost: string) => {
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.match(html, new RegExp(`lock you out of ${lost}, which`));
    assert.match(html, new RegExp(`action="/admin/groups/${group}/members"`));
  };

  // Unticking users:write on eng would take it from you: refused, nothing revoked.
  const before = JSON.stringify(tuples);
  await refusedWithMessage(await post("/admin/groups/eng/permissions", `_csrf=${token}&baseline=${baseline}&permission=groups%3Awrite`), "eng", "users:write");
  // Leaving eng, removing eng from leads, or deleting eng (the confirm step too) are refused the same
  // way; leaving eng also loses what it gets from leads.
  await refusedWithMessage(await post("/admin/groups/eng/members/delete", `_csrf=${token}&member=user:${you}`), "eng", "oauth2-clients:write, users:write");
  await refusedWithMessage(await post("/admin/groups/leads/members/delete", `_csrf=${token}&member=group:eng`), "leads", "oauth2-clients:write");
  await refusedWithMessage(await get("/admin/groups/eng/delete"), "eng", "oauth2-clients:write, users:write");
  await refusedWithMessage(await post("/admin/groups/eng/delete", `_csrf=${token}`), "eng", "oauth2-clients:write, users:write");
  assert.equal(JSON.stringify(tuples), before, "nothing changed");

  // You hold groups:write directly too, so unticking it on eng costs you nothing.
  assert.equal((await post("/admin/groups/eng/permissions", `_csrf=${token}&baseline=${baseline}&permission=users%3Awrite`)).status, 303);
  // Removing someone else, leaving a group that confers nothing, and deleting a group you are not in all go through.
  assert.equal((await post("/admin/groups/eng/members/delete", `_csrf=${token}&member=user:${ada}`)).status, 303);
  assert.equal((await post("/admin/groups/social/members/delete", `_csrf=${token}&member=user:${you}`)).status, 303);
  assert.equal((await post("/admin/groups/design/delete", `_csrf=${token}`)).status, 303);
  assert.ok(!tuples.some((tp) => tp.object === "design" || tp.subject_set?.object === "design"));
});

// The read/write split is only honest if the UI models it: a users:read holder must not be shown
// buttons that 403 on submit. The gate already refuses them (asserted above); this is the affordance.
test("admin screens render no write affordance for a read-only holder", async (t) => {
  const ada = randomUUID();
  const identities: Identity[] = [{ id: ada, traits: { email: "ada@example.com" } }];
  const keto = fakeKeto([{ namespace: "Group", object: "eng", relation: "members", subject_id: `user:${ada}` }]);
  const kratosAdmin = stubAdmin({ getIdentity: async (id) => identities.find((i) => i.id === id) ?? null, listIdentities: async () => ({ identities, nextPageToken: null }) });
  // Hydra is wired so the clients screen renders for real — without it the page is a 503 and the
  // "no Register button" assertion below would pass without proving anything.
  const reporting = { client_id: "existing", client_name: "Reporting" };
  const hydra = stubHydra({ getClient: async (id) => (id === reporting.client_id ? reporting : null), listClients: async () => ({ clients: [reporting], nextPageToken: null }) });
  const { get } = await adminHarness(t, { hydra, keto, kratosAdmin });
  const readOnly = ["users:read", "groups:read"];

  const list = await (await get("/admin/users", readOnly)).text();
  assert.doesNotMatch(list, /href="\/admin\/users\/new"/); // no "New user"
  assert.match(list, /ada@example\.com/); // but the list itself is there — that's the point of :read

  // (The shell's own sign-out is a POST form, so assert on the affordances by name, not on <form>.)
  const detail = await (await get(`/admin/users/${ada}`, readOnly)).text();
  assert.doesNotMatch(detail, /Save changes/);
  assert.doesNotMatch(detail, /Generate recovery code/);
  assert.doesNotMatch(detail, /Delete user/);
  assert.doesNotMatch(detail, /Save permissions/);
  assert.match(detail, /type="checkbox"[^>]*disabled/); // the permissions are shown, just not editable

  const group = await (await get("/admin/groups/eng", readOnly)).text();
  assert.doesNotMatch(group, /Add a member/);
  assert.doesNotMatch(group, /Delete group/);
  assert.doesNotMatch(group, /Save permissions/);

  // The OAuth2-clients screen is held to the same rule.
  const clientsRes = await get("/admin/clients", ["oauth2-clients:read"]);
  assert.equal(clientsRes.status, 200); // a real render, not the capability-missing 503
  const clients = await clientsRes.text();
  assert.match(clients, /Reporting/); // the list is there — that's what :read buys
  assert.doesNotMatch(clients, /href="\/admin\/clients\/new"/);
  // The detail page is where Delete lives, so check it too and not just the list.
  const clientDetail = await (await get("/admin/clients/existing", ["oauth2-clients:read"])).text();
  assert.match(clientDetail, /Reporting/);
  assert.doesNotMatch(clientDetail, /clients\/existing\/delete/);

  // A write-intent GET — a create form or a delete-confirm — refuses a reader outright rather than
  // rendering a form whose submit would 403.
  for (const path of ["/admin/users/new", "/admin/groups/new", `/admin/users/${ada}/delete`, "/admin/groups/eng/delete"]) {
    assert.equal((await get(path, readOnly)).status, 403, path);
  }
  assert.equal((await get("/admin/clients/new", ["oauth2-clients:read"])).status, 403);

  // A writer sees the affordances the reader didn't.
  const writable = await (await get(`/admin/users/${ada}`, ["users:read", "users:write"])).text();
  assert.match(writable, /Save changes/);
  assert.match(writable, /Save permissions/);
});

// Built-in OAuth2 clients admin screen: gate + list/register/detail/delete over HTTP against an
// in-memory Hydra. Registration shows the one-time client_secret on the post-create page (no PRG).
test("admin OAuth2 clients screen: gate, list, register (one-time secret), detail, delete (CSRF-guarded)", async (t) => {
  const store: OAuth2Client[] = [
    { client_id: "existing", client_name: "Reporting", redirect_uris: ["https://reporting.example/cb"], scope: "openid", token_endpoint_auth_method: "client_secret_basic" },
  ];
  let seq = 0;
  const hydra = stubHydra({
    createClient: async (c) => { const created = { ...c, client_id: `gen-${++seq}`, client_secret: `secret-${seq}` }; store.push(created); return created; },
    deleteClient: async (id) => { const i = store.findIndex((c) => c.client_id === id); if (i >= 0) store.splice(i, 1); },
    getClient: async (id) => store.find((c) => c.client_id === id) ?? null,
    listClients: async () => ({ clients: store, nextPageToken: null }),
  });
  const { get, post, token, url } = await adminHarness(t, { hydra });

  await assertAdminGate(url, get, "/admin/clients");

  // List: the existing client shows + the "register" link.
  const listHtml = await (await get("/admin/clients")).text();
  assert.match(listHtml, /href="\/admin\/clients\/existing"/);
  assert.match(listHtml, /href="\/admin\/clients\/new"/);
  assert.match(listHtml, /Reporting/);

  // Register: the form renders (with confidential-vs-public guidance); a valid post creates the
  // client and shows the one-time secret + id.
  const formHtml = await (await get("/admin/clients/new")).text();
  assert.match(formHtml, /Register client/);
  assert.match(formHtml, /keep a secret/i); // guidance on the public-vs-confidential choice (apostrophes arrive escaped: t() text goes through <%= %>)
  const created = await post("/admin/clients", `_csrf=${token}&name=Grafana&redirectUris=${encodeURIComponent("https://graf/cb")}&scope=openid+offline_access`);
  assert.equal(created.status, 200); // not a redirect — the secret is shown once
  const createdHtml = await created.text();
  assert.match(createdHtml, /Client registered/);
  assert.match(createdHtml, /secret-1/); // the one-time client_secret
  assert.match(createdHtml, /gen-1/);    // the generated client_id
  assert.ok(store.some((c) => c.client_name === "Grafana" && c.token_endpoint_auth_method === "client_secret_basic"));

  // Invalid input (missing redirect URI) and a missing CSRF token are both refused, nothing created.
  const before = store.length;
  assert.equal((await post("/admin/clients", `_csrf=${token}&name=NoRedirect&redirectUris=`)).status, 400);
  assert.equal((await post("/admin/clients", `name=x&redirectUris=${encodeURIComponent("https://x/cb")}`)).status, 403);
  assert.equal(store.length, before);

  // Detail: read-only info, never the secret again, a delete control.
  const detail = await (await get("/admin/clients/existing")).text();
  assert.match(detail, /reporting\.example\/cb/);
  assert.doesNotMatch(detail, /Client secret/i); // the secret is shown only once, at creation
  assert.match(detail, /delete and re-register/i); // no edit: the lifecycle guidance is surfaced
  assert.match(detail, /href="\/admin\/clients\/existing\/delete"/);

  // Delete: a confirm step (GET) then the POST removes the client, back to the list.
  assert.match(await (await get("/admin/clients/existing/delete")).text(), /Cancel/);
  const del = await post("/admin/clients/existing/delete", `_csrf=${token}`);
  assert.equal(del.status, 303);
  assert.equal(del.headers.get("location"), "/admin/clients");
  assert.ok(!store.some((c) => c.client_id === "existing"));

  // Unknown id → 404; malformed %-encoding doesn't 500.
  assert.equal((await get("/admin/clients/does-not-exist")).status, 404);
  assert.equal((await get("/admin/clients/%ZZ")).status, 404);
});

