// The host's internal route table: each built-in endpoint (the auth/OAuth2 group, the landing
// slots, /error) is a named handler with the plugin RouteHandler shape, plus the request's CSRF
// mint (host-only — a plugin reads the token via ctx.chrome instead). app.ts matches this table
// after plugin routes — exact path, a GET route also answering HEAD like the plugin router — and
// sends the result against the core views, or against the owning plugin's where it is a PluginOwned.
import type { Gate } from "../auth/gate.ts";
import type { RequestContext } from "./context.ts";
import type { RouteResult } from "../plugin-host/plugin.ts";

// The request's CSRF token for first-party forms, bound by the host: `token` renders into a
// hidden field; `setCookie()` Set-Cookies it iff it was freshly minted this request — call it on
// every page-emitting response so the form's double-submit cookie exists.
export interface RequestCsrf {
  setCookie(): void;
  token: string;
}

// A context scoped to a plugin: same request, but `t` reads that plugin's catalog first. The
// landing slots run a plugin's handler, so they must hand it one of these rather than the host's
// own context — otherwise the plugin's keys render as bare keys on the pages it owns.
export type PluginContextFactory = (pluginId: string) => RequestContext;

// A landing slot's result when a plugin owns it: the host renders it against that plugin's views
// on `ctx`, and shows it to the response hooks like a plugin route's result.
export interface PluginOwned {
  ctx: RequestContext; // the owner's own context, from PluginContextFactory
  pluginId: string;
  result: RouteResult | null;
}

export interface BuiltinRoute extends Gate {
  // Returns a RouteResult, or null when the handler wrote to ctx.res itself.
  handler: (ctx: RequestContext, csrf: RequestCsrf, contextFor: PluginContextFactory) => Promise<RouteResult | PluginOwned | null> | RouteResult | PluginOwned | null;
  method: "GET" | "POST"; // a GET route also answers HEAD, like plugin routes
  path: string; // exact pathname
}

export function matchBuiltinRoute(routes: BuiltinRoute[], method: string, pathname: string): BuiltinRoute | undefined {
  return routes.find((r) => r.path === pathname && (r.method === method || (r.method === "GET" && method === "HEAD")));
}
