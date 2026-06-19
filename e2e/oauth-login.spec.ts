import { expect, test } from "@playwright/test";

// Full-stack OAuth2 login + consent E2E (§6): another app logs in *through* plainpages. Hydra
// starts an authorization flow and hands the browser to web's /oauth2/login; web resolves it via
// the Kratos session and accepts, Hydra continues to web's /oauth2/consent, web shows the themed
// consent screen, and Allow drives Hydra to issue the authorization code. We drive the flow over
// HTTP (fetch, per-host cookie jars) because the browser hosts differ on the compose network; this
// exercises web's server-side challenge handling. The browser-UI login is owned by §8.
const WEB = process.env.BASE_URL ?? "http://web:3000";
const KRATOS = process.env.KRATOS_PUBLIC_URL ?? "http://kratos:4433";
const HYDRA_PUBLIC = process.env.HYDRA_PUBLIC_URL ?? "http://hydra:4444";
const HYDRA_ADMIN = process.env.HYDRA_ADMIN_URL ?? "http://hydra:4445";
const ADMIN_EMAIL = "admin@plainpages.local"; // seeded by bootstrap (§3)
const ADMIN_PASSWORD = "admin";

function setCookieLine(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}
function cookieValue(line: string): string {
  return line.split(";", 1)[0]!.slice(line.indexOf("=") + 1);
}
function relayCookies(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(";", 1)[0]!).filter((kv) => kv.split("=")[1] !== "").join("; ");
}

// Per-host cookie jar (the browser keeps Hydra's flow cookies separate from web's CSRF cookie).
type Jar = Map<string, string>;
function absorb(jar: Jar, res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const kv = line.split(";", 1)[0]!;
    const name = kv.slice(0, kv.indexOf("="));
    const value = kv.slice(kv.indexOf("=") + 1);
    if (value === "") jar.delete(name);
    else jar.set(name, value);
  }
}
const jarCookie = (jar: Jar): string => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
// Hydra's resume URLs carry its issuer host (127.0.0.1:4444), unreachable from the runner —
// rebase onto the compose-network host so we can follow them.
function onHydra(url: string): string {
  const u = new URL(url);
  const host = new URL(HYDRA_PUBLIC);
  u.protocol = host.protocol;
  u.host = host.host;
  return u.toString();
}

