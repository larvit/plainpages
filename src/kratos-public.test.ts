// Kratos public-API client: typed fetch wrappers over Ory Kratos' public endpoints.
// Guards the request contracts (URLs, JSON-accept, cookie relay) and the result mapping
// (200/401/4xx, validation-flow vs success, tokenized JWT). Live wiring is verified by the
// flow pages; these catch contract drift with a mock fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKratosPublic, KratosError } from "./kratos-public.ts";

const BASE = "http://kratos:4433";

function res(status: number, body?: unknown, setCookie: string[] = []): Response {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  for (const c of setCookie) headers.append("set-cookie", c);
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

// Records each call so a test can assert URL/method/headers/body.
function recorder(handler: (url: string, init: RequestInit | undefined) => Response) {
  const calls: { body: string | undefined; headers: Headers; method: string; url: string }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({
      body: init?.body as string | undefined,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: String(input),
    });
    return handler(String(input), init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("initBrowserFlow gets /self-service/<type>/browser as JSON, relays Set-Cookie, forwards return_to", async () => {
  const flow = { id: "f1", ui: { action: `${BASE}/self-service/login?flow=f1`, method: "POST", nodes: [] } };
  const { calls, fetchImpl } = recorder(() => res(200, flow, ["csrf_token=abc; Path=/; HttpOnly"]));
  const out = await createKratosPublic({ baseUrl: BASE, fetchImpl }).initBrowserFlow("login", { returnTo: "http://app/after" });
  assert.deepEqual(out.flow, flow);
  assert.deepEqual(out.setCookie, ["csrf_token=abc; Path=/; HttpOnly"]);
  assert.match(calls[0]!.url, /\/self-service\/login\/browser\?return_to=http%3A%2F%2Fapp%2Fafter$/);
  assert.equal(calls[0]!.headers.get("accept"), "application/json");
});

test("getFlow fetches the flow by id forwarding the browser cookie", async () => {
  const flow = { id: "f2", ui: { action: "x", method: "POST", nodes: [] } };
  const { calls, fetchImpl } = recorder(() => res(200, flow));
  const out = await createKratosPublic({ baseUrl: BASE, fetchImpl }).getFlow("registration", "f2", { cookie: "csrf_token=abc" });
  assert.deepEqual(out, flow);
  assert.match(calls[0]!.url, /\/self-service\/registration\/flows\?id=f2$/);
  assert.equal(calls[0]!.headers.get("cookie"), "csrf_token=abc");
});

test("getFlow throws a KratosError carrying the status when the flow is gone (410)", async () => {
  const { fetchImpl } = recorder(() => res(410, { error: { id: "self_service_flow_expired" } }));
  await assert.rejects(
    createKratosPublic({ baseUrl: BASE, fetchImpl }).getFlow("login", "old"),
    (e: unknown) => e instanceof KratosError && e.status === 410,
  );
});

test("submitFlow POSTs urlencoded to the action and reports success + relays Set-Cookie", async () => {
  const { calls, fetchImpl } = recorder(() => res(200, { session: { active: true } }, ["plainpages_session=s; Path=/"]));
  const out = await createKratosPublic({ baseUrl: BASE, fetchImpl })
    .submitFlow(`${BASE}/self-service/login?flow=f`, { body: "identifier=a&password=b", cookie: "csrf_token=abc" });
  assert.equal(out.ok, true);
  assert.equal(out.status, 200);
  assert.deepEqual(out.setCookie, ["plainpages_session=s; Path=/"]);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.equal(calls[0]!.body, "identifier=a&password=b");
});

test("submitFlow returns the re-rendered flow (no throw) on a 400 validation error", async () => {
  const flow = { id: "f", ui: { action: "x", messages: [{ id: 4000006, text: "invalid credentials", type: "error" }], method: "POST", nodes: [] } };
  const { fetchImpl } = recorder(() => res(400, flow));
  const out = await createKratosPublic({ baseUrl: BASE, fetchImpl }).submitFlow(`${BASE}/x`, { body: "x=1" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.deepEqual(out.body, flow);
});

test("submitFlow surfaces the redirect target — Location header or a 422 redirect_browser_to body", async () => {
  const k = (handler: () => Response) => createKratosPublic({ baseUrl: BASE, fetchImpl: recorder(handler).fetchImpl });
  const viaHeader = await k(() => new Response(null, { headers: new Headers({ location: "http://app/" }), status: 303 }))
    .submitFlow(`${BASE}/x`, { body: "x=1" });
  assert.equal(viaHeader.location, "http://app/");
  const viaBody = await k(() => res(422, { redirect_browser_to: "http://app/login?flow=next" }))
    .submitFlow(`${BASE}/x`, { body: "x=1" });
  assert.equal(viaBody.location, "http://app/login?flow=next");
});

test("whoami returns the session on 200 (cookie forwarded) and null on 401", async () => {
  const session = { active: true, identity: { id: "u1", traits: { email: "a@b" } } };
  const { calls, fetchImpl } = recorder((url) => (url.endsWith("/sessions/whoami") ? res(200, session) : res(401)));
  const k = createKratosPublic({ baseUrl: BASE, fetchImpl });
  assert.deepEqual(await k.whoami({ cookie: "plainpages_session=s" }), session);
  assert.equal(calls[0]!.headers.get("cookie"), "plainpages_session=s");
  assert.equal(await createKratosPublic({ baseUrl: BASE, fetchImpl: (async () => res(401)) as typeof fetch }).whoami(), null);
});

test("whoami?tokenize_as mints a session JWT via the tokenizer template", async () => {
  const session = { active: true, identity: { id: "u1" }, tokenized: "header.payload.sig" };
  const { calls, fetchImpl } = recorder(() => res(200, session));
  const out = await createKratosPublic({ baseUrl: BASE, fetchImpl }).whoami({ cookie: "plainpages_session=s", tokenizeAs: "plainpages" });
  assert.equal(out?.tokenized, "header.payload.sig");
  assert.match(calls[0]!.url, /\/sessions\/whoami\?tokenize_as=plainpages$/);
});

test("whoami throws on an unexpected upstream error", async () => {
  const { fetchImpl } = recorder(() => res(500, { error: "boom" }));
  await assert.rejects(createKratosPublic({ baseUrl: BASE, fetchImpl }).whoami(), KratosError);
});

test("createLogoutFlow returns the logout URL/token on 200 (cookie forwarded) and null on 401 (no session)", async () => {
  const flow = { logout_token: "lt", logout_url: `${BASE}/self-service/logout?token=lt` };
  const { calls, fetchImpl } = recorder((url) => (url.endsWith("/self-service/logout/browser") ? res(200, flow) : res(401)));
  const out = await createKratosPublic({ baseUrl: BASE, fetchImpl }).createLogoutFlow({ cookie: "plainpages_session=s" });
  assert.deepEqual(out, { logoutToken: "lt", logoutUrl: flow.logout_url });
  assert.match(calls[0]!.url, /\/self-service\/logout\/browser$/);
  assert.equal(calls[0]!.headers.get("cookie"), "plainpages_session=s");
  assert.equal(await createKratosPublic({ baseUrl: BASE, fetchImpl: (async () => res(401)) as typeof fetch }).createLogoutFlow(), null);
});
