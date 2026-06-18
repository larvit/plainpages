import { expect, test } from "@playwright/test";

// Full-stack auth E2E: token timeout + silent re-mint ("stay signed in", §4). Runs against the
// real Ory stack via compose.e2e-auth.yml, where the session→JWT TTL is shortened to 8s and the
// web clock skew is 0 — so the ~10m token lapses in seconds and the hot path re-mints it from the
// still-live Kratos session. We drive the flow over HTTP (fetch, manual cookies) because Kratos
// and web sit on different hosts here; web's own server-side cookie relay is what we exercise.
// The browser-UI login is owned by §8; this proves the timeout/refresh server behaviour end-to-end.
const WEB = process.env.BASE_URL ?? "http://web:3000";
const KRATOS = process.env.KRATOS_PUBLIC_URL ?? "http://kratos:4433";
const KRATOS_ADMIN = process.env.KRATOS_ADMIN_URL ?? "http://kratos:4434";
const ADMIN_EMAIL = "admin@plainpages.local"; // seeded by bootstrap (§3); admin role granted in Keto
const ADMIN_PASSWORD = "admin";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// The full Set-Cookie line for `name`, or undefined. (cleared cookies carry Max-Age=0 + empty value.)
function setCookieLine(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}
function cookieValue(line: string): string {
  return line.split(";", 1)[0]!.slice(line.indexOf("=") + 1);
}
// Build a "name=value; …" Cookie header from a response's Set-Cookie lines (skips cleared ones).
function relayCookies(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";", 1)[0]!)
    .filter((kv) => kv.split("=")[1] !== "")
    .join("; ");
}
// Read a JWT's claims without verifying (web already verified it; we only inspect exp/roles).
function jwtClaims(jwt: string): { email: string; exp: number; roles: string[]; sub: string } {
  return JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
}

// Authenticate the seeded admin via Kratos' browser login flow (JSON), return its session cookie value.
async function kratosLogin(): Promise<string> {
  const init = await fetch(`${KRATOS}/self-service/login/browser`, { headers: { accept: "application/json" } });
  expect(init.ok, `init login flow: ${init.status}`).toBeTruthy();
  const flow = await init.json();
  const csrf = flow.ui.nodes.find((n: { attributes?: { name?: string } }) => n.attributes?.name === "csrf_token");
  const submit = await fetch(flow.ui.action, {
    body: JSON.stringify({ csrf_token: csrf?.attributes?.value ?? "", identifier: ADMIN_EMAIL, method: "password", password: ADMIN_PASSWORD }),
    headers: { accept: "application/json", "content-type": "application/json", cookie: relayCookies(init) },
    method: "POST",
    redirect: "manual",
  });
  expect(submit.status, `login submit: ${await submit.text()}`).toBe(200);
  const session = setCookieLine(submit, "plainpages_session");
  expect(session, "Kratos sets the session cookie on login").toBeTruthy();
  return cookieValue(session!);
}

// Hit web's home with the given cookies (no redirect-follow so we can read its Set-Cookie).
function hitWeb(session: string, jwt: string): Promise<Response> {
  return fetch(`${WEB}/`, { headers: { cookie: `plainpages_session=${session}; plainpages_jwt=${jwt}` }, redirect: "manual" });
}

// Poll web until it (re-)sets plainpages_jwt — i.e. the token has lapsed and the hot path acted:
// a live session re-mints a fresh token; a dead one clears the cookie.
async function awaitJwtSetCookie(session: string, jwt: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const line = setCookieLine(await hitWeb(session, jwt), "plainpages_jwt");
    if (line) return line;
    await sleep(1000);
  }
  throw new Error("timed out waiting for web to act on the expired token");
}

test("an expired session JWT is silently re-minted while Kratos lives, then cleared once it dies", async () => {
  test.setTimeout(90_000); // two short-TTL windows (8s each) + Ory round-trips

  // 1. Log in for real, then complete login on web → our session JWT (roles read from Keto).
  const session = await kratosLogin();
  const complete = await fetch(`${WEB}/auth/complete`, { headers: { cookie: `plainpages_session=${session}` }, redirect: "manual" });
  expect(complete.status, "auth/complete redirects home").toBe(303);
  const jwt1Line = setCookieLine(complete, "plainpages_jwt");
  expect(jwt1Line, "auth/complete sets our session JWT").toBeTruthy();
  const jwt1 = cookieValue(jwt1Line!);

  const claims1 = jwtClaims(jwt1);
  expect(claims1.email).toBe(ADMIN_EMAIL);
  expect(claims1.sub, "sub is the Kratos identity id").toBeTruthy();
  expect(claims1.roles, "roles are projected from Keto").toContain("admin");

  // 2. Token timeout → refresh: once the 8s TTL lapses, the next request re-mints a fresh JWT.
  const jwt2Line = await awaitJwtSetCookie(session, jwt1);
  const jwt2 = cookieValue(jwt2Line!);
  expect(jwt2, "a different token was minted").not.toBe(jwt1);
  const claims2 = jwtClaims(jwt2);
  expect(claims2.exp, "the new token expires later").toBeGreaterThan(claims1.exp);
  expect(claims2.roles, "re-mint re-reads roles from Keto").toContain("admin");

  // 3. Kill the Kratos session: now the lapsed token cannot refresh — the cookie is cleared.
  const revoke = await fetch(`${KRATOS_ADMIN}/admin/identities/${claims1.sub}/sessions`, { method: "DELETE" });
  expect([204, 404]).toContain(revoke.status);

  const clearedLine = await awaitJwtSetCookie(session, jwt2);
  expect(cookieValue(clearedLine), "the stale JWT cookie is emptied").toBe("");
  expect(clearedLine, "and expired (Max-Age=0)").toMatch(/Max-Age=0/i);
});
