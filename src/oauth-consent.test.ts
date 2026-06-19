// OAuth2 consent-challenge resolution (§6): given a Hydra consent challenge, auto-accept a
// first-party (or Hydra-skipped) client granting the requested scopes, else show a consent
// screen; on submit accept (allow) or reject (deny). id_token claims come from the Kratos identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AcceptConsent, ConsentRequest, HydraAdmin } from "./hydra-admin.ts";
import type { KratosPublic, Session } from "./kratos-public.ts";
import { acceptConsent, rejectConsent, resolveConsentChallenge } from "./oauth-consent.ts";

const CHALLENGE = "cons-1";
const SUBJECT = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55";
const REDIRECT = "http://hydra/oauth2/auth?consent_verifier=v";
const DENIED = "http://client/cb?error=access_denied";

function stubHydra(consent: ConsentRequest, capture?: (b: AcceptConsent) => void): HydraAdmin {
  const unused = async () => { throw new Error("unused"); };
  return {
    acceptConsentRequest: async (_c, body) => { capture?.(body); return { redirect: REDIRECT }; },
    acceptLoginRequest: unused,
    createClient: unused,
    deleteClient: unused,
    getClient: unused,
    getConsentRequest: async () => consent,
    getLoginRequest: unused,
    listClients: unused,
    rejectConsentRequest: async () => ({ redirect: DENIED }),
    rejectLoginRequest: unused,
  };
}
const stubKratos = (whoami: KratosPublic["whoami"]): KratosPublic => ({
  createLogoutFlow: async () => null,
  getFlow: async () => { throw new Error("unused"); },
  initBrowserFlow: async () => { throw new Error("unused"); },
  submitFlow: async () => { throw new Error("unused"); },
  whoami,
});
const sessionWith = (traits?: Record<string, unknown>): Session => ({ active: true, identity: { id: SUBJECT, ...(traits ? { traits } : {}) } });
const consent = (over: Partial<ConsentRequest> = {}): ConsentRequest =>
  ({ challenge: CHALLENGE, client: { client_name: "Acme Reports" }, requested_scope: ["openid", "profile"], skip: false, subject: SUBJECT, ...over });

test("a Hydra-skipped client auto-accepts, granting the requested scopes + audience + id_token from the identity", async () => {
  let granted: AcceptConsent | undefined;
  const hydra = stubHydra(consent({ requested_access_token_audience: ["https://api"], requested_scope: ["openid", "email"], skip: true }), (b) => { granted = b; });
  const kratos = stubKratos(async () => sessionWith({ email: "ada@x.io", name: { first: "Ada", last: "Lovelace" } }));
  const out = await resolveConsentChallenge({ hydra, kratos }, CHALLENGE, "plainpages_session=s");
  assert.equal(out.redirect, REDIRECT);
  assert.equal(out.view, undefined);
  assert.deepEqual(granted?.grant_scope, ["openid", "email"]);
  assert.deepEqual(granted?.grant_access_token_audience, ["https://api"]);
  assert.deepEqual(granted?.session, { id_token: { email: "ada@x.io", name: "Ada Lovelace" } });
});

test("a first-party client (metadata.first_party) auto-accepts even without skip; no identity ⇒ no id_token", async () => {
  let granted: AcceptConsent | undefined;
  const hydra = stubHydra(consent({ client: { client_name: "Internal", metadata: { first_party: true } }, requested_scope: ["openid"] }), (b) => { granted = b; });
  const out = await resolveConsentChallenge({ hydra, kratos: stubKratos(async () => null) }, CHALLENGE, undefined);
  assert.equal(out.redirect, REDIRECT);
  assert.deepEqual(granted?.grant_scope, ["openid"]);
  assert.equal(granted?.session, undefined);
});

test("a third-party client shows the consent screen (no auto-accept)", async () => {
  let accepted = false;
  const hydra = stubHydra(consent(), () => { accepted = true; });
  const out = await resolveConsentChallenge({ hydra, kratos: stubKratos(async () => null) }, CHALLENGE, undefined);
  assert.equal(out.redirect, undefined);
  assert.deepEqual(out.view, { challenge: CHALLENGE, client: "Acme Reports", scopes: ["openid", "profile"] });
  assert.equal(accepted, false);
});

test("acceptConsent re-fetches the challenge and grants its scopes (never client-supplied)", async () => {
  let granted: AcceptConsent | undefined;
  const hydra = stubHydra(consent(), (b) => { granted = b; });
  const redirect = await acceptConsent({ hydra, kratos: stubKratos(async () => sessionWith({ email: "ada@x.io" })) }, CHALLENGE, "plainpages_session=s");
  assert.equal(redirect, REDIRECT);
  assert.deepEqual(granted?.grant_scope, ["openid", "profile"]);
  assert.deepEqual(granted?.session, { id_token: { email: "ada@x.io" } });
});

test("rejectConsent rejects with access_denied → the client's error redirect", async () => {
  const redirect = await rejectConsent({ hydra: stubHydra(consent()), kratos: stubKratos(async () => null) }, CHALLENGE);
  assert.equal(redirect, DENIED);
});
