// The built-in auth/OAuth2 endpoints as named handlers on the host's internal route table
// (src/http/builtin-routes.ts): the themed Kratos self-service pages, the Hydra OAuth2
// login/consent/logout challenges, login completion, the first-party logout, and Kratos'
// flow-error sink. buildAuthRoutes registers only what the wired clients support — a missing
// client means the path simply doesn't exist (404). `view` results render the core views.
import { readFormBody } from "../http/body.ts";
import type { BuiltinRoute, RequestCsrf } from "../http/builtin-routes.ts";
import type { RequestContext } from "../http/context.ts";
import { CSRF_FIELD } from "./csrf.ts";
import { AUTH_FLOWS, buildFlowView } from "./flow-view.ts";
import { HydraError, type HydraAdmin } from "./hydra-admin.ts";
import type { KetoClient } from "./keto-client.ts";
import type { KratosAdmin } from "./kratos-admin.ts";
import { type Flow, type FlowType, KratosError, type KratosPublic } from "./kratos-public.ts";
import { clearSessionCookie, completeLogin, sessionCookie } from "./login.ts";
import type { MenuConfig } from "../ui/menu-config.ts";
import { acceptConsent, rejectConsent, resolveConsentChallenge } from "./oauth-consent.ts";
import { resolveLoginChallenge } from "./oauth-login.ts";
import type { RouteResult } from "../plugin-host/plugin.ts";
import { localPath } from "../http/safe-url.ts";

export interface AuthRouteDeps {
  hydra: HydraAdmin | undefined; // OAuth2 provider challenges; absent ⇒ /oauth2/* don't exist
  keto: KetoClient | undefined; // with kratos+kratosAdmin: login completion
  kratos: KratosPublic | undefined; // themed self-service pages + logout
  kratosAdmin: KratosAdmin | undefined;
  menu: MenuConfig; // consent-screen branding
  secureCookies: boolean; // cookie Secure flag + the scheme of self-referencing absolute URLs
}

const TEXT_PLAIN = { "content-type": "text/plain; charset=utf-8" };
const FORBIDDEN: RouteResult = { data: { title: "Forbidden" }, status: 403, view: "403" };

// Scheme + host for a self-referencing absolute URL (Kratos/Hydra return targets). Host reflects
// what the browser used (so it matches the allow-lists); scheme follows SECURE_COOKIES. A spoofed
// Host can't escape — Kratos/Hydra validate return URLs against their allow-lists.
const selfOrigin = (ctx: RequestContext, secure: boolean): string =>
  `${secure ? "https" : "http"}://${ctx.req.headers.host ?? "127.0.0.1:3000"}`;

