// The plugin author surface (todo §7) — the ONE module a plugin imports. It re-exports exactly the
// stable contract: definePlugin + the manifest/handler types, the RequestContext, the auth guards,
// and the request-body/CSRF/list-query helpers the blessed pattern needs. This barrel *is* the
// contract boundary in code — the host may refactor any other src/* freely as long as it holds, so
// a plugin should import from here, never reach into deeper modules. See docs/plugin-contract.md.

export { definePlugin } from "./plugin.ts";
export type { HttpMethod, Plugin, PluginHooks, PluginManifest, PermissionDecl, Route, RouteHandler, RouteResult } from "./plugin.ts";
export type { RequestContext, User } from "./context.ts";
export type { PageChrome } from "./chrome.ts";
export type { NavNode } from "./nav.ts";
export { can, check, GuardError, requireSession } from "./guards.ts";
export { parseListQuery } from "./list-query.ts";
export { readFormBody } from "./body.ts";
export { CSRF_FIELD } from "./csrf.ts";
