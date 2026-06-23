// Hydra admin-API client: typed fetch wrappers over Ory Hydra's OAuth2 login/consent
// challenge handshake. Guards the request contracts (URLs, method, login_challenge query,
// JSON body) and the result mapping (200 → request/redirect, non-2xx → HydraError). Live
// wiring is verified by the OAuth login E2E.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHydraAdmin, HydraError } from "./hydra-admin.ts";

const BASE = "http://hydra:4445";
const CHALLENGE = "a1b2c3d4e5f6";
const SUBJECT = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55";

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

test("getLoginRequest GETs the login challenge and returns the request", async () => {
  const request = { challenge: CHALLENGE, client: { client_id: "c1" }, requested_scope: ["openid"], skip: false, subject: "" };
  const { calls, fetchImpl } = recorder(() => res(200, request));
  const out = await createHydraAdmin({ baseUrl: BASE, fetchImpl }).getLoginRequest(CHALLENGE);
  assert.deepEqual(out, request);
  assert.equal(calls[0]!.method, "GET");
  assert.match(calls[0]!.url, /\/admin\/oauth2\/auth\/requests\/login\?login_challenge=a1b2c3d4e5f6$/);
});

test("acceptLoginRequest PUTs the subject and returns Hydra's redirect_to", async () => {
  const { calls, fetchImpl } = recorder(() => res(200, { redirect_to: "http://hydra/oauth2/auth?login_verifier=v" }));
  const out = await createHydraAdmin({ baseUrl: BASE, fetchImpl }).acceptLoginRequest(CHALLENGE, { remember: true, remember_for: 0, subject: SUBJECT });
  assert.equal(out.redirect, "http://hydra/oauth2/auth?login_verifier=v");
  assert.equal(calls[0]!.method, "PUT");
  assert.match(calls[0]!.url, /\/admin\/oauth2\/auth\/requests\/login\/accept\?login_challenge=a1b2c3d4e5f6$/);
  assert.deepEqual(JSON.parse(calls[0]!.body!), { remember: true, remember_for: 0, subject: SUBJECT });
});

test("rejectLoginRequest PUTs the error and returns Hydra's redirect_to", async () => {
  const { calls, fetchImpl } = recorder(() => res(200, { redirect_to: "http://client/cb?error=access_denied" }));
  const out = await createHydraAdmin({ baseUrl: BASE, fetchImpl }).rejectLoginRequest(CHALLENGE, { error: "access_denied", error_description: "no" });
  assert.equal(out.redirect, "http://client/cb?error=access_denied");
  assert.equal(calls[0]!.method, "PUT");
  assert.match(calls[0]!.url, /\/admin\/oauth2\/auth\/requests\/login\/reject\?login_challenge=a1b2c3d4e5f6$/);
  assert.deepEqual(JSON.parse(calls[0]!.body!), { error: "access_denied", error_description: "no" });
});

test("acceptLogoutRequest PUTs the logout challenge and returns Hydra's redirect_to", async () => {
  const { calls, fetchImpl } = recorder(() => res(200, { redirect_to: "http://client/post-logout" }));
  const out = await createHydraAdmin({ baseUrl: BASE, fetchImpl }).acceptLogoutRequest(CHALLENGE);
  assert.equal(out.redirect, "http://client/post-logout");
  assert.equal(calls[0]!.method, "PUT");
  assert.match(calls[0]!.url, /\/admin\/oauth2\/auth\/requests\/logout\/accept\?logout_challenge=a1b2c3d4e5f6$/);
});

test("getConsentRequest GETs the consent challenge and returns the request", async () => {
  const request = { challenge: CHALLENGE, client: { client_name: "Acme" }, requested_scope: ["openid", "email"], skip: false, subject: SUBJECT };
  const { calls, fetchImpl } = recorder(() => res(200, request));
  const out = await createHydraAdmin({ baseUrl: BASE, fetchImpl }).getConsentRequest(CHALLENGE);
  assert.deepEqual(out, request);
  assert.equal(calls[0]!.method, "GET");
  assert.match(calls[0]!.url, /\/admin\/oauth2\/auth\/requests\/consent\?consent_challenge=a1b2c3d4e5f6$/);
});

