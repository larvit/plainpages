import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { type BuiltinRoute, matchBuiltinRoute, type PluginContextFactory, type PluginOwned, type RequestCsrf } from "./builtin-route.ts";
import { buildPluginChrome, type PageChrome } from "../ui/chrome.ts";
import { buildContext, type RequestContext, type User } from "./context.ts";
import { csrfCookie, ensureCsrfToken, verifyCsrfRequest } from "../auth/csrf.ts";
import type { Denylist } from "../auth/denylist.ts";
import { PLUGINS_DIR } from "../plugin-host/discovery.ts";
import { GuardError, loginRedirect } from "../auth/guards.ts";
import { ENGLISH_I18N } from "../i18n/english.ts";
import type { I18n } from "../i18n/runtime.ts";
import { localeHref } from "../i18n/locale.ts";
import { ENGLISH_LOCALS, i18nLocals, type I18nRequest } from "../i18n/view-locals.ts";
import { runRequestHooks, runResponseHooks } from "../plugin-host/hooks.ts";
import type { HydraAdmin } from "../auth/hydra-admin.ts";
import type { JwksProvider } from "../auth/jwks.ts";
import { resolveSession, type VerifyOptions } from "../auth/jwt-middleware.ts";
import type { KetoClient } from "../auth/keto-client.ts";
import type { KratosAdmin } from "../auth/kratos-admin.ts";
import type { KratosPublic } from "../auth/kratos-public.ts";
import { createLogger, type Log } from "../logger.ts";
import { remintSession } from "../auth/login.ts";
import { DEFAULT_MENU, type MenuConfig } from "../ui/menu-config.ts";
import { declaredPermissions, fullPath, type PermissionDecl, type Plugin, type RouteHandler, type RouteResult } from "../plugin-host/plugin.ts";
import type { PluginSettings } from "../plugin-host/settings.ts";
import type { SystemCapabilities } from "../plugin-host/system.ts";
import { allows, type Gate } from "../auth/gate.ts";
import { allowedMethods, matchRoute } from "../plugin-host/router.ts";
import { buildAuthRoutes } from "../auth/routes.ts";
import { parseTrustedProxies } from "./request-fields.ts";
import { trackRequest } from "./request-tracking.ts";
import { securityHeaders } from "./security-headers.ts";
import { localPath } from "./safe-url.ts";
import { type PublicAssets, publicAssets } from "./static.ts";
import { renderPluginView } from "../plugin-host/view-resolver.ts";

const NO_STORE = "private, no-store";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface AppOptions {
  appUrl?: string; // canonical public URL (config.appUrl); off-host GET/HEAD visitors are 308'd here. Omitted ⇒ no redirect
  auth?: VerifyOptions; // expected JWT issuer/audience + clock skew (config); used with jwks
  cache?: boolean; // cache compiled EJS templates and /public/ asset versions (config.cacheTemplates); off ⇒ edits show live
  csrfSecret?: string; // HMAC key for the double-submit CSRF token (config.csrfSecret); random if omitted
  denylist?: Denylist; // optional instant-revoke; the hot path rejects revoked subjects, admin writes record revokes
  hydra?: HydraAdmin; // Hydra admin client; with kratos enables the OAuth2 login challenge
  i18n?: I18n; // discovered catalogs; omitted ⇒ the built-in en-US only, so an unwired app still renders English
  jwks?: JwksProvider; // verify the session JWT → ctx.user/permissions; absent ⇒ always anonymous
  keto?: KetoClient; // Keto client; with kratos+kratosAdmin enables login completion
  kratos?: KratosPublic; // Kratos public client; enables the themed self-service routes
  kratosAdmin?: KratosAdmin; // Kratos admin client; with kratos+keto enables login completion
  log?: Log; // app-level logger; per-request access log + trace span. Default: silent (tests)
  menu?: MenuConfig; // central override + branding (config/menu.ts); defaults to DEFAULT_MENU
  plugins?: Plugin[]; // discovered manifests to mount (router); empty until discovery runs
  pluginsDir?: string; // where plugin views/static live; defaults to the scanned plugins/
  publicDir?: string;
  secureCookies?: boolean; // set Secure on our session/CSRF cookies (config.secureCookies; off in dev http)
  settingsCatalog?: readonly PluginSettings[]; // resolved at boot (server.ts, needs the env); → ctx.declaredSettings
  trustedProxies?: readonly string[]; // IPs/CIDRs whose X-Forwarded-For names the caller (config.trustedProxies); omitted ⇒ the socket peer
  viewsDir?: string;
}

