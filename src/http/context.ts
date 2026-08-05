import type { IncomingMessage, ServerResponse } from "node:http";
import type { PageChrome } from "../ui/chrome.ts"; // type-only: no runtime import, so no cycle
import type { PermissionDecl } from "../plugin-host/plugin.ts"; // type-only
import type { SystemCapabilities } from "../plugin-host/system.ts"; // type-only
import { DEFAULT_LOCALE } from "../i18n/catalog.ts";
import { ENGLISH } from "../i18n/english.ts";
import type { Translate } from "../i18n/translate.ts";
import { createLogger, type Log } from "../logger.ts";

// The request context threaded to every route handler (plugin + built-in), built once
// per request by `buildContext`: the router supplies matched path `params`, the JWT
// middleware supplies `user` (null until then). The host's single handler argument.

// The signed-in user, projected from verified session JWT claims. Ory calls this record an
// "identity" (see README); Plainpages says user throughout.
// `id` = `sub`, plus `email` and the coarse `permissions` carried in the token.
export interface User {
  email: string;
  id: string;
  permissions: string[];
}

export interface RequestContext {
  // Page chrome (brand/global-nav/user/theme/csrf) a plugin view hands to partials/shell so its
  // page renders the native app shell; the host builds it per request (anonymous default otherwise).
  chrome: PageChrome;
  // The locale this request is served in, e.g. "sv-SE" — also what <html lang> says.
  locale: string;
  // Carry the visitor's chosen locale onto a link this page renders. A no-op unless the request
  // asked for one with ?locale (there is no locale cookie — the URL is where the choice lives), and
  // on off-site URLs. The host already does this for the chrome and its own redirects; a plugin
  // wraps the hrefs it builds itself.
  localeHref(href: string): string;
  // Every installed locale, sorted. With `localeLabel` (from #plugin-api) it is what a plugin needs
  // to build its own language picker; the host's own picker is already in the shell.
  locales: string[];
  // Request-scoped logger: structured, in the request's trace. `log.info/warn/error(...)` to
  // log; `log.fetch(url)` for an upstream call (a client span continuing the trace). Correlates by
  // requestId. Additive, stable per the contract; defaults to a silent logger off the request path.
  log: Log;
  // Every permission the installed plugins declare, deduped and sorted — the fixed list an admin
  // screen offers when granting one. Pairs with `permissions` below: this is what *exists*, that is
  // what *this user holds*. Empty when no installed plugin declares any.
  declaredPermissions: readonly PermissionDecl[];
  params: Record<string, string>; // path params from the route match, e.g. /users/:id → { id }
  permissions: string[]; // user?.permissions ?? [] — coarse gate without a null-check
  query: URLSearchParams; // alias of url.searchParams, for ctx.query.get("q")
  req: IncomingMessage;
  res: ServerResponse;
  // Privileged host services (Ory admin clients + instant-revoke) for a system plugin. Undefined
  // unless the host wired them; every field optional. Ordinary domain plugins ignore it.
  system?: SystemCapabilities;
  // Translate a key in this request's locale: `ctx.t("shifts.title")`, `ctx.t("greeting", { name })`.
  // Returns raw text — escape it like any other value when rendering. An unknown key renders as
  // itself, so a plain string is always safe to pass.
  t: Translate;
  url: URL;
  user: User | null; // the signed-in user, or null when anonymous
  // Gate a first-party form submission: true iff `submitted` matches this request's signed CSRF
  // cookie (double-submit). The host binds the secret; a plugin calls it after reading its body.
  verifyCsrf(submitted: string | null | undefined): boolean;
}

export interface BuildContextOptions {
  // Lazy chrome factory: composing the global menu is only paid for if the handler actually reads
  // ctx.chrome (a json/redirect handler, or the public "/" with a standalone home, pays nothing).
  // The host's factory is memoised, so the menu composes at most once per request across contexts.
  chrome?: () => PageChrome;
  declaredPermissions?: readonly PermissionDecl[];
  user?: User | null;
  locale?: string;
  localeHref?: (href: string) => string;
  locales?: string[];
  log?: Log;
  params?: Record<string, string>;
  system?: SystemCapabilities;
  t?: Translate;
  verifyCsrf?: (submitted: string | null | undefined) => boolean;
}

// Anonymous default chrome — used until the host supplies a real one (built-in routes, tests).
const ANON_CHROME: PageChrome = { brand: { name: "Plainpages" }, csrfToken: "", nav: [], signInHref: "/login", user: { email: "", initials: "G", name: "Guest" } };
// Silent default logger — used off the request path (built-in routes built ad hoc, tests) until the
// host supplies the real request logger. One instance, no output, negligible cost.
const SILENT_LOG = createLogger({ level: "none" });

export function buildContext(
  req: IncomingMessage,
  res: ServerResponse,
  options: BuildContextOptions = {},
): RequestContext {
  const url = new URL(req.url ?? "/", "http://localhost");
  const user = options.user ?? null;
  const buildChrome = options.chrome;
  let chromeMemo: PageChrome | undefined; // resolve the factory at most once per context
  return {
    get chrome(): PageChrome { return (chromeMemo ??= buildChrome ? buildChrome() : ANON_CHROME); },
    declaredPermissions: options.declaredPermissions ?? [],
    user,
    locale: options.locale ?? DEFAULT_LOCALE,
    localeHref: options.localeHref ?? ((href) => href),
    locales: options.locales ?? [DEFAULT_LOCALE],
    log: options.log ?? SILENT_LOG,
    params: options.params ?? {},
    query: url.searchParams,
    req,
    res,
    permissions: user?.permissions ?? [],
    ...(options.system ? { system: options.system } : {}),
    t: options.t ?? ENGLISH,
    url,
    verifyCsrf: options.verifyCsrf ?? (() => false), // fail-closed unless the host binds the secret
  };
}