// Register a confidential OAuth2 client (admin API) so we can start an authorization flow.
async function createClient(): Promise<string> {
  const res = await fetch(`${HYDRA_ADMIN}/admin/clients`, {
    body: JSON.stringify({
      client_name: "e2e-login",
      grant_types: ["authorization_code"],
      redirect_uris: ["http://127.0.0.1:3000/callback"],
      response_types: ["code"],
      scope: "openid offline",
      token_endpoint_auth_method: "client_secret_post",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = await res.json().catch(() => null);
  expect(res.status, `create client: ${JSON.stringify(body)}`).toBe(201);
  return body.client_id;
}

// Hit Hydra's authorization endpoint; it redirects to web's login URL carrying a login_challenge.
// `jar` (when given) absorbs Hydra's flow cookies, needed to follow the login/consent verifiers.
async function startAuthFlow(clientId: string, jar?: Jar): Promise<string> {
  const auth = new URL(`${HYDRA_PUBLIC}/oauth2/auth`);
  auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: "http://127.0.0.1:3000/callback", response_type: "code", scope: "openid", state: "0123456789abcdef0123456789abcdef" }).toString();
  const res = await fetch(auth, { redirect: "manual" });
  if (jar) absorb(jar, res);
  expect([302, 303], `auth flow start: ${res.status}`).toContain(res.status);
  const location = res.headers.get("location") ?? "";
  expect(location, "Hydra redirects to our login URL").toContain("/oauth2/login");
  const challenge = new URL(location).searchParams.get("login_challenge");
  expect(challenge, "carries a login_challenge").toBeTruthy();
  return challenge!;
}

// Authenticate the seeded admin via Kratos' browser login flow; return its session cookie value.
async function kratosLogin(): Promise<string> {
  const init = await fetch(`${KRATOS}/self-service/login/browser`, { headers: { accept: "application/json" } });
  const flow = await init.json();
  const csrf = flow.ui.nodes.find((n: { attributes?: { name?: string } }) => n.attributes?.name === "csrf_token");
  const submit = await fetch(flow.ui.action, {
    body: JSON.stringify({ csrf_token: csrf?.attributes?.value ?? "", identifier: ADMIN_EMAIL, method: "password", password: ADMIN_PASSWORD }),
    headers: { accept: "application/json", "content-type": "application/json", cookie: relayCookies(init) },
    method: "POST",
    redirect: "manual",
  });
  expect(submit.status, `login submit: ${await submit.text()}`).toBe(200);
  return cookieValue(setCookieLine(submit, "plainpages_session")!);
}

test("Hydra login challenge: an unauthenticated user bounces to /login, an authenticated one is accepted", async () => {
  test.setTimeout(60_000);

  const challenge = await startAuthFlow(await createClient());
  const loginUrl = `${WEB}/oauth2/login?login_challenge=${challenge}`;

  // 1. No Kratos session → web bounces to the themed login, carrying a return_to back to the challenge.
  const anon = await fetch(loginUrl, { redirect: "manual" });
  expect(anon.status).toBe(303);
  const bounce = anon.headers.get("location") ?? "";
  expect(bounce).toMatch(/^\/login\?return_to=/);
  expect(decodeURIComponent(bounce.split("return_to=")[1]!)).toMatch(/\/oauth2\/login\?login_challenge=/);

  // 2. With a live Kratos session → web accepts the challenge; Hydra hands back a resume URL.
  const session = await kratosLogin();
  const accepted = await fetch(loginUrl, { headers: { cookie: `plainpages_session=${session}` }, redirect: "manual" });
  expect(accepted.status).toBe(303);
  const resume = accepted.headers.get("location") ?? "";
  expect(resume, "accepted → back to Hydra's /oauth2/auth to continue").toContain("/oauth2/auth");
  expect(resume, "carries Hydra's login_verifier").toContain("login_verifier");
});

test("Hydra consent challenge: web shows the third-party consent screen; Allow → authorization code", async () => {
  test.setTimeout(60_000);
  const hydra: Jar = new Map(); // Hydra's flow cookies, needed to follow the verifiers
  const web: Jar = new Map(); // web's CSRF cookie

  // Log in and accept the login challenge → Hydra resume URL (as in the login test).
  const challenge = await startAuthFlow(await createClient(), hydra);
  const session = await kratosLogin();
  const accepted = await fetch(`${WEB}/oauth2/login?login_challenge=${challenge}`, { headers: { cookie: `plainpages_session=${session}` }, redirect: "manual" });
  expect(accepted.status).toBe(303);

  // Follow the login_verifier through Hydra → web's /oauth2/consent?consent_challenge=…
  const toConsent = await fetch(onHydra(accepted.headers.get("location") ?? ""), { headers: { cookie: jarCookie(hydra) }, redirect: "manual" });
  absorb(hydra, toConsent);
  const consentLoc = toConsent.headers.get("location") ?? "";
  expect(consentLoc, `→ web consent (${toConsent.status})`).toContain("/oauth2/consent");
  const consentChallenge = new URL(consentLoc).searchParams.get("consent_challenge")!;

  // web shows the themed consent screen for this third-party client, listing the requested scope.
  const screen = await fetch(`${WEB}/oauth2/consent?consent_challenge=${consentChallenge}`, { headers: { cookie: `plainpages_session=${session}` }, redirect: "manual" });
  expect(screen.status).toBe(200);
  absorb(web, screen);
  const html = await screen.text();
  expect(html).toContain("Authorize e2e-login");
  expect(html).toContain("openid");
  expect(html, "names the signed-in account so consent is informed").toContain(`Signed in as <strong>${ADMIN_EMAIL}`);
  const csrf = html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  expect(csrf, "consent form carries a CSRF token").toBeTruthy();

  // Allow → web accepts the consent → Hydra resume URL with a consent_verifier.
  const allow = await fetch(`${WEB}/oauth2/consent`, {
    body: new URLSearchParams({ _csrf: csrf!, consent_challenge: consentChallenge, decision: "allow" }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${jarCookie(web)}; plainpages_session=${session}` },
    method: "POST",
    redirect: "manual",
  });
  expect(allow.status, `allow consent: ${await allow.clone().text()}`).toBe(303);
  const consentResume = allow.headers.get("location") ?? "";
  expect(consentResume, "carries Hydra's consent_verifier").toContain("consent_verifier");

  // Follow the consent_verifier through Hydra → the client callback with an authorization code.
  const toCallback = await fetch(onHydra(consentResume), { headers: { cookie: jarCookie(hydra) }, redirect: "manual" });
  const callback = toCallback.headers.get("location") ?? "";
  expect(callback, `→ client callback (${toCallback.status})`).toContain("/callback");
  expect(new URL(callback).searchParams.get("code"), "an authorization code is issued").toBeTruthy();
});
