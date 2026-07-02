// The plugin author surface — the ONE module a plugin imports. It re-exports exactly the
// stable contract: definePlugin + the manifest/handler types, the RequestContext, the auth guards,
// and the request-body/CSRF/list-query helpers the blessed pattern needs. This barrel *is* the
// contract boundary in code — the host may refactor any other src/* freely as long as it holds, so
// a plugin should import from here, never reach into deeper modules. See README.md → Building plugins.

export { definePlugin } from "./plugin.ts";
export type { HttpMethod, Plugin, PluginHooks, PluginManifest, PermissionDecl, Route, RouteHandler, RouteResult } from "./plugin.ts";
export type { RequestContext, User } from "../http/context.ts";
export type { PageChrome } from "../ui/chrome.ts";
export type { NavNode } from "../ui/nav.ts";
export { can, check, GuardError, requireSession } from "../auth/guards.ts";
export { parseListQuery } from "../ui/list-query.ts";
export { paginate } from "../ui/paginate.ts";
export type { PageModel } from "../ui/paginate.ts";
export { readFormBody } from "../http/body.ts";
export { CSRF_FIELD } from "../auth/csrf.ts";
// System capabilities for a privileged/system plugin (ctx.system) — the Ory admin clients + the
// instant-revoke hook. Undefined unless the host wired them; the built-in admin plugin is the
// reference consumer. The Ory client types + their error classes are re-exported so a system
// plugin can type against them and `instanceof`-match their errors. See README → System capabilities.
export type { SystemCapabilities } from "./system.ts";
export type { Identity, KratosAdmin, RecoveryCode } from "../auth/kratos-admin.ts";
export type { ExpandTree, KetoClient, RelationQuery, RelationTuple, SubjectSet } from "../auth/keto-client.ts";
export type { HydraAdmin, OAuth2Client } from "../auth/hydra-admin.ts";
export { KratosError } from "../auth/kratos-public.ts";
export { HydraError } from "../auth/hydra-admin.ts";
// Sanitise an untrusted URL (upstream/user data) before rendering it in an href/src — partials
// escape text but not URL schemes, so a `javascript:`/`data:` URL would be live XSS (see docs).
export { safeUrl } from "../http/safe-url.ts";
// Observability: `ctx.log` (RequestContext) is the request logger; `tracedFetch` is a drop-in
// `fetch` a plugin uses for upstream calls so they join the request's trace (client span + traceparent).
// The `Log` class is exported so a plugin can type/construct one (e.g. `new Log("none")` in a test).
export { Log, tracedFetch } from "../logger.ts";
