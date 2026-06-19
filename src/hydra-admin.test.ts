// Hydra admin-API client (§6): typed fetch wrappers over Ory Hydra's OAuth2 login/consent
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
