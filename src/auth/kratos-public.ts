// Kratos public-API client: typed `fetch` wrappers over Ory Kratos' public
// endpoints — self-service flow init/get/submit, browser logout, session `whoami`, and the
// session→JWT tokenizer (`whoami?tokenize_as`). Built-in `fetch` only, no SDK dep (AGENTS.md).
// Flow `ui.nodes` types stay loose — rendering + field-error mapping is flow-view.ts's job.

export type FlowType = "login" | "recovery" | "registration" | "settings" | "verification";

export interface UiText {
  context?: Record<string, unknown>;
  id: number;
  text: string;
  type: string;
}

export interface UiNode {
  attributes: Record<string, unknown>;
  group: string;
  messages: UiText[];
  meta: { label?: UiText };
  type: string;
}

export interface FlowUi {
  action: string; // absolute Kratos URL the browser POSTs the form to (Kratos owns its CSRF)
  messages?: UiText[];
  method: string;
  nodes: UiNode[];
}

export interface Flow {
  id: string;
  type?: string;
  ui: FlowUi;
}

export interface Session {
  active?: boolean;
  expires_at?: string;
  identity?: { id: string; metadata_public?: unknown; traits?: Record<string, unknown> }; // whoami strips metadata_admin
  tokenized?: string; // the signed JWT — present only when `tokenize_as` was requested
}

export interface FlowInit {
  flow: Flow;
  setCookie: string[]; // Kratos' CSRF cookie(s) to relay to the browser
}

export interface LogoutFlow {
  logoutToken: string; // CSRF token Kratos embeds in logoutUrl
  logoutUrl: string; // send the browser here to revoke the session + clear Kratos' cookie
}

export interface FlowSubmission {
  location: string | null; // where Kratos sends the browser next
  setCookie: string[];
  status: number;
}

// Carries the HTTP status so a caller can branch — e.g. re-init on an expired flow (404/410).
export class KratosError extends Error {
  body: string;
  status: number;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.body = body;
    this.name = "KratosError";
    this.status = status;
  }
}

export interface KratosPublic {
  createLogoutFlow(opts?: { cookie?: string }): Promise<LogoutFlow | null>; // null ⇒ no active session (401)
  getFlow(type: FlowType, id: string, opts?: { cookie?: string }): Promise<Flow>;
  initBrowserFlow(type: FlowType, opts?: { cookie?: string; returnTo?: string }): Promise<FlowInit>;
  submitFlow(type: FlowType, flowId: string, opts: { body: string; cookie?: string }): Promise<FlowSubmission>;
  whoami(opts?: { cookie?: string; tokenizeAs?: string }): Promise<Session | null>;
}

export function createKratosPublic(config: { baseUrl: string; fetchImpl?: typeof fetch }): KratosPublic {
  const base = config.baseUrl.replace(/\/+$/, "");
  const http = config.fetchImpl ?? fetch;

  // Forward the browser cookie + ask for JSON, so Kratos returns the flow/session instead
  // of redirecting an API caller.
  function headers(cookie?: string): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json" };
    if (cookie) h["cookie"] = cookie;
    return h;
  }

  return {
    async createLogoutFlow(opts = {}) {
      // Browser logout: get the logout URL (carrying a CSRF token) to send the browser to.
      const res = await http(new URL(`${base}/self-service/logout/browser`), { headers: headers(opts.cookie), redirect: "manual" });
      if (res.status === 401) return null; // no active session to revoke
      if (res.status !== 200) throw new KratosError(`Kratos logout flow failed (${res.status})`, res.status, await res.text());
      const body = (await res.json()) as { logout_token: string; logout_url: string };
      return { logoutToken: body.logout_token, logoutUrl: body.logout_url };
    },

    async initBrowserFlow(type, opts = {}) {
      const url = new URL(`${base}/self-service/${type}/browser`);
      if (opts.returnTo) url.searchParams.set("return_to", opts.returnTo);
      const res = await http(url, { headers: headers(opts.cookie), redirect: "manual" });
      if (res.status !== 200) throw new KratosError(`Kratos init ${type} flow failed (${res.status})`, res.status, await res.text());
      return { flow: (await res.json()) as Flow, setCookie: res.headers.getSetCookie() };
    },

    async getFlow(type, id, opts = {}) {
      const url = new URL(`${base}/self-service/${type}/flows`);
      url.searchParams.set("id", id);
      const res = await http(url, { headers: headers(opts.cookie) });
      if (res.status !== 200) throw new KratosError(`Kratos get ${type} flow failed (${res.status})`, res.status, await res.text());
      return (await res.json()) as Flow;
    },

    async submitFlow(type, flowId, opts) {
      const url = new URL(`${base}/self-service/${type}`);
      url.searchParams.set("flow", flowId);
      // Asked for HTML, Kratos answers with the redirects a browser posting to it directly gets, so
      // every success/error/expiry branch stays Kratos'. Its nosurf demands a Referer, which this
      // POST lacks, only on an https request: valid while KRATOS_PUBLIC_URL is in-cluster http.
      const h = { ...headers(opts.cookie), accept: "text/html", "content-type": "application/x-www-form-urlencoded" };
      const res = await http(url, { body: opts.body, headers: h, method: "POST", redirect: "manual" });
      if (res.status >= 500) throw new KratosError(`Kratos submit ${type} flow failed (${res.status})`, res.status, await res.text());
      await res.body?.cancel();
      return { location: res.headers.get("location"), setCookie: res.headers.getSetCookie(), status: res.status };
    },

    async whoami(opts = {}) {
      const url = new URL(`${base}/sessions/whoami`);
      if (opts.tokenizeAs) url.searchParams.set("tokenize_as", opts.tokenizeAs);
      const res = await http(url, { headers: headers(opts.cookie) });
      if (res.status === 401) return null; // no/expired session
      if (res.status !== 200) throw new KratosError(`Kratos whoami failed (${res.status})`, res.status, await res.text());
      return (await res.json()) as Session;
    },
  };
}
