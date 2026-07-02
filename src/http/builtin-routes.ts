// The host's internal route table: each built-in endpoint (the auth/OAuth2 group, the landing
// slots, /error) is a named handler with the plugin RouteHandler shape, plus the request's CSRF
// mint (host-only — a plugin reads the token via ctx.chrome instead). app.ts matches this table
// after plugin routes — exact path, a GET route also answering HEAD like the plugin router — and
// pipes the result through sendResult against the core views.
import type { RequestContext } from "./context.ts";
import type { RouteResult } from "../plugin-host/plugin.ts";

// The request's CSRF token for first-party forms, bound by the host: `token` renders into a
// hidden field; `setCookie()` Set-Cookies it iff it was freshly minted this request — call it on
// every page-emitting response so the form's double-submit cookie exists.
export interface RequestCsrf {
  setCookie(): void;
  token: string;
}

export interface BuiltinRoute {
  // Returns a RouteResult, or null when the handler wrote to ctx.res itself
  // (the landing slots dispatch a plugin's own result against that plugin's views).
  handler: (ctx: RequestContext, csrf: RequestCsrf) => Promise<RouteResult | null> | RouteResult | null;
  method: "GET" | "POST"; // a GET route also answers HEAD, like plugin routes
  path: string; // exact pathname
}

export function matchBuiltinRoute(routes: BuiltinRoute[], method: string, pathname: string): BuiltinRoute | undefined {
  return routes.find((r) => r.path === pathname && (r.method === method || (r.method === "GET" && method === "HEAD")));
}