export function createApp(options: AppOptions = {}): Server {
  // The denylist rides in the verify options so resolveSession rejects a revoked subject on the hot
  // path; the bound `revoke` goes to the admin handlers. Both absent ⇒ the feature is fully off.
  const denylist = options.denylist;
  const authOptions: VerifyOptions = denylist ? { ...(options.auth ?? {}), denylist } : (options.auth ?? {});
  const revoke = denylist ? (sub: string): void => denylist.revoke(sub) : undefined;
  const cache = options.cache ?? false;
  const canonical = options.appUrl ? new URL(options.appUrl) : undefined;
  const csrfSecret = options.csrfSecret ?? randomBytes(32).toString("hex"); // server passes config; tests pass their own
  const secureCookies = options.secureCookies ?? false;
  const trustedProxies = parseTrustedProxies(options.trustedProxies);
  const hydra = options.hydra;
  const i18n = options.i18n ?? ENGLISH_I18N;
  const jwks = options.jwks;
  const keto = options.keto;
  const kratos = options.kratos;
  const kratosAdmin = options.kratosAdmin;
  // Only the wired capabilities are present; with none wired ctx.system stays undefined.
  const system: SystemCapabilities | undefined = kratosAdmin || keto || hydra || revoke
    ? { ...(hydra ? { hydra } : {}), ...(keto ? { keto } : {}), ...(kratosAdmin ? { kratosAdmin } : {}), ...(revoke ? { revoke } : {}) }
    : undefined;
  // Silent default so unit/integration tests stay quiet; server.ts injects the configured logger.
  const log = options.log ?? createLogger({ level: "none" });
  const menu = options.menu ?? DEFAULT_MENU;
  const plugins = options.plugins ?? [];
  const pluginIds = new Set(plugins.map((p) => p.id));
  // `find` is unambiguous: findConflicts guarantees at most one owner of each landing slot.
  const homePlugin = plugins.find((p): p is Plugin & { home: RouteHandler } => typeof p.home === "function");
  const dashboardPlugin = plugins.find((p): p is Plugin & { dashboard: RouteHandler } => typeof p.dashboard === "function");
  const permissionCatalog = declaredPermissions(plugins);
  const settingsCatalog = options.settingsCatalog ?? [];
  // Skip the hook pipeline entirely unless a plugin declares the hook (keeps the hot path free).
  const anyRequestHooks = plugins.some((p) => p.hooks?.onRequest);
  const anyResponseHooks = plugins.some((p) => p.hooks?.onResponse);
  const pluginsDir = options.pluginsDir ?? PLUGINS_DIR;
  const publicDir = options.publicDir ?? join(rootDir, "public");
  const assets = publicAssets(publicDir, pluginsDir, pluginIds, { cache });
  const viewsDir = options.viewsDir ?? join(rootDir, "views");
  // Response security headers, fixed at boot (only HSTS depends on the https deployment signal).
  const secHeaderEntries = Object.entries(securityHeaders({ secure: secureCookies }));

  // `views: [viewsDir]` lets a view in a subfolder (e.g. partials/…) include() the shared partials/
  // by the same root-relative name top-level views use (EJS tries relative first).
  const render = (view: string, data: Record<string, unknown>): Promise<string> =>
    ejs.renderFile(join(viewsDir, `${view}.ejs`), data, { cache, views: [viewsDir] });

  const renderView = renderPluginView({ cache, coreViewsDir: viewsDir, pluginsDir });

  // Where the language picker points. Normally the page itself; after a POST that URL may answer no
  // GET (POST /auth-admin/users/:id/recovery has no GET sibling), so fall back to the page the form was
  // submitted from, then to the front page — the picker is on every page, so every link must land.
  const switchBase = (req: IncomingMessage, url: URL): string => {
    const method = (req.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") return `${url.pathname}${url.search}`;
    const answersGet = matchRoute(plugins, "GET", url.pathname) !== null
      || matchBuiltinRoute(builtinRoutes, "GET", url.pathname) !== undefined;
    return answersGet ? url.pathname : (sameOriginPath(req) ?? "/");
  };

  // Named field by field on purpose: spreading the context would trigger its lazy `chrome` getter,
  // composing the menu for every render — including the standalone error pages, which exist to
  // render when the shell's own data is what failed.
  const localsOf = (ctx: RequestContext): I18nRequest => ({
    locale: ctx.locale,
    localeHref: ctx.localeHref,
    locales: ctx.locales,
    switchBase: switchBase(ctx.req, ctx.url),
    t: ctx.t,
    url: ctx.url,
  });
  // i18n locals and `assetHref` go last: their names are reserved, so a handler's
  // colliding key loses instead of breaking the shell around it.
  const viewsFor = (ctx: RequestContext): ViewRenderer => (view, data) => render(view, { ...data, ...i18nLocals(localsOf(ctx)), assetHref: assets.href });
  const pluginViewsFor = (ctx: RequestContext, id: string): ViewRenderer => (view, data) => renderView(id, view, { ...data, ...i18nLocals(localsOf(ctx)), assetHref: assets.href });

  // The public landing "/", ungated. A plugin may own it via `home`; else the built-in intro page.
  const serveHome = async (ctx: RequestContext, csrf: RequestCsrf, contextFor: PluginContextFactory): Promise<RouteResult | PluginOwned> => {
    csrf.setCookie();
    if (!homePlugin) return { data: { chrome: ctx.chrome, user: ctx.user }, view: "home" };
    const pluginCtx = contextFor(homePlugin.id);
    return { ctx: pluginCtx, pluginId: homePlugin.id, result: (await homePlugin.home(pluginCtx)) ?? null };
  };

  // "/dashboard", gated to a signed-in user. A plugin may own it via `dashboard`; else the built-in
  // starter page.
  const serveDashboard = async (ctx: RequestContext, csrf: RequestCsrf, contextFor: PluginContextFactory): Promise<RouteResult | PluginOwned> => {
    // The page carries the Sign-out form, so Set-Cookie a fresh CSRF token here when absent.
    csrf.setCookie();
    if (!dashboardPlugin) return { data: { chrome: ctx.chrome }, view: "dashboard" };
    const pluginCtx = contextFor(dashboardPlugin.id);
    return { ctx: pluginCtx, pluginId: dashboardPlugin.id, result: (await dashboardPlugin.dashboard(pluginCtx)) ?? null };
  };

  // The internal route table, matched after plugin routes: the auth/OAuth2 group (src/auth/
  // routes.ts, capability-gated on the wired clients) plus the two landing slots above.
  const builtinRoutes: BuiltinRoute[] = [
    ...buildAuthRoutes({ hydra, keto, kratos, kratosAdmin, menu, secureCookies }),
    { handler: serveHome, method: "GET", path: "/", public: true },
    { handler: serveDashboard, method: "GET", path: "/dashboard", session: true },
  ];

  const host: Host = { anyRequestHooks, anyResponseHooks, assets, authOptions, builtinRoutes, csrfSecret, i18n, jwks, keto, kratos, kratosAdmin, menu, permissionCatalog, pluginViewsFor, plugins, secureCookies, settingsCatalog, system, viewsFor };

  // A stage that returns a boolean returns true once it has answered the request, and false to
  // pass the request to the next stage.
  const handleRequest = async (req: IncomingMessage, res: ServerResponse, reqLog: Log): Promise<void> => {
    // Error pages can render before this request has a context at all (a throw on the way to one),
    // so they start on the built-in English and switch to the visitor's locale once it is resolved.
    let renderPage: ViewRenderer = (view, data) => render(view, { ...data, ...ENGLISH_LOCALS, assetHref: assets.href });
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      // Set before any branch so every response — static/redirect/error included — inherits them
      // (writeHead merges these with its own headers; a plugin's RouteResult.headers can override).
      for (const [name, value] of secHeaderEntries) res.setHeader(name, value);
      // Before the session is resolved: an asset needs no user, and verifying the JWT cookie that
      // every asset request carries would be wasted work.
      if (await serveStatic(assets, method, url, req, res, reqLog)) return;
      setPageCacheHeaders(res);
      if (redirectToCanonicalHost(canonical, method, req, res)) return;
      const state = await prepareRequest(host, req, res, method, url, reqLog);
      renderPage = viewsFor(state.ctx);
      if (await answerFromHook(host, state)) return;
      if (await answerPluginRoute(host, state)) return;
      if (await answerBuiltinRoute(host, state)) return;
      await answerUnrouted(host, state);
    } catch (err) {
      await answerError(err, res, reqLog, renderPage);
    }
  };

  return createServer((req, res) => trackRequest(log, trustedProxies, req, res, handleRequest));
}

