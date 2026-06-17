// Kratos public-API client (todo §4): typed `fetch` wrappers over Ory Kratos' public
// endpoints — self-service flow init/get/submit, session `whoami`, and the session→JWT
// tokenizer (`whoami?tokenize_as`). Built-in `fetch` only, no SDK dep (AGENTS.md). The
// themed flow pages and login completion (§4) build on this; rendering flow `ui.nodes`
// and mapping field errors is the renderer's job (§4), so we keep those types loose.

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
  identity?: { id: string; metadata_admin?: unknown; traits?: Record<string, unknown> };
  tokenized?: string; // the signed JWT — present only when `tokenize_as` was requested
}

export interface FlowInit {
  flow: Flow;
  setCookie: string[]; // Kratos' CSRF cookie(s) to relay to the browser
}

export interface FlowSubmission {
  body: unknown; // parsed JSON: the re-rendered flow on 400, the success payload on 200
  location: string | null; // redirect target (Location header, or a 422 redirect_browser_to)
  ok: boolean; // status === 200
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
  getFlow(type: FlowType, id: string, opts?: { cookie?: string }): Promise<Flow>;
  initBrowserFlow(type: FlowType, opts?: { cookie?: string; returnTo?: string }): Promise<FlowInit>;
  submitFlow(action: string, opts: { body: string; contentType?: string; cookie?: string }): Promise<FlowSubmission>;
  whoami(opts?: { cookie?: string; tokenizeAs?: string }): Promise<Session | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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

    async submitFlow(action, opts) {
      const h = headers(opts.cookie);
      h["content-type"] = opts.contentType ?? "application/x-www-form-urlencoded";
      // Manual redirect so we can read a 303 Location instead of following it server-side.
      const res = await http(action, { body: opts.body, headers: h, method: "POST", redirect: "manual" });
      const body = parseBody(await res.text());
      const location =
        res.headers.get("location") ??
        (isRecord(body) && typeof body["redirect_browser_to"] === "string" ? body["redirect_browser_to"] : null);
      return { body, location, ok: res.status === 200, setCookie: res.headers.getSetCookie(), status: res.status };
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
