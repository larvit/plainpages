// Plugin lifecycle hooks: the host invokes the optional PluginHooks a plugin may declare
// (README.md → Hooks). No sandbox — a throwing hook fails loud (boot for onBoot, the
// request for the others). Hooks run in discovery order (plugins sorted by id). app.ts skips these
// entirely when no plugin declares the hook, so the no-hooks hot path stays free.

import type { RequestContext } from "../http/context.ts";
import type { Plugin, RouteResult } from "./plugin.ts";

// After discovery, before the server listens. A throw aborts boot.
export async function runBootHooks(plugins: Plugin[]): Promise<void> {
  for (const plugin of plugins) await plugin.hooks?.onBoot?.();
}

// Before route matching. The first hook to return a RouteResult short-circuits the request — its
// result becomes the response and later hooks + the route handler are skipped. Returns that result
// with its owning plugin (so a `view` result resolves against that plugin's views), or null to proceed.
export async function runRequestHooks(plugins: Plugin[], ctx: RequestContext): Promise<{ plugin: Plugin; result: RouteResult } | null> {
  for (const plugin of plugins) {
    const result = await plugin.hooks?.onRequest?.(ctx);
    if (result != null) return { plugin, result };
  }
  return null;
}

// After a route handler produces its result. Observers only — the return value is ignored, so a
// hook cannot change the response; a throw fails the request.
export async function runResponseHooks(plugins: Plugin[], ctx: RequestContext, result: RouteResult | null): Promise<void> {
  for (const plugin of plugins) await plugin.hooks?.onResponse?.(ctx, result);
}