// Themed Kratos self-service page (one route per AUTH_FLOWS entry: login/registration/recovery/
// verification/settings).
function flowPage(kratos: KratosPublic, flowType: FlowType, secureCookies: boolean): BuiltinRoute["handler"] {
  return async (ctx: RequestContext, csrf: RequestCsrf): Promise<RouteResult> => {
    const pathname = ctx.url.pathname;
    // Already signed in? Re-authenticating / re-registering is pointless — send them to the app
    // dashboard. (/settings, /recovery, /verification stay reachable — a signed-in user can use those.)
    if (ctx.user && (flowType === "login" || flowType === "registration")) return { redirect: "/dashboard" };
    const cookie = ctx.req.headers.cookie;
    const flowId = ctx.url.searchParams.get("flow");
    // Only the Kratos calls are in the try, so a render/buildFlowView bug below falls through to
    // the catch-all 500 (with a stack), not the "Ory unreachable" 503.
    let flow: Flow;
    try {
      if (!flowId) {
        // No flow yet: init one server-side, relay Kratos' CSRF cookie, bounce to ?flow=<id>.
        // A `return_to` is baked into the flow so Kratos lands there after login instead of the
        // default completion route. A first-party deep link (host-relative, from the gate's
        // return_to) is wrapped through /auth/complete so the session JWT is minted before the
        // user reaches the page; an absolute target (the OAuth2 login challenge) is passed
        // as-is — Kratos allow-lists it. localPath rejects an off-origin "//evil.com".
        const raw = ctx.url.searchParams.get("return_to");
        const local = localPath(raw);
        let returnTo: string | undefined;
        if (local) {
          const complete = new URL(`${selfOrigin(ctx, secureCookies)}/auth/complete`);
          complete.searchParams.set("return_to", local);
          returnTo = complete.toString();
        } else if (raw) returnTo = raw;
        const { flow: initiated, setCookie } = await kratos.initBrowserFlow(flowType, { ...(cookie ? { cookie } : {}), ...(returnTo ? { returnTo } : {}) });
        if (setCookie.length) ctx.res.appendHeader("set-cookie", setCookie);
        return { redirect: `${pathname}?flow=${initiated.id}` };
      }
      flow = await kratos.getFlow(flowType, flowId, cookie ? { cookie } : {});
    } catch (err) {
      // Expired/unknown flow → restart by re-initialising (drop the stale ?flow=).
      if (err instanceof KratosError && [403, 404, 410].includes(err.status)) return { redirect: pathname };
      // Already authenticated at Kratos but no app JWT yet (e.g. straight after registration, whose
      // `session` hook signs the user in but routes to verification, not /auth/complete — so ctx.user
      // is null and the "already signed in" short-circuit above can't fire). Initialising a login/
      // registration flow then returns Kratos 400 `session_already_available`. Recover by completing
      // login (mint the JWT from the live session), honouring return_to — never a 500.
      if (err instanceof KratosError && err.status === 400 && err.body.includes("session_already_available")) {
        const local = localPath(ctx.url.searchParams.get("return_to"));
        return { redirect: local ? `/auth/complete?return_to=${encodeURIComponent(local)}` : "/auth/complete" };
      }
      // Ory unreachable (Kratos 5xx / connection refused / timeout): "Ory down ⇒ no logins" is
      // documented, so render an honest 503 rather than the catch-all "error on our end" 500.
      if (!(err instanceof KratosError) || err.status >= 500) {
        ctx.log.warn("auth flow failed (Ory unreachable?)", { error: String(err), path: pathname });
        return { data: { title: "Sign-in unavailable" }, status: 503, view: "503" };
      }
      throw err; // any other Kratos 4xx → the catch-all (genuinely unexpected)
    }
    // Rendered inside the unified app shell, so set a fresh CSRF cookie when minted — the
    // shell's Sign-out form (shown on /settings, where the user is signed in) needs the token.
    csrf.setCookie();
    return { data: { chrome: ctx.chrome, flow: buildFlowView(flow, flowType) }, view: "auth" };
  };
}

// OAuth2 login challenge: Hydra hands the browser here when another app logs in *through* us.
// Resolve it via the Kratos session and accept; an unauthenticated user bounces to our themed
// login and returns here once signed in. Provider-only.
function oauthLogin(deps: { hydra: HydraAdmin; kratos: KratosPublic }, secureCookies: boolean): BuiltinRoute["handler"] {
  return async (ctx: RequestContext): Promise<RouteResult> => {
    const challenge = ctx.url.searchParams.get("login_challenge");
    if (!challenge) return { headers: TEXT_PLAIN, html: "Missing login_challenge", status: 400 };
    // Absolute return target so Kratos lands back here post-login.
    const selfUrl = `${selfOrigin(ctx, secureCookies)}/oauth2/login?login_challenge=${encodeURIComponent(challenge)}`;
    try {
      const { redirect } = await resolveLoginChallenge(deps, challenge, ctx.req.headers.cookie, selfUrl);
      return { redirect };
    } catch (err) {
      // A stale/invalid/consumed challenge (Hydra 4xx — back button, slow login, re-used URL) is
      // user-reachable: tell them to restart rather than 500. A 5xx (Hydra down) rethrows → 500.
      if (err instanceof HydraError && err.status < 500) {
        return { headers: TEXT_PLAIN, html: "This sign-in request has expired. Please start again from the application you were signing in to.", status: 400 };
      }
      throw err;
    }
  };
}

