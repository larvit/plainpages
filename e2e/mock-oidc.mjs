// Mock OIDC provider for the SSO browser E2E (todo §8) — a stand-in for Google/etc. so the test
// never leaves the compose network. Auto-approves /authorize (no provider login UI), then signs an
// RS256 id_token Kratos verifies against /jwks. stdlib only, in-memory, NOT app code. The single
// host (mock-oidc:9000) is reachable by both the browser (/authorize) and Kratos (token/jwks).
import { createServer } from "node:http";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";

const ISSUER = process.env.ISSUER ?? "http://mock-oidc:9000";
const CLIENT_ID = process.env.CLIENT_ID ?? "plainpages-e2e";
const EMAIL = process.env.SSO_EMAIL ?? "sso-user@plainpages.local";
const PORT = Number(process.env.PORT ?? 9000);
const KID = "mock-1";

// One signing key for the process; its public half is published at /jwks for Kratos to verify with.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), alg: "RS256", kid: KID, use: "sig" };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(nonce) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", kid: KID, typ: "JWT" });
  const payload = b64({
    aud: CLIENT_ID, email: EMAIL, email_verified: true, exp: now + 600, family_name: "User",
    given_name: "SSO", iat: now, iss: ISSUER, name: "SSO User", nonce, sub: "mock-subject-1",
  });
  const sig = createSign("RSA-SHA256").update(`${header}.${payload}`).end().sign(privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

const codes = new Map(); // single-use auth code → the nonce Kratos sent (echoed into the id_token)
const json = (res, body) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

createServer((req, res) => {
  const url = new URL(req.url ?? "/", ISSUER);
  const p = url.pathname;

  if (p === "/.well-known/openid-configuration") {
    return json(res, {
      authorization_endpoint: `${ISSUER}/authorize`, id_token_signing_alg_values_supported: ["RS256"],
      issuer: ISSUER, jwks_uri: `${ISSUER}/jwks`, response_types_supported: ["code"],
      scopes_supported: ["openid", "email"], subject_types_supported: ["public"],
      token_endpoint: `${ISSUER}/token`, userinfo_endpoint: `${ISSUER}/userinfo`,
    });
  }
  if (p === "/jwks") return json(res, { keys: [jwk] });

  // Auto-approve: no login screen — mint a code bound to Kratos' nonce and bounce to the redirect_uri.
  if (p === "/authorize") {
    const code = randomUUID();
    codes.set(code, url.searchParams.get("nonce") ?? "");
    const back = new URL(url.searchParams.get("redirect_uri") ?? `${ISSUER}/`);
    back.searchParams.set("code", code);
    const state = url.searchParams.get("state");
    if (state) back.searchParams.set("state", state);
    res.writeHead(302, { location: back.toString() }).end();
    return;
  }

  if (p === "/token" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const code = new URLSearchParams(body).get("code") ?? "";
      const nonce = codes.get(code) ?? "";
      codes.delete(code);
      json(res, { access_token: randomUUID(), expires_in: 600, id_token: idToken(nonce), token_type: "Bearer" });
    });
    return;
  }

  if (p === "/userinfo") {
    return json(res, { email: EMAIL, email_verified: true, family_name: "User", given_name: "SSO", name: "SSO User", sub: "mock-subject-1" });
  }

  res.writeHead(404, { "content-type": "text/plain" }).end("not found");
}).listen(PORT, () => console.log(`mock-oidc on :${PORT} (issuer ${ISSUER})`));
