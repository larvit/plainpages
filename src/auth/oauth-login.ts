// OAuth2 login-challenge handler: when another app logs in *through* plainpages,
// Hydra hands the browser to /oauth2/login?login_challenge=… (hydra.yml urls.login). We
// authenticate the user with their existing Kratos session and accept the request; Hydra then
// proceeds to consent and mints the tokens. No first-party page needs this — it's the OAuth2
// provider role only (README).
import type { HydraAdmin } from "./hydra-admin.ts";
import type { KratosPublic } from "./kratos-public.ts";

// Remember the Hydra login for the browser-session lifetime (0), so a client re-authorizing
// doesn't re-run this on every token refresh while the Kratos session lives.
const REMEMBER_FOR = 0;

export interface OAuthLoginDeps {
  hydra: HydraAdmin;
  kratos: KratosPublic;
}

export interface LoginResolution {
  redirect: string;
}

// Resolve a login challenge:
//   - skip (Hydra already authenticated the subject) → accept it, don't re-prompt.
//   - a live Kratos session                          → accept with that identity as the subject.
//   - no session                                     → send the browser to our themed Kratos
//     login, returning to `selfUrl` (this challenge) once authenticated, where whoami succeeds.
export async function resolveLoginChallenge(
  deps: OAuthLoginDeps,
  challenge: string,
  cookie: string | undefined,
  selfUrl: string,
): Promise<LoginResolution> {
  const login = await deps.hydra.getLoginRequest(challenge);
  if (login.skip) {
    return deps.hydra.acceptLoginRequest(challenge, { subject: login.subject });
  }
  const session = await deps.kratos.whoami(cookie ? { cookie } : {});
  if (session?.identity) {
    return deps.hydra.acceptLoginRequest(challenge, { remember: true, remember_for: REMEMBER_FOR, subject: session.identity.id });
  }
  return { redirect: `/login?return_to=${encodeURIComponent(selfUrl)}` };
}
