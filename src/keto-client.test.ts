// Keto client: typed fetch wrappers over Ory Keto's read (check/list/expand) and
// write (write/delete tuple) APIs. Guards the request contracts (URLs, ports, method,
// query/body shape, subject_id vs subject_set) and the result mapping (allowed bool, the
// next_page_token, 2xx/204/error). Live wiring is verified by login completion + guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKetoClient, KetoError } from "./keto-client.ts";

const READ = "http://keto:4466";
const WRITE = "http://keto:4467";
const USER = "user:01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55";

function res(status: number, body?: unknown): Response {
  const h = new Headers();
  if (body !== undefined) h.set("content-type", "application/json");
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: h });
}

function recorder(handler: (url: string, init: RequestInit | undefined) => Response) {
  const calls: { body: string | undefined; method: string; url: string }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ body: init?.body as string | undefined, method: init?.method ?? "GET", url: String(input) });
    return handler(String(input), init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const keto = (fetchImpl: typeof fetch) => createKetoClient({ fetchImpl, readUrl: READ, writeUrl: WRITE });

test("check GETs the read API and returns the allowed boolean (true and false)", async () => {
  const allow = recorder(() => res(200, { allowed: true }));
  assert.equal(await keto(allow.fetchImpl).check({ namespace: "Role", object: "admin", relation: "members", subject_id: USER }), true);
  assert.match(allow.calls[0]!.url, /^http:\/\/keto:4466\/relation-tuples\/check\?/);
  assert.match(allow.calls[0]!.url, /namespace=Role&object=admin&relation=members/);
  assert.match(allow.calls[0]!.url, new RegExp(`subject_id=${encodeURIComponent(USER).replace(/[.]/g, "\\.")}`));
  // A denied check is 403 {allowed:false} (not a 200) — both statuses carry the verdict.
  const deny = recorder(() => res(403, { allowed: false }));
  assert.equal(await keto(deny.fetchImpl).check({ namespace: "Role", object: "admin", relation: "members", subject_id: "user:nobody" }), false);
});

test("check on a subject_set builds subject_set.* params and forwards max-depth", async () => {
  const { calls, fetchImpl } = recorder(() => res(200, { allowed: true }));
  await keto(fetchImpl).check(
    { namespace: "Resource", object: "doc1", relation: "view", subject_set: { namespace: "Group", object: "eng", relation: "members" } },
    { maxDepth: 5 },
  );
  const url = calls[0]!.url;
  assert.match(url, /subject_set\.namespace=Group&subject_set\.object=eng&subject_set\.relation=members/);
  assert.match(url, /max-depth=5/);
});

test("check throws a KetoError carrying the status on an unexpected response", async () => {
  await assert.rejects(
    keto((async () => res(400, { error: "bad" })) as typeof fetch).check({ namespace: "Role", object: "admin", relation: "members", subject_id: USER }),
    (e: unknown) => e instanceof KetoError && e.status === 400,
  );
});

test("listRelations builds the filter query + pagination and parses next_page_token", async () => {
  const tuples = [{ namespace: "Role", object: "admin", relation: "members", subject_id: USER }];
  const { calls, fetchImpl } = recorder(() => res(200, { next_page_token: "NEXT", relation_tuples: tuples }));
  const out = await keto(fetchImpl).listRelations({ namespace: "Role", object: "admin", pageSize: 10, pageToken: "CUR", relation: "members" });
  assert.deepEqual(out.tuples, tuples);
  assert.equal(out.nextPageToken, "NEXT");
  const url = calls[0]!.url;
  assert.match(url, /^http:\/\/keto:4466\/relation-tuples\?/);
  assert.match(url, /namespace=Role&object=admin&relation=members/);
  assert.match(url, /page_size=10&page_token=CUR/);
  // No Link header / token in the body ⇒ null, empty list ⇒ [].
  const empty = await keto((async () => res(200, {})) as typeof fetch).listRelations();
  assert.deepEqual(empty, { nextPageToken: null, tuples: [] });
});

test("expand GETs the read API for a subject set and returns the tree (with max-depth)", async () => {
  const tree = { children: [{ tuple: { namespace: "", object: "", relation: "", subject_id: USER }, type: "leaf" }], tuple: { namespace: "", object: "", relation: "", subject_set: { namespace: "Role", object: "admin", relation: "members" } }, type: "union" };
  const { calls, fetchImpl } = recorder(() => res(200, tree));
  const out = await keto(fetchImpl).expand({ namespace: "Role", object: "admin", relation: "members" }, { maxDepth: 3 });
  assert.deepEqual(out, tree);
  assert.match(calls[0]!.url, /^http:\/\/keto:4466\/relation-tuples\/expand\?/);
  assert.match(calls[0]!.url, /namespace=Role&object=admin&relation=members&max-depth=3/);
});

test("writeTuple PUTs the tuple as JSON to the write API (idempotent; non-2xx throws)", async () => {
  const tuple = { namespace: "Role", object: "admin", relation: "members", subject_id: USER };
  const { calls, fetchImpl } = recorder(() => res(201, tuple));
  await keto(fetchImpl).writeTuple(tuple);
  assert.equal(calls[0]!.method, "PUT");
  assert.equal(calls[0]!.url, `${WRITE}/admin/relation-tuples`);
  assert.deepEqual(JSON.parse(calls[0]!.body!), tuple);
  await assert.rejects(
    keto((async () => res(500, "boom")) as typeof fetch).writeTuple(tuple),
    (e: unknown) => e instanceof KetoError && e.status === 500,
  );
});

test("deleteTuple DELETEs the write API by query params (204 resolves; non-204 throws)", async () => {
  const { calls, fetchImpl } = recorder(() => res(204));
  await keto(fetchImpl).deleteTuple({ namespace: "Role", object: "admin", relation: "members", subject_id: USER });
  assert.equal(calls[0]!.method, "DELETE");
  assert.match(calls[0]!.url, /^http:\/\/keto:4467\/admin\/relation-tuples\?/);
  assert.match(calls[0]!.url, /namespace=Role&object=admin&relation=members/);
  await assert.rejects(
    keto((async () => res(404)) as typeof fetch).deleteTuple({ namespace: "Role", object: "x", relation: "members", subject_id: USER }),
    (e: unknown) => e instanceof KetoError && e.status === 404,
  );
});
