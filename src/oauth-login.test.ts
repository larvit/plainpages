// OAuth2 login-challenge resolution (§6): given a Hydra login challenge, authenticate the user
// via their Kratos session and accept — or bounce an unauthenticated user to the Kratos login UI.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AcceptLogin, HydraAdmin, LoginRequest } from "./hydra-admin.ts";
import type { KratosPublic, Session } from "./kratos-public.ts";
import { resolveLoginChallenge } from "./oauth-login.ts";

const CHALLENGE = "chal-1";
const SUBJECT = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55";
const SELF = "http://127.0.0.1:3000/oauth2/login?login_challenge=chal-1";

function stubHydra(login: LoginRequest, capture?: (b: AcceptLogin) => void): HydraAdmin {
  const unused = async () => { throw new Error("unused"); };
  return {
    acceptConsentRequest: unused,
    acceptLoginRequest: async (_c, body) => { capture?.(body); return { redirect: "http://hydra/oauth2/auth?login_verifier=v" }; },
    getConsentRequest: unused,
    getLoginRequest: async () => login,
    rejectConsentRequest: unused,
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
const session = (id: string): Session => ({ active: true, identity: { id } });

test("a live Kratos session accepts the login with that subject → Hydra redirect", async () => {
  let accepted: AcceptLogin | undefined;
  const hydra = stubHydra({ challenge: CHALLENGE, skip: false, subject: "" }, (b) => { accepted = b; });
  const out = await resolveLoginChallenge({ hydra, kratos: stubKratos(async () => session(SUBJECT)) }, CHALLENGE, "plainpages_session=s", SELF);
  assert.equal(out.redirect, "http://hydra/oauth2/auth?login_verifier=v");
  assert.equal(accepted?.subject, SUBJECT);
  assert.equal(accepted?.remember, true);
});

test("skip (Hydra already authenticated) accepts the request's subject without checking Kratos", async () => {
  let accepted: AcceptLogin | undefined;
  let whoamiCalled = false;
  const hydra = stubHydra({ challenge: CHALLENGE, skip: true, subject: SUBJECT }, (b) => { accepted = b; });
  const kratos = stubKratos(async () => { whoamiCalled = true; return null; });
  const out = await resolveLoginChallenge({ hydra, kratos }, CHALLENGE, undefined, SELF);
  assert.equal(out.redirect, "http://hydra/oauth2/auth?login_verifier=v");
  assert.equal(accepted?.subject, SUBJECT);
  assert.equal(whoamiCalled, false, "skip short-circuits the Kratos check");
});

test("no Kratos session bounces to the themed login UI, returning here once authenticated", async () => {
  const hydra = stubHydra({ challenge: CHALLENGE, skip: false, subject: "" });
  const out = await resolveLoginChallenge({ hydra, kratos: stubKratos(async () => null) }, CHALLENGE, undefined, SELF);
  assert.equal(out.redirect, `/login?return_to=${encodeURIComponent(SELF)}`);
});
