// The plugin author surface — the ONE module a plugin imports. It re-exports exactly the
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
// Sanitise an untrusted URL (upstream/user data) before rendering it in an href/src — partials
// escape text but not URL schemes, so a `javascript:`/`data:` URL would be live XSS (see docs).
export { safeUrl } from "./safe-url.ts";
// Observability: `ctx.log` (RequestContext) is the request logger; `tracedFetch` is a drop-in
// `fetch` a plugin uses for upstream calls so they join the request's trace (client span + traceparent).
// The `Log` class is exported so a plugin can type/construct one (e.g. `new Log("none")` in a test).
export { Log, tracedFetch } from "./logger.ts";
