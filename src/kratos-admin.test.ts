// Kratos admin-API client (§4): typed fetch wrappers over Ory Kratos' admin endpoints —
// identity CRUD + the surgical metadata_admin update the login flow projects roles into.
// Guards the request contracts (URLs, method, JSON-Patch body, query/pagination) and the
// result mapping (201/200/404/4xx). Live wiring is verified by login completion (§4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKratosAdmin } from "./kratos-admin.ts";
import { KratosError } from "./kratos-public.ts";

const BASE = "http://kratos:4434";
const ID = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55";

function res(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  const h = new Headers(headers);
  if (body !== undefined) h.set("content-type", "application/json");
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: h });
}

function recorder(handler: (url: string, init: RequestInit | undefined) => Response) {
  const calls: { body: string | undefined; headers: Headers; method: string; url: string }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ body: init?.body as string | undefined, headers: new Headers(init?.headers), method: init?.method ?? "GET", url: String(input) });
    return handler(String(input), init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("createIdentity POSTs JSON to /admin/identities and returns the created identity (201)", async () => {
  const identity = { id: ID, traits: { email: "a@b" } };
  const { calls, fetchImpl } = recorder(() => res(201, identity));
  const payload = { schema_id: "default", traits: { email: "a@b" } };
  const out = await createKratosAdmin({ baseUrl: BASE, fetchImpl }).createIdentity(payload);
  assert.deepEqual(out, identity);
  assert.equal(calls[0]!.method, "POST");
  assert.match(calls[0]!.url, /\/admin\/identities$/);
  assert.equal(calls[0]!.headers.get("content-type"), "application/json");
  assert.equal(calls[0]!.body, JSON.stringify(payload));
});

test("createIdentity throws a KratosError carrying the status on conflict (409)", async () => {
  const { fetchImpl } = recorder(() => res(409, { error: { id: "conflict" } }));
  await assert.rejects(
    createKratosAdmin({ baseUrl: BASE, fetchImpl }).createIdentity({}),
    (e: unknown) => e instanceof KratosError && e.status === 409,
  );
});

test("getIdentity reads /admin/identities/<id> → identity on 200, null on 404", async () => {
  const identity = { id: ID, traits: { email: "a@b" } };
  const { calls, fetchImpl } = recorder((url) => (url.endsWith(ID) ? res(200, identity) : res(404)));
  const admin = createKratosAdmin({ baseUrl: BASE, fetchImpl });
  assert.deepEqual(await admin.getIdentity(ID), identity);
  assert.match(calls[0]!.url, new RegExp(`/admin/identities/${ID}$`));
  assert.equal(await createKratosAdmin({ baseUrl: BASE, fetchImpl: (async () => res(404)) as typeof fetch }).getIdentity("missing"), null);
});

test("listIdentities builds the query (filter/ids/pagination) and parses next page_token from the Link header", async () => {
  const identities = [{ id: ID }];
  const link = `</admin/identities?page_size=2&page_token=NEXT>; rel="next",</admin/identities?page_size=2>; rel="first"`;
  const { calls, fetchImpl } = recorder(() => res(200, identities, { link }));
  const out = await createKratosAdmin({ baseUrl: BASE, fetchImpl }).listIdentities({
    credentialsIdentifier: "a@b",
    ids: ["x", "y"],
    pageSize: 2,
    pageToken: "CUR",
  });
  assert.deepEqual(out.identities, identities);
  assert.equal(out.nextPageToken, "NEXT");
  const url = calls[0]!.url;
  assert.match(url, /credentials_identifier=a%40b/);
  assert.match(url, /ids=x&ids=y/);
  assert.match(url, /page_size=2/);
  assert.match(url, /page_token=CUR/);
});

test("listIdentities reports a null next token when there is no Link header", async () => {
  const { fetchImpl } = recorder(() => res(200, []));
  assert.equal((await createKratosAdmin({ baseUrl: BASE, fetchImpl }).listIdentities()).nextPageToken, null);
});

test("updateIdentity PUTs the full body to /admin/identities/<id> and returns the updated identity", async () => {
  const identity = { id: ID, state: "inactive" };
  const { calls, fetchImpl } = recorder(() => res(200, identity));
  const body = { schema_id: "default", state: "inactive", traits: { email: "a@b" } };
  const out = await createKratosAdmin({ baseUrl: BASE, fetchImpl }).updateIdentity(ID, body);
  assert.deepEqual(out, identity);
  assert.equal(calls[0]!.method, "PUT");
  assert.match(calls[0]!.url, new RegExp(`/admin/identities/${ID}$`));
  assert.equal(calls[0]!.body, JSON.stringify(body));
});

test("updateMetadataAdmin PATCHes a JSON-Patch `add /metadata_admin` so it never clobbers traits", async () => {
  const identity = { id: ID, metadata_admin: { roles: ["admin"] } };
  const { calls, fetchImpl } = recorder(() => res(200, identity));
  const out = await createKratosAdmin({ baseUrl: BASE, fetchImpl }).updateMetadataAdmin(ID, { roles: ["admin"] });
  assert.deepEqual(out, identity);
  assert.equal(calls[0]!.method, "PATCH");
  assert.match(calls[0]!.url, new RegExp(`/admin/identities/${ID}$`));
  assert.deepEqual(JSON.parse(calls[0]!.body!), [{ op: "add", path: "/metadata_admin", value: { roles: ["admin"] } }]);
});

test("deleteIdentity DELETEs by id (204 resolves; non-204 throws a KratosError)", async () => {
  const { calls, fetchImpl } = recorder(() => res(204));
  await createKratosAdmin({ baseUrl: BASE, fetchImpl }).deleteIdentity(ID);
  assert.equal(calls[0]!.method, "DELETE");
  assert.match(calls[0]!.url, new RegExp(`/admin/identities/${ID}$`));
  await assert.rejects(
    createKratosAdmin({ baseUrl: BASE, fetchImpl: (async () => res(404)) as typeof fetch }).deleteIdentity("missing"),
    (e: unknown) => e instanceof KratosError && e.status === 404,
  );
});
