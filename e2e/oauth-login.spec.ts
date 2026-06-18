import { expect, test } from "@playwright/test";

// Full-stack OAuth2 login-challenge E2E (§6): another app logs in *through* plainpages. Hydra
// starts an authorization flow and hands the browser to web's /oauth2/login; web resolves it via
// the Kratos session and accepts (Hydra then continues to consent + token issuance). We drive the
// flow over HTTP (fetch, manual cookies) because the browser hosts differ on the compose network;
// this exercises web's server-side challenge handling. The browser-UI login is owned by §8.
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
async function startAuthFlow(clientId: string): Promise<string> {
  const auth = new URL(`${HYDRA_PUBLIC}/oauth2/auth`);
  auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: "http://127.0.0.1:3000/callback", response_type: "code", scope: "openid", state: "0123456789abcdef0123456789abcdef" }).toString();
  const res = await fetch(auth, { redirect: "manual" });
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