// Stale/consumed challenge (Hydra 4xx) → recoverable 400; a genuine outage (5xx) → 500 (as /oauth2/login).
function consentError(err: unknown): RouteResult {
  if (err instanceof HydraError && err.status < 500) {
    return { headers: TEXT_PLAIN, html: "This authorization request has expired. Please start again from the application you were signing in to.", status: 400 };
  }
  throw err;
}

// OAuth2 consent challenge: after login Hydra hands the browser here. A first-party (or
// Hydra-skipped) client is auto-granted its scopes; a third-party client gets the themed consent
// screen, whose CSRF-guarded POST (consentDecision) accepts or rejects. Provider-only.
function consentScreen(deps: { hydra: HydraAdmin; kratos: KratosPublic }, brand: string): BuiltinRoute["handler"] {
  return async (ctx: RequestContext, csrf: RequestCsrf): Promise<RouteResult> => {
    const challenge = ctx.url.searchParams.get("consent_challenge");
    if (!challenge) return { headers: TEXT_PLAIN, html: "Missing consent_challenge", status: 400 };
    try {
      const { redirect, view } = await resolveConsentChallenge(deps, challenge, ctx.req.headers.cookie);
      if (redirect) return { redirect };
      // Third-party: show the consent screen, carrying a CSRF token its form echoes back.
      csrf.setCookie();
      return { data: { brand, consent: view, csrfField: CSRF_FIELD, csrfToken: csrf.token }, view: "oauth-consent" };
    } catch (err) {
      return consentError(err);
    }
  };
}

// The consent screen's POST: allow → accept the requested scopes, anything else → deny.
function consentDecision(deps: { hydra: HydraAdmin; kratos: KratosPublic }): BuiltinRoute["handler"] {
  return async (ctx: RequestContext): Promise<RouteResult> => {
    const form = await readFormBody(ctx.req);
    if (!ctx.verifyCsrf(form.get(CSRF_FIELD))) {
      ctx.log.warn("csrf rejected", { path: ctx.url.pathname });
      return FORBIDDEN;
    }
    const challenge = form.get("consent_challenge");
    if (!challenge) return { headers: TEXT_PLAIN, html: "Missing consent_challenge", status: 400 };
    try {
      const redirect = form.get("decision") === "allow"
        ? await acceptConsent(deps, challenge, ctx.req.headers.cookie)
        : await rejectConsent(deps, challenge);
      return { redirect };
    } catch (err) {
      return consentError(err);
    }
  };
}

// OAuth2 RP-initiated logout: Hydra hands the browser here to end the OAuth2 session
// (hydra.yml urls.logout). Accept the challenge and resume to Hydra's post-logout redirect; the
// first-party POST /logout owns the Kratos session + our JWT cookie. Provider-only. GET-accept
// is safe (like the login/consent handlers): the challenge is Hydra-minted + single-use, so a
// forged GET can't fabricate one — we skip only the optional "confirm logout?".
function oauthLogout(hydra: HydraAdmin): BuiltinRoute["handler"] {
  return async (ctx: RequestContext): Promise<RouteResult> => {
    const challenge = ctx.url.searchParams.get("logout_challenge");
    if (!challenge) return { headers: TEXT_PLAIN, html: "Missing logout_challenge", status: 400 };
    try {
      const { redirect } = await hydra.acceptLogoutRequest(challenge);
      return { redirect };
    } catch (err) {
      // Stale/consumed challenge (Hydra 4xx) → recoverable 400; a genuine outage (5xx) → 500.
      if (err instanceof HydraError && err.status < 500) {
        return { headers: TEXT_PLAIN, html: "This logout request has expired. Please start again from the application you were signing out of.", status: 400 };
      }
      throw err;
    }
  };
}