test("acceptConsentRequest PUTs the grant + id_token session and returns Hydra's redirect_to", async () => {
  const { calls, fetchImpl } = recorder(() => res(200, { redirect_to: "http://hydra/oauth2/auth?consent_verifier=v" }));
  const body = { grant_scope: ["openid"], remember: true, remember_for: 0, session: { id_token: { email: "a@b.c" } } };
  const out = await createHydraAdmin({ baseUrl: BASE, fetchImpl }).acceptConsentRequest(CHALLENGE, body);
  assert.equal(out.redirect, "http://hydra/oauth2/auth?consent_verifier=v");
  assert.equal(calls[0]!.method, "PUT");
  assert.match(calls[0]!.url, /\/admin\/oauth2\/auth\/requests\/consent\/accept\?consent_challenge=a1b2c3d4e5f6$/);
  assert.deepEqual(JSON.parse(calls[0]!.body!), body);
});

test("rejectConsentRequest PUTs the error and returns Hydra's redirect_to", async () => {
  const { calls, fetchImpl } = recorder(() => res(200, { redirect_to: "http://client/cb?error=access_denied" }));
  const out = await createHydraAdmin({ baseUrl: BASE, fetchImpl }).rejectConsentRequest(CHALLENGE, { error: "access_denied" });
  assert.equal(out.redirect, "http://client/cb?error=access_denied");
  assert.match(calls[0]!.url, /\/admin\/oauth2\/auth\/requests\/consent\/reject\?consent_challenge=a1b2c3d4e5f6$/);
});

test("a non-2xx response throws a HydraError carrying the status", async () => {
  const { fetchImpl } = recorder(() => res(404, { error: "Not Found" }));
  await assert.rejects(
    createHydraAdmin({ baseUrl: BASE, fetchImpl }).getLoginRequest("gone"),
    (e: unknown) => e instanceof HydraError && e.status === 404,
  );
});

// OAuth2 client registration: create/list/get/delete clients over Hydra's admin API.
test("createClient POSTs the client and returns it (incl. the one-time client_secret)", async () => {
  const created = { client_id: "c1", client_name: "Acme", client_secret: "s3cr3t", redirect_uris: ["https://acme/cb"] };
  const { calls, fetchImpl } = recorder(() => res(201, created));
  const out = await createHydraAdmin({ baseUrl: BASE, fetchImpl }).createClient({ client_name: "Acme", redirect_uris: ["https://acme/cb"] });
  assert.deepEqual(out, created);
  assert.equal(calls[0]!.method, "POST");
  assert.match(calls[0]!.url, /\/admin\/clients$/);
  assert.deepEqual(JSON.parse(calls[0]!.body!), { client_name: "Acme", redirect_uris: ["https://acme/cb"] });
});

test("listClients GETs a page and parses the Link rel=next page_token", async () => {
  const body = JSON.stringify([{ client_id: "c1" }, { client_id: "c2" }]);
  const headers = new Headers({ "content-type": "application/json", link: '</admin/clients?page_token=tok2&page_size=2>; rel="next"' });
  const { calls, fetchImpl } = recorder(() => new Response(body, { headers, status: 200 }));
  const out = await createHydraAdmin({ baseUrl: BASE, fetchImpl }).listClients({ pageSize: 2 });
  assert.deepEqual(out.clients.map((c) => c.client_id), ["c1", "c2"]);
  assert.equal(out.nextPageToken, "tok2");
  assert.equal(calls[0]!.method, "GET");
  assert.match(calls[0]!.url, /\/admin\/clients\?page_size=2$/);
});

test("getClient returns the client; a 404 → null", async () => {
  const found = await createHydraAdmin({ baseUrl: BASE, fetchImpl: recorder(() => res(200, { client_id: "c1" })).fetchImpl }).getClient("c1");
  assert.deepEqual(found, { client_id: "c1" });
  const missing = await createHydraAdmin({ baseUrl: BASE, fetchImpl: recorder(() => res(404, { error: "Not Found" })).fetchImpl }).getClient("gone");
  assert.equal(missing, null);
});

test("deleteClient DELETEs the client by id (204)", async () => {
  const { calls, fetchImpl } = recorder(() => res(204));
  await createHydraAdmin({ baseUrl: BASE, fetchImpl }).deleteClient("c1");
  assert.equal(calls[0]!.method, "DELETE");
  assert.match(calls[0]!.url, /\/admin\/clients\/c1$/);
});
