// Login completion (§4): turn a Kratos session into our session JWT — read roles from Keto,
// project them onto the identity, tokenize, build the cookie. Fakes the three Ory clients;
// the live, full-stack login is verified by the §8 Playwright E2E.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KetoClient, RelationTuple } from "./keto-client.ts";
import type { Identity, KratosAdmin } from "./kratos-admin.ts";
import type { KratosPublic, Session } from "./kratos-public.ts";
import { completeLogin, readRoles, remintSession, SESSION_COOKIE, sessionCookie } from "./login.ts";

const ID = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55";
const roleTuple = (object: string): RelationTuple => ({ namespace: "Role", object, relation: "members", subject_id: `user:${ID}` });

const ketoStub = (over: Partial<KetoClient> = {}): KetoClient => ({
  check: async () => false,
  deleteTuple: async () => {},
  expand: async () => ({ type: "leaf" }),
  listRelations: async () => ({ nextPageToken: null, tuples: [] }),
  writeTuple: async () => {},
  ...over,
});

const adminStub = (over: Partial<KratosAdmin> = {}): KratosAdmin => ({
  createIdentity: async () => { throw new Error("unused"); },
  createRecoveryCode: async () => ({ code: "000000", link: "http://kratos/recover" }),
  deleteIdentity: async () => {},
  getIdentity: async () => null,
  listIdentities: async () => ({ identities: [], nextPageToken: null }),
  updateIdentity: async () => { throw new Error("unused"); },
  updateMetadataPublic: async () => ({ id: ID }),
  ...over,
});

const publicStub = (over: Partial<KratosPublic> = {}): KratosPublic => ({
  createLogoutFlow: async () => null,
  getFlow: async () => { throw new Error("unused"); },
  initBrowserFlow: async () => { throw new Error("unused"); },
  submitFlow: async () => { throw new Error("unused"); },
  whoami: async () => null,
  ...over,
});

test("readRoles reads direct Role memberships from Keto — paged, de-duped, sorted", async () => {
  const calls: unknown[] = [];
  const keto = ketoStub({
    listRelations: async (q) => {
      calls.push(q);
      if (!q?.pageToken) return { nextPageToken: "p2", tuples: [roleTuple("editor"), roleTuple("admin")] };
      return { nextPageToken: null, tuples: [roleTuple("admin")] }; // duplicate across pages
    },
  });
  assert.deepEqual(await readRoles(keto, ID), ["admin", "editor"]);
  assert.deepEqual(calls[0], { namespace: "Role", relation: "members", subject_id: `user:${ID}` });
  assert.equal((calls[1] as { pageToken?: string }).pageToken, "p2"); // second page follows the cursor
});

test("completeLogin: read roles → project onto metadata_public → tokenize → JWT (in that order)", async () => {
  const events: string[] = [];
  let projected: unknown;
  const identity: Identity = { id: ID, traits: { email: "admin@plainpages.local" } };
  const kratosPublic = publicStub({
    whoami: async (o) => {
      if (o?.tokenizeAs) { events.push("tokenize"); return { active: true, identity, tokenized: "h.p.s" } as Session; }
      events.push("whoami"); return { active: true, identity } as Session;
    },
  });
  const kratosAdmin = adminStub({ updateMetadataPublic: async (_id, meta) => { events.push("project"); projected = meta; return identity; } });
  const keto = ketoStub({ listRelations: async () => ({ nextPageToken: null, tuples: [roleTuple("admin")] }) });

  const out = await completeLogin({ keto, kratosAdmin, kratosPublic }, "plainpages_session=s");
  assert.deepEqual(out, { email: "admin@plainpages.local", identityId: ID, jwt: "h.p.s", roles: ["admin"] });
  assert.deepEqual(projected, { roles: ["admin"] }); // Keto roles, projected for the tokenizer
  assert.deepEqual(events, ["whoami", "project", "tokenize"]); // projection MUST precede tokenize
});

test("completeLogin returns null and touches nothing when there is no active session", async () => {
  let touched = false;
  const keto = ketoStub({ listRelations: async () => { touched = true; return { nextPageToken: null, tuples: [] }; } });
  const kratosAdmin = adminStub({ updateMetadataPublic: async () => { touched = true; return { id: ID }; } });
  assert.equal(await completeLogin({ keto, kratosAdmin, kratosPublic: publicStub() }, undefined), null);
  assert.equal(touched, false);
});

test("completeLogin maps a missing email trait to null and throws if the tokenizer yields no JWT", async () => {
  const identity: Identity = { id: ID, traits: {} };
  const kratosPublic = publicStub({ whoami: async () => ({ active: true, identity }) as Session }); // never returns a tokenized JWT
  await assert.rejects(completeLogin({ keto: ketoStub(), kratosAdmin: adminStub(), kratosPublic }, "c"), /tokenizer returned no JWT/);
});

test("remintSession: a live Kratos session → fresh cookie + refreshed user; a dead session → a clearing cookie + null", async () => {
  const identity: Identity = { id: ID, traits: { email: "admin@plainpages.local" } };
  const kratosPublic = publicStub({ whoami: async (o) => (o?.tokenizeAs ? { active: true, identity, tokenized: "h.p.s" } : { active: true, identity }) as Session });
  const keto = ketoStub({ listRelations: async () => ({ nextPageToken: null, tuples: [roleTuple("admin")] }) });

  // TTL lapsed but the Kratos session lives → re-read roles from Keto, re-tokenize, fresh cookie.
  const live = await remintSession({ keto, kratosAdmin: adminStub(), kratosPublic }, "plainpages_session=s");
  assert.deepEqual(live.user, { email: "admin@plainpages.local", id: ID, roles: ["admin"] });
  assert.match(live.setCookie, /^plainpages_jwt=h\.p\.s;.*Max-Age=2592000.*HttpOnly/);

  // Kratos session also gone → clear the stale JWT so the next request falls through to anonymous.
  const dead = await remintSession({ keto, kratosAdmin: adminStub(), kratosPublic: publicStub() }, undefined);
  assert.equal(dead.user, null);
  assert.match(dead.setCookie, /^plainpages_jwt=;.*Max-Age=0/);
});

test("sessionCookie builds the HttpOnly/Lax JWT cookie; secure opt-in; JWT chars stay readable", () => {
  const jwt = "aaa.bbb-_.ccc";
  assert.equal(sessionCookie(jwt), `${SESSION_COOKIE}=${jwt}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax`);
  assert.match(sessionCookie(jwt, { secure: true }), /; SameSite=Lax; Secure$/);
});
