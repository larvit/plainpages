// Plugin lifecycle hooks: the host invokes the optional PluginHooks a plugin may declare
// (README.md → Hooks). No sandbox — a throwing hook fails loud (boot for onBoot, the
// request for the others). Hooks run in discovery order (plugins sorted by id). app.ts skips these
// entirely when no plugin declares the hook, so the no-hooks hot path stays free.

import type { RequestContext } from "../http/context.ts";
import type { BootContext, Plugin, RouteResult } from "./plugin.ts";

// After discovery, before the server listens. A throw aborts boot. Each hook gets a context built
// for its own plugin, so one plugin is never handed another's storage credentials.
export async function runBootHooks(plugins: Plugin[], bootContextFor: (plugin: Plugin) => BootContext): Promise<void> {
  for (const plugin of plugins) {
    const onBoot = plugin.hooks?.onBoot;
    if (onBoot) await onBoot(bootContextFor(plugin));
  }
}

// Before route matching. The first hook to return a RouteResult short-circuits the request — its
// result becomes the response and later hooks + the route handler are skipped. Returns that result
// with its owning plugin (so a `view` result resolves against that plugin's views), or null to
// proceed. Each hook gets a context scoped to its own plugin, so `ctx.t` reads that plugin's catalog.
export async function runRequestHooks(
  plugins: Plugin[],
  contextFor: (pluginId: string) => RequestContext,
): Promise<{ ctx: RequestContext; plugin: Plugin; result: RouteResult } | null> {
  for (const plugin of plugins) {
    if (!plugin.hooks?.onRequest) continue;
    const ctx = contextFor(plugin.id);
    const result = await plugin.hooks.onRequest(ctx);
    if (result != null) return { ctx, plugin, result };
  }
  return null;
}

// After a route handler produces its result. Observers only — the return value is ignored, so a
// hook cannot change the response; a throw fails the request. Each observer gets a context scoped to
// its own plugin, like onRequest, so `ctx.t` is never another plugin's translator.
export async function runResponseHooks(
  plugins: Plugin[],
  contextFor: (pluginId: string) => RequestContext,
  result: RouteResult | null,
): Promise<void> {
  for (const plugin of plugins) {
    if (plugin.hooks?.onResponse) await plugin.hooks.onResponse(contextFor(plugin.id), result);
  }
}