// Login completion: where Kratos lands the browser after authenticating (kratos.yml). Mint our
// session JWT — read roles from Keto, project onto the identity, tokenize — and store it as the
// cookie; no active session bounces back to sign in.
function completeAuth(deps: { keto: KetoClient; kratosAdmin: KratosAdmin; kratosPublic: KratosPublic }, secureCookies: boolean): BuiltinRoute["handler"] {
  return async (ctx: RequestContext): Promise<RouteResult> => {
    const completed = await completeLogin(deps, ctx.req.headers.cookie);
    if (!completed) return { redirect: "/login" };
    ctx.res.appendHeader("set-cookie", sessionCookie(completed.jwt, { secure: secureCookies }));
    // Land on the deep link the user was headed to (return_to, validated host-relative so a
    // crafted ?return_to= can't make this an open redirect), else the gated dashboard.
    return { redirect: localPath(ctx.url.searchParams.get("return_to")) ?? "/dashboard" };
  };
}

// Logout: a state change, so a CSRF-guarded POST (the shell submits a form, not a GET link).
// Clear our local JWT and revoke the Kratos session — Kratos' own cookie lives on its origin, so
// redirect to its logout URL (it revokes the session, clears plainpages_session, then lands on
// /login per kratos.yml). No active session ⇒ just clear our cookie and go to /login.
function logout(kratos: KratosPublic, secureCookies: boolean): BuiltinRoute["handler"] {
  return async (ctx: RequestContext): Promise<RouteResult> => {
    const form = await readFormBody(ctx.req);
    if (!ctx.verifyCsrf(form.get(CSRF_FIELD))) {
      ctx.log.warn("csrf rejected", { path: ctx.url.pathname });
      return FORBIDDEN;
    }
    const flow = await kratos.createLogoutFlow(ctx.req.headers.cookie ? { cookie: ctx.req.headers.cookie } : {});
    ctx.res.appendHeader("set-cookie", clearSessionCookie({ secure: secureCookies }));
    ctx.log.info("logout", { sub: ctx.user?.id ?? "" });
    return { redirect: flow?.logoutUrl ?? "/login" };
  };
}

// Kratos' self-service error sink (kratos.yml flows.error.ui_url → /error). A flow that fails a
// security/expiry check redirects the browser here with ?id=<uuid>. Render a themed page with a
// path back into sign-in instead of the catch-all 404 ("Page not found") it used to hit. The
// canonical-host redirect prevents the common cause (a lost cross-host CSRF cookie); this is the
// honest fallback for any genuine flow error. The id is shown only for support reference.
const errorSink = (ctx: RequestContext): RouteResult =>
  ({ data: { id: ctx.url.searchParams.get("id"), title: "Sign-in problem" }, view: "error" });

export function buildAuthRoutes({ hydra, keto, kratos, kratosAdmin, menu, secureCookies }: AuthRouteDeps): BuiltinRoute[] {
  const routes: BuiltinRoute[] = [];
  if (kratos) {
    for (const [path, flowType] of Object.entries(AUTH_FLOWS)) {
      routes.push({ handler: flowPage(kratos, flowType, secureCookies), method: "GET", path });
    }
    routes.push({ handler: logout(kratos, secureCookies), method: "POST", path: "/logout" });
  }
  if (hydra && kratos) {
    const provider = { hydra, kratos };
    routes.push({ handler: oauthLogin(provider, secureCookies), method: "GET", path: "/oauth2/login" });
    routes.push({ handler: consentScreen(provider, menu.branding.name), method: "GET", path: "/oauth2/consent" });
    routes.push({ handler: consentDecision(provider), method: "POST", path: "/oauth2/consent" });
  }
  if (hydra) routes.push({ handler: oauthLogout(hydra), method: "GET", path: "/oauth2/logout" });
  if (kratos && kratosAdmin && keto) {
    routes.push({ handler: completeAuth({ keto, kratosAdmin, kratosPublic: kratos }, secureCookies), method: "GET", path: "/auth/complete" });
  }
  routes.push({ handler: errorSink, method: "GET", path: "/error" });
  return routes;
}