// What the request stages read from createApp, all fixed at boot.
interface Host {
  anyRequestHooks: boolean;
  anyResponseHooks: boolean;
  assets: PublicAssets;
  authOptions: VerifyOptions;
  builtinRoutes: BuiltinRoute[];
  csrfSecret: string;
  i18n: I18n;
  jwks: JwksProvider | undefined;
  keto: KetoClient | undefined;
  kratos: KratosPublic | undefined;
  kratosAdmin: KratosAdmin | undefined;
  menu: MenuConfig;
  permissionCatalog: PermissionDecl[];
  pluginViewsFor: (ctx: RequestContext, id: string) => ViewRenderer;
  plugins: Plugin[];
  secureCookies: boolean;
  settingsCatalog: readonly PluginSettings[];
  system: SystemCapabilities | undefined;
  viewsFor: (ctx: RequestContext) => ViewRenderer;
}

// A request once its visitor is known: what every stage after prepareRequest reads.
interface RequestState {
  carryLocale: (href: string) => string;
  contextFor: (pluginId: string, params?: Record<string, string>) => RequestContext;
  csrf: RequestCsrf;
  ctx: RequestContext; // the base context (no route params), for the built-in routes
  // Read before the onRequest hooks run, so a hook that edits `req` doesn't reroute the request.
  method: string;
  pathname: string;
}

