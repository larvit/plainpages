// OAuth2 consent-challenge handler (todo §6): after login, Hydra hands the browser to
// /oauth2/consent?consent_challenge=… (hydra.yml urls.consent). A first-party client (or one
// Hydra already skipped) is auto-granted the requested scopes; a third-party client shows the
// themed consent screen, then accept (allow) / reject (deny). id_token claims (email/name) come
// from the Kratos identity. OAuth2-provider role only — no first-party page needs this (README).
import type { AcceptConsent, ConsentRequest, HydraAdmin, OAuth2Client } from "./hydra-admin.ts";
import type { KratosPublic } from "./kratos-public.ts";

// Remember the grant for the browser-session lifetime (0): a client re-authorizing while the
// Kratos session lives doesn't re-prompt on every token refresh (mirrors oauth-login).
const REMEMBER_FOR = 0;

export interface OAuthConsentDeps {
  hydra: HydraAdmin;
  kratos: KratosPublic;
}

// What to show on the consent screen for a third-party client.
export interface ConsentView {
  challenge: string;
  client: string; // display name
  scopes: string[];
}

// A consent challenge resolves to either an immediate redirect (auto-accepted) or a render
// decision (show the consent screen).
export interface ConsentResolution {
  redirect?: string;
  view?: ConsentView;
}

const isFirstParty = (client?: OAuth2Client): boolean => client?.metadata?.first_party === true;
const clientName = (client?: OAuth2Client): string => client?.client_name || client?.client_id || "the application";

// id_token claims from Kratos traits (email + a joined name); undefined ⇒ omit the session.
function idTokenClaims(traits?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!traits) return undefined;
  const claims: Record<string, unknown> = {};
  if (typeof traits.email === "string") claims.email = traits.email;
  const name = traits.name as { first?: string; last?: string } | undefined;
  const full = [name?.first, name?.last].filter(Boolean).join(" ");
  if (full) claims.name = full;
  return Object.keys(claims).length ? claims : undefined;
}

// Accept a consent request, granting exactly the scopes/audience Hydra asked for (re-read from
// the challenge, never client-submitted) plus id_token claims from the current Kratos session.
async function accept(deps: OAuthConsentDeps, consent: ConsentRequest, cookie: string | undefined): Promise<string> {
  const session = await deps.kratos.whoami(cookie ? { cookie } : {});
  const idToken = idTokenClaims(session?.identity?.traits);
  const body: AcceptConsent = {
    grant_access_token_audience: consent.requested_access_token_audience ?? [],
    grant_scope: consent.requested_scope ?? [],
    remember: true,
    remember_for: REMEMBER_FOR,
    ...(idToken ? { session: { id_token: idToken } } : {}),
  };
  return (await deps.hydra.acceptConsentRequest(consent.challenge, body)).redirect;
}

// Resolve a consent challenge: skip / first-party ⇒ auto-accept; else show the consent screen.
export async function resolveConsentChallenge(deps: OAuthConsentDeps, challenge: string, cookie: string | undefined): Promise<ConsentResolution> {
  const consent = await deps.hydra.getConsentRequest(challenge);
  if (consent.skip || isFirstParty(consent.client)) {
    return { redirect: await accept(deps, consent, cookie) };
  }
  return { view: { challenge, client: clientName(consent.client), scopes: consent.requested_scope ?? [] } };
}

// The user allowed: re-fetch the challenge (don't trust the form for scopes) and accept.
export async function acceptConsent(deps: OAuthConsentDeps, challenge: string, cookie: string | undefined): Promise<string> {
  return accept(deps, await deps.hydra.getConsentRequest(challenge), cookie);
}

// The user denied: reject so Hydra redirects back to the client with access_denied.
export async function rejectConsent(deps: OAuthConsentDeps, challenge: string): Promise<string> {
  return (await deps.hydra.rejectConsentRequest(challenge, { error: "access_denied", error_description: "The user denied the request." })).redirect;
}
