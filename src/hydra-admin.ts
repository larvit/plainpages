// Hydra admin-API client (todo §6): typed `fetch` wrappers over Ory Hydra's OAuth2 admin
// endpoints (internal admin port) — the login/consent challenge handshake other apps log in
// *through* us with. Built-in `fetch` only, no SDK dep (AGENTS.md); `fetchImpl`-injectable
// like the kratos/keto clients. We authenticate the user (login) and grant scopes (consent);
// Hydra mints the tokens.

export interface OAuth2Client {
  client_id?: string;
  client_name?: string;
  metadata?: Record<string, unknown>; // arbitrary client metadata; `first_party: true` ⇒ auto-consent (§6)
}

// A login request Hydra hands us at /oauth2/login. `skip` ⇒ Hydra already authenticated this
// subject (honour it, don't re-prompt); otherwise we authenticate via the Kratos session.
export interface LoginRequest {
  challenge: string;
  client?: OAuth2Client;
  request_url?: string;
  requested_scope?: string[];
  skip: boolean;
  subject: string;
}

export interface AcceptLogin {
  acr?: string;
  remember?: boolean;
  remember_for?: number; // seconds; 0 ⇒ for the browser-session lifetime
  subject: string;
}

// A consent request Hydra hands us at /oauth2/consent. `skip` ⇒ already consented (or a
// skip-consent client); else we show the scope screen (or auto-accept a first-party client).
export interface ConsentRequest {
  challenge: string;
  client?: OAuth2Client;
  request_url?: string;
  requested_access_token_audience?: string[];
  requested_scope?: string[];
  skip: boolean;
  subject: string;
}

// OIDC claims surfaced to the client: id_token (always) / access_token (introspection only).
export interface ConsentSession {
  access_token?: Record<string, unknown>;
  id_token?: Record<string, unknown>;
}

export interface AcceptConsent {
  grant_access_token_audience?: string[];
  grant_scope?: string[];
  remember?: boolean;
  remember_for?: number; // seconds; 0 ⇒ for the browser-session lifetime
  session?: ConsentSession;
}

export interface RejectRequest {
  error?: string;
  error_description?: string;
}

// Hydra's answer to an accept/reject: the URL to send the browser to, to resume the flow.
export interface Completed {
  redirect: string;
}

// Carries the HTTP status so a caller can branch (parallels KratosError/KetoError).
export class HydraError extends Error {
  body: string;
  status: number;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.body = body;
    this.name = "HydraError";
    this.status = status;
  }
}

export interface HydraAdmin {
  acceptConsentRequest(challenge: string, body: AcceptConsent): Promise<Completed>;
  acceptLoginRequest(challenge: string, body: AcceptLogin): Promise<Completed>;
  getConsentRequest(challenge: string): Promise<ConsentRequest>;
  getLoginRequest(challenge: string): Promise<LoginRequest>;
  rejectConsentRequest(challenge: string, body: RejectRequest): Promise<Completed>;
  rejectLoginRequest(challenge: string, body: RejectRequest): Promise<Completed>;
}

export function createHydraAdmin(config: { baseUrl: string; fetchImpl?: typeof fetch }): HydraAdmin {
  const base = config.baseUrl.replace(/\/+$/, "");
  const http = config.fetchImpl ?? fetch;
  const json = { "content-type": "application/json" };
  // Hydra keys the login/consent handshake off a ?login_challenge=/?consent_challenge= query.
  const reqUrl = (kind: "consent" | "login", challenge: string, action = "") =>
    `${base}/admin/oauth2/auth/requests/${kind}${action}?${kind}_challenge=${encodeURIComponent(challenge)}`;

  async function fail(action: string, res: Response): Promise<never> {
    throw new HydraError(`Hydra admin ${action} failed (${res.status})`, res.status, await res.text());
  }
  async function complete(action: string, res: Response): Promise<Completed> {
    if (res.status !== 200) return fail(action, res);
    return { redirect: ((await res.json()) as { redirect_to: string }).redirect_to };
  }

  const put = (action: string, url: string, body: unknown) =>
    http(url, { body: JSON.stringify(body), headers: json, method: "PUT" }).then((r) => complete(action, r));

  return {
    async acceptConsentRequest(challenge, body) {
      return put("accept consent", reqUrl("consent", challenge, "/accept"), body);
    },

    async acceptLoginRequest(challenge, body) {
      return put("accept login", reqUrl("login", challenge, "/accept"), body);
    },

    async getConsentRequest(challenge) {
      const res = await http(reqUrl("consent", challenge));
      if (res.status !== 200) return fail("get consent request", res);
      return (await res.json()) as ConsentRequest;
    },

    async getLoginRequest(challenge) {
      const res = await http(reqUrl("login", challenge));
      if (res.status !== 200) return fail("get login request", res);
      return (await res.json()) as LoginRequest;
    },

    async rejectConsentRequest(challenge, body) {
      return put("reject consent", reqUrl("consent", challenge, "/reject"), body);
    },

    async rejectLoginRequest(challenge, body) {
      return put("reject login", reqUrl("login", challenge, "/reject"), body);
    },
  };
}