async function serveStatic(assets: PublicAssets, method: string, url: URL, req: IncomingMessage, res: ServerResponse, reqLog: Log): Promise<boolean> {
  if (!url.pathname.startsWith("/public/") || (method !== "GET" && method !== "HEAD")) return false;
  await assets.serve(url, req, res, (err) => reqLog.error("static file error", { error: String(err) }));
  return true;
}

function setPageCacheHeaders(res: ServerResponse): void {
  // A cache in front of us must key on the language. Set after serveStatic: an asset is
  // the same bytes in every language, and a Vary there fragments its entry per raw header.
  res.setHeader("vary", "accept-language");
  // Fail closed: a cache in front of us must not keep a page that may carry a user's data. Not
  // even the signed-out `/` is shared: it and the signed-in page have one URL, and a cache keyed
  // on URL and Accept-Language would hand the signed-out one to a signed-in visitor. A route that
  // is the same for everyone sets its own value in RouteResult.headers; the host doesn't police it.
  res.setHeader("cache-control", NO_STORE);
}

// Canonical host (APP_URL): send an off-host visitor to the configured origin so the browser,
// the themed forms and the cross-origin Kratos POST share one cookie host — otherwise the
// host-scoped Kratos CSRF cookie is lost and login dumps onto /error. GET/HEAD only: a 308
// must not replay a cross-host POST. `URL.host` omits a default port, as the Host header does.
function redirectToCanonicalHost(canonical: URL | undefined, method: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (!canonical?.host || (method !== "GET" && method !== "HEAD") || req.headers.host === undefined || req.headers.host === canonical.host) return false;
  res.writeHead(308, { location: canonical.origin + (req.url ?? "/") }).end();
  return true;
}

// Resolves the visitor's locale, user and CSRF token, and builds the contexts handlers run on.
async function prepareRequest(host: Host, req: IncomingMessage, res: ServerResponse, method: string, url: URL, reqLog: Log): Promise<RequestState> {
  const { i18n } = host;
  // `explicit` (the URL asked for a locale) is what makes the choice travel: the chrome, this
  // request's redirects and ctx.localeHref then carry ?locale onto the links they emit.
  const { explicit, locale } = i18n.resolve({ acceptLanguage: req.headers["accept-language"], param: url.searchParams.get("locale") });
  const carryLocale = (href: string): string => localeHref(href, explicit ? locale : null);
  const t = i18n.translator(locale);
  const user = await resolveUser(host, req, res, reqLog);
  const csrf = requestCsrf(host, req, res);
  const verifyCsrf = (submitted: string | null | undefined): boolean =>
    verifyCsrfRequest({ cookieHeader: req.headers.cookie, secret: host.csrfSecret, submitted });
  // Chrome composes the whole menu, so it is memoized and resolved lazily — a json/redirect
  // handler, or the public "/" with a standalone home, never pays for it.
  let chromeMemo: PageChrome | undefined;
  const chrome = (): PageChrome => (chromeMemo ??= buildPluginChrome({
    csrfToken: csrf.token, currentPath: url.pathname, localeHref: carryLocale, menu: host.menu, plugins: host.plugins, t,
    translatorFor: (id) => i18n.translator(locale, id), user,
  }));
  const shared = { assetHref: host.assets.href, chrome, declaredPermissions: host.permissionCatalog, declaredSettings: host.settingsCatalog, locale, localeHref: carryLocale, locales: i18n.available, log: reqLog, user, verifyCsrf, ...(host.system ? { system: host.system } : {}) };
  return {
    carryLocale,
    // The plugin's own translator: its catalog first, then core.
    contextFor: (pluginId, params) => buildContext(req, res, { ...shared, t: i18n.translator(locale, pluginId), ...(params ? { params } : {}) }),
    csrf,
    ctx: buildContext(req, res, { ...shared, t }),
    method,
    pathname: url.pathname,
  };
}

