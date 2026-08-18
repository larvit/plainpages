// The plugin author surface — the ONE module a plugin imports. It re-exports exactly the
// stable contract: definePlugin + the manifest/handler types, the RequestContext, the auth guards,
// and the request-body/CSRF/list-query helpers the blessed pattern needs. This barrel *is* the
// contract boundary in code — the host may refactor any other src/* freely as long as it holds, so
// a plugin should import from here, never reach into deeper modules. See README.md → Building plugins.

export { definePlugin, isValidPermissionName } from "./plugin.ts";
export type { BootContext, HttpMethod, Plugin, PluginHooks, PluginManifest, PermissionDecl, Route, RouteHandler, RouteResult } from "./plugin.ts";
// A plugin's own database, handed to onBoot when the manifest sets `storage`. Credentials, not a
// client — the plugin depends on whichever driver it prefers (README → Plugin storage).
export type { StorageCredentials } from "./storage.ts";
export type { RequestContext, User } from "../http/context.ts";
export type { PageChrome } from "../ui/chrome.ts";
export type { NavNode } from "../ui/nav.ts";
export { can, check, GuardError, requireSession } from "../auth/guards.ts";
// Translation: `ctx.t` and the view-level `t(...)` do the work at runtime — these are for
// authoring a plugin's own catalogs (plugins/<id>/i18n/<locale>.ts) and for building a translator
// in a unit test. `PluralMessage` types a message that varies with a count.
export { createTranslator } from "../i18n/translate.ts";
// `englishTranslator(yourCatalog)` chains your catalog in front of the host's English — the default
// for a view model built outside a request, so core words you reuse still read as words in a test.
export { englishTranslator } from "../i18n/english.ts";
// `localeLabel(tag)` names a locale in its own language ("svenska (Sverige)") — what ctx.locales
// needs to become a language picker of your own.
export { localeLabel } from "../i18n/locale.ts";
export type { Translate, TranslateVars } from "../i18n/translate.ts";
export type { Catalog, PluralMessage } from "../i18n/catalog.ts";
// The shape of the core catalog — what an operator's own locales/<tag>.ts is written against, so a
// missing key is a type error in the editor rather than a wall of boot errors.
export type { CoreMessages } from "../i18n/locales/en-US.ts";
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