function requestCsrf(host: Host, req: IncomingMessage, res: ServerResponse): RequestCsrf {
  const { fresh, token } = ensureCsrfToken(req.headers.cookie, host.csrfSecret);
  return {
    setCookie: (): void => { if (fresh) res.appendHeader("set-cookie", csrfCookie(token, { secure: host.secureCookies })); },
    token,
  };
}

// A lapsed token still backed by a live Kratos session is silently re-minted — "stay signed
// in". The only place the hot path touches Ory.
async function resolveUser(host: Host, req: IncomingMessage, res: ServerResponse, reqLog: Log): Promise<User | null> {
  const { jwks, keto, kratos, kratosAdmin } = host;
  if (!jwks) return null;
  const auth = await resolveSession(req.headers.cookie, jwks, host.authOptions);
  if (auth.user || !auth.expired || !keto || !kratos || !kratosAdmin) return auth.user;
  try {
    const reminted = await remintSession({ keto, kratosAdmin, kratosPublic: kratos }, req.headers.cookie, { secure: host.secureCookies });
    res.appendHeader("set-cookie", reminted.setCookie);
    return reminted.user;
  } catch (err) {
    // Ory unreachable — degrade to anonymous instead of 500ing every lapsed request. Leave
    // the cookie alone: it can re-mint once Ory recovers.
    reqLog.warn("session re-mint failed (Ory unreachable?)", { error: String(err) });
    return null;
  }
}

async function answerFromHook(host: Host, { carryLocale, contextFor, csrf, ctx }: RequestState): Promise<boolean> {
  if (!host.anyRequestHooks) return false;
  const short = await runRequestHooks(host.plugins, contextFor);
  if (!short) return false;
  // Like every other page-emitting path, so a form the hook renders has its matching cookie.
  csrf.setCookie();
  await sendResult(ctx.res, short.result, host.pluginViewsFor(short.ctx, short.plugin.id), carryLocale);
  return true;
}

async function answerPluginRoute(host: Host, state: RequestState): Promise<boolean> {
  const { carryLocale, contextFor, csrf, ctx } = state;
  const match = matchRoute(host.plugins, state.method, state.pathname);
  if (!match) return false;
  ctx.log.context["http.route"] = fullPath(match.plugin.id, match.route.path);
  const routeCtx = contextFor(match.plugin.id, match.params);
  if (!allows(match.route, routeCtx.user)) {
    await refuse(host, state, match.route, routeCtx);
    return true;
  }
  csrf.setCookie();
  const result = (await match.route.handler(routeCtx)) ?? null;
  // The responding plugin observes its own route, params and all; the others get a plain
  // context for their own id (never another plugin's params).
  if (host.anyResponseHooks) await runResponseHooks(host.plugins, (id) => (id === match.plugin.id ? routeCtx : contextFor(id)), result);
  await sendResult(ctx.res, result, host.pluginViewsFor(routeCtx, match.plugin.id), carryLocale);
  return true;
}

async function answerBuiltinRoute(host: Host, state: RequestState): Promise<boolean> {
  const { carryLocale, contextFor, csrf, ctx } = state;
  const builtin = matchBuiltinRoute(host.builtinRoutes, state.method, state.pathname);
  if (!builtin) return false;
  ctx.log.context["http.route"] = builtin.path;
  if (!allows(builtin, ctx.user)) {
    await refuse(host, state, builtin, ctx);
    return true;
  }
  const answer = await builtin.handler(ctx, csrf, contextFor);
  if ("pluginId" in answer) {
    if (host.anyResponseHooks) await runResponseHooks(host.plugins, contextFor, answer.result);
    await sendResult(ctx.res, answer.result, host.pluginViewsFor(answer.ctx, answer.pluginId), carryLocale);
  } else {
    await sendResult(ctx.res, answer, host.viewsFor(ctx), carryLocale);
  }
  return true;
}

async function answerUnrouted(host: Host, { ctx, pathname }: RequestState): Promise<void> {
  const allow = allowedMethods(host.plugins, pathname);
  if (allow.length) {
    ctx.res.writeHead(405, { allow: allow.join(", "), "content-type": "text/plain; charset=utf-8" }).end("Method Not Allowed");
    return;
  }
  sendHtml(ctx.res, 404, await host.viewsFor(ctx)("404", {}));
}

// Anonymous → sign in, remembering the page as return_to; a signed-in user who simply lacks
// the permission gets the 403 page.
async function refuse(host: Host, { carryLocale, ctx, pathname }: RequestState, gate: Gate, gateCtx: RequestContext): Promise<void> {
  if (!gateCtx.user) { ctx.res.writeHead(303, { location: carryLocale(loginRedirect(gateCtx)) }).end(); return; }
  ctx.log.warn("forbidden: missing permission", { path: pathname, required: gate.permission ?? "", sub: gateCtx.user.id });
  sendHtml(ctx.res, 403, await host.viewsFor(ctx)("403", {}));
}

async function answerError(err: unknown, res: ServerResponse, reqLog: Log, renderPage: ViewRenderer): Promise<void> {
  // A GuardError maps to its redirect (requireSession → /login) or its status page, not a 500.
  if (err instanceof GuardError) {
    if (res.headersSent) return void res.end();
    if (err.location) return void res.writeHead(303, { location: err.location }).end();
    try {
      return void sendHtml(res, err.status, await renderPage("403", {}));
    } catch (renderErr) {
      // answerError runs inside handleRequest's catch, so a throw here would escape and leave the
      // socket open. End the response here, as the 500 branch below does.
      reqLog.error("error page render failed", { error: renderErr instanceof Error ? (renderErr.stack ?? renderErr.message) : String(renderErr) });
      return void res.writeHead(err.status, { "content-type": "text/plain; charset=utf-8" }).end("Forbidden");
    }
  }
  reqLog.error("unhandled request error", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  if (res.headersSent) return void res.end(); // a partial body is already on the wire
  try {
    // Render before writing: if the 500 page itself throws, headers stay unsent
    // and we fall back to plain text below instead of a half-written response.
    sendHtml(res, 500, await renderPage("500", {}));
  } catch (renderErr) {
    reqLog.error("error page render failed", { error: renderErr instanceof Error ? (renderErr.stack ?? renderErr.message) : String(renderErr) });
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("Internal Server Error");
  }
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

// The Referer as a host-relative path, when it is one of ours — the page a form was submitted
// from. Anything off-origin or malformed is discarded rather than trusted into a link.
function sameOriginPath(req: IncomingMessage): string | null {
  const referer = req.headers.referer;
  if (typeof referer !== "string") return null;
  try {
    const url = new URL(referer);
    if (req.headers.host !== undefined && url.host !== req.headers.host) return null;
    return localPath(`${url.pathname}${url.search}`);
  } catch {
    return null;
  }
}

type ViewRenderer = (view: string, data: Record<string, unknown>) => Promise<string>;

// Turn a handler's RouteResult into the HTTP response. `null` = the handler took over `ctx.res`
// itself (the void escape hatch). Author `headers` override the content-type default.
async function sendResult(res: ServerResponse, result: RouteResult | null, renderView: ViewRenderer, carryLocale: (href: string) => string = (href) => href): Promise<void> {
  if (result == null || res.writableEnded) return;
  if ("redirect" in result) {
    // A redirect to one of our own pages keeps the visitor's chosen locale (a POST→redirect→GET
    // would otherwise drop it); an off-site target is left exactly as the handler wrote it.
    res.writeHead(result.status ?? 303, { location: carryLocale(result.redirect) }).end();
    return;
  }
  if ("json" in result) {
    res.writeHead(result.status ?? 200, { "content-type": "application/json; charset=utf-8", ...result.headers });
    res.end(JSON.stringify(result.json));
    return;
  }
  const body = "html" in result ? result.html : await renderView(result.view, result.data ?? {});
  res.writeHead(result.status ?? 200, { "content-type": "text/html; charset=utf-8", ...result.headers });
  res.end(body); // Node suppresses the body for HEAD automatically
}
