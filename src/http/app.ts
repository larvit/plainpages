import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { type BuiltinRoute, matchBuiltinRoute, type PluginContextFactory, type RequestCsrf } from "./builtin-routes.ts";
import { buildPluginChrome, type PageChrome } from "../ui/chrome.ts";
import { buildContext, type RequestContext, type User } from "./context.ts";
import { csrfCookie, ensureCsrfToken, verifyCsrfRequest } from "../auth/csrf.ts";
import type { Denylist } from "../auth/denylist.ts";
import { buildDashboardModel } from "../ui/dashboard.ts";
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
import { createLogger, type Log, requestLogger, runWithLog } from "../logger.ts";
import { remintSession } from "../auth/login.ts";
import { DEFAULT_MENU, type MenuConfig } from "../ui/menu-config.ts";
import { declaredPermissions, type Plugin, type RouteHandler, type RouteResult } from "../plugin-host/plugin.ts";
import type { PluginSettings } from "../plugin-host/settings.ts";
import type { SystemCapabilities } from "../plugin-host/system.ts";
import { allows } from "../auth/gate.ts";
import { allowedMethods, matchRoute } from "../plugin-host/router.ts";
import { buildAuthRoutes } from "../auth/routes.ts";
import { securityHeaders } from "./security-headers.ts";
import { localPath } from "./safe-url.ts";
import { routePublic, serveStatic } from "./static.ts";
import { renderPluginView } from "../plugin-host/view-resolver.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface AppOptions {
  appUrl?: string; // canonical public URL (config.appUrl); off-host GET/HEAD visitors are 308'd here. Omitted ⇒ no redirect
  auth?: VerifyOptions; // expected JWT issuer/audience + clock skew (config); used with jwks
  cache?: boolean; // cache compiled EJS templates (config.cacheTemplates); off ⇒ edits show live
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
  const canonicalHost = canonical?.host; // host[:port], default ports omitted — matches the Host header
  const canonicalOrigin = canonical?.origin; // scheme + host[:port], no trailing slash
  const csrfSecret = options.csrfSecret ?? randomBytes(32).toString("hex"); // server passes config; tests pass their own
  const secureCookies = options.secureCookies ?? false;
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
  const viewsDir = options.viewsDir ?? join(rootDir, "views");
  // Response security headers, fixed at boot (only HSTS depends on the https deployment signal).
  const secHeaderEntries = Object.entries(securityHeaders({ secure: secureCookies }));

  // `views: [viewsDir]` lets a view in a subfolder (e.g. partials/…) include() the shared partials/
  // by the same root-relative name top-level views use (EJS tries relative first).
  const render = (view: string, data: Record<string, unknown>): Promise<string> =>
    ejs.renderFile(join(viewsDir, `${view}.ejs`), data, { cache, views: [viewsDir] });

  const renderView = renderPluginView({ cache, coreViewsDir: viewsDir, pluginsDir });

  // Where the language picker points. Normally the page itself; after a POST that URL may answer no
  // GET (POST /admin/users/:id/delete has no GET sibling), so fall back to the page the form was
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
  // i18n locals go last: their names are reserved, so a handler's colliding key loses instead of
  // breaking the shell around it.
  const viewsFor = (ctx: RequestContext): ViewRenderer => (view, data) => render(view, { ...data, ...i18nLocals(localsOf(ctx)) });
  const pluginViewsFor = (ctx: RequestContext, id: string): ViewRenderer => (view, data) => renderView(id, view, { ...data, ...i18nLocals(localsOf(ctx)) });

  const sendHtml = (res: ServerResponse, status: number, html: string): void => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  };

  // The public landing "/", ungated. A plugin may own it via `home`; else the built-in intro page.
  const serveHome = async (ctx: RequestContext, csrf: RequestCsrf, contextFor: PluginContextFactory): Promise<RouteResult | null> => {
    csrf.setCookie();
    if (homePlugin) {
      // The plugin owns this page, so it runs on its own context — its catalog first, then core.
      const pluginCtx = contextFor(homePlugin.id);
      const result = (await homePlugin.home(pluginCtx)) ?? null;
      if (anyResponseHooks) await runResponseHooks(plugins, contextFor, result);
      await sendResult(ctx.res, result, pluginViewsFor(pluginCtx, homePlugin.id), pluginCtx.localeHref);
      return null;
    }
    return { data: { chrome: ctx.chrome, user: ctx.user }, view: "home" };
  };

  // "/dashboard", gated to a signed-in user. A plugin may own it via `dashboard`; else the built-in
  // starter page.
  const serveDashboard = async (ctx: RequestContext, csrf: RequestCsrf, contextFor: PluginContextFactory): Promise<RouteResult | null> => {
    if (!ctx.user) return { redirect: loginRedirect(ctx), status: 303 };
    // The page carries the Sign-out form, so Set-Cookie a fresh CSRF token here when absent.
    csrf.setCookie();
    if (dashboardPlugin) {
      const pluginCtx = contextFor(dashboardPlugin.id); // as serveHome: the owner's own translator
      const result = (await dashboardPlugin.dashboard(pluginCtx)) ?? null;
      if (anyResponseHooks) await runResponseHooks(plugins, contextFor, result);
      await sendResult(ctx.res, result, pluginViewsFor(pluginCtx, dashboardPlugin.id), pluginCtx.localeHref);
      return null;
    }
    return { data: { model: buildDashboardModel({ csrfToken: csrf.token, menu, user: ctx.user, nav: ctx.chrome.nav, t: ctx.t }) }, view: "index" };
  };

  // The internal route table, matched after plugin routes: the auth/OAuth2 group (src/auth/
  // routes.ts, capability-gated on the wired clients) plus the two landing slots above.
  const builtinRoutes: BuiltinRoute[] = [
    ...buildAuthRoutes({ hydra, keto, kratos, kratosAdmin, menu, secureCookies }),
    { handler: serveHome, method: "GET", path: "/" },
    { handler: serveDashboard, method: "GET", path: "/dashboard" },
  ];

  // The request handler. Run inside runWithLog (below) so the per-request logger is ambient: every
  // outbound fetch (the Ory clients via tracedFetch) and any deep module joins this request's trace
  // and correlation with no logger threaded through their signatures.
  const handleRequest = async (req: IncomingMessage, res: ServerResponse, reqLog: Log): Promise<void> => {
    // Error pages can render before this request has a context at all (a throw on the way to one),
    // so they start on the built-in English and switch to the visitor's locale once it is resolved.
    let renderPage: ViewRenderer = (view, data) => render(view, { ...data, ...ENGLISH_LOCALS });
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;

      // Set before any branch so every response — static/redirect/error included — inherits them
      // (writeHead merges these with its own headers; a plugin's RouteResult.headers can override).
      for (const [name, value] of secHeaderEntries) res.setHeader(name, value);

      // Before auth: assets don't need a verified user, and the JWT cookie rides every request.
      if (pathname.startsWith("/public/") && (method === "GET" || method === "HEAD")) {
        const { dir, subPath } = routePublic(pathname.slice("/public/".length), publicDir, pluginsDir, pluginIds);
        await serveStatic(dir, subPath, res, method === "HEAD", (err) => reqLog.error("static stream error", { error: String(err) }));
        return;
      }

      // A cache in front of us must key on the language. Set after the static branch: an asset is
      // the same bytes in every language, and a Vary there fragments its entry per raw header.
      res.setHeader("vary", "accept-language");

      // Canonical host (APP_URL): send an off-host visitor to the configured origin so the browser,
      // the themed forms and the cross-origin Kratos POST share one cookie host — otherwise the
      // host-scoped Kratos CSRF cookie is lost and login dumps onto /error. GET/HEAD only: a 308
      // must not replay a cross-host POST.
      if (canonicalHost && (method === "GET" || method === "HEAD")) {
        const host = req.headers.host;
        if (host !== undefined && host !== canonicalHost) {
          res.writeHead(308, { location: canonicalOrigin + (req.url ?? "/") }).end();
          return;
        }
      }

      // `explicit` (the URL asked for a locale) is what makes the choice travel: the chrome, this
      // request's redirects and ctx.localeHref then carry ?locale onto the links they emit.
      const { explicit, locale } = i18n.resolve({ acceptLanguage: req.headers["accept-language"], param: url.searchParams.get("locale") });
      const carryLocale = (href: string): string => localeHref(href, explicit ? locale : null);
      const t = i18n.translator(locale);

      // A lapsed token still backed by a live Kratos session is silently re-minted — "stay signed
      // in". The only place the hot path touches Ory.
      let user: User | null = null;
      if (jwks) {
        const auth = await resolveSession(req.headers.cookie, jwks, authOptions);
        user = auth.user;
        if (!user && auth.expired && keto && kratos && kratosAdmin) {
          try {
            const reminted = await remintSession({ keto, kratosAdmin, kratosPublic: kratos }, req.headers.cookie, { secure: secureCookies });
            user = reminted.user;
            res.appendHeader("set-cookie", reminted.setCookie);
          } catch (err) {
            // Ory unreachable — degrade to anonymous instead of 500ing every lapsed request. Leave
            // the cookie alone: it can re-mint once Ory recovers.
            reqLog.warn("session re-mint failed (Ory unreachable?)", { error: String(err) });
          }
        }
      }
      const csrf = ensureCsrfToken(req.headers.cookie, csrfSecret);
      const csrfMint: RequestCsrf = {
        setCookie: (): void => { if (csrf.fresh) res.appendHeader("set-cookie", csrfCookie(csrf.token, { secure: secureCookies })); },
        token: csrf.token,
      };
      const verifyCsrf = (submitted: string | null | undefined): boolean =>
        verifyCsrfRequest({ cookieHeader: req.headers.cookie, secret: csrfSecret, submitted });
      // Chrome composes the whole menu, so it is memoized and resolved lazily — a json/redirect
      // handler, or the public "/" with a standalone home, never pays for it.
      let chromeMemo: PageChrome | undefined;
      const chrome = (): PageChrome => (chromeMemo ??= buildPluginChrome({ csrfToken: csrf.token, currentPath: pathname, localeHref: carryLocale, menu, plugins, t, translatorFor: (id) => i18n.translator(locale, id), user }));

      // A plugin's context gets the plugin's own translator — its catalog first, then core.
      const i18nFor = (pluginId?: string) => ({
        locale,
        localeHref: carryLocale,
        locales: i18n.available,
        t: pluginId === undefined ? t : i18n.translator(locale, pluginId),
      });

      // Base context (no route params), for the built-in routes. Every plugin-owned render — a
      // landing slot, a hook short-circuit, a plugin route — gets `contextFor(id)` instead.
      const ctx = buildContext(req, res, { chrome, declaredPermissions: permissionCatalog, declaredSettings: settingsCatalog, user, ...i18nFor(), log: reqLog, verifyCsrf, ...(system ? { system } : {}) });
      const contextFor = (pluginId: string, params?: Record<string, string>): RequestContext =>
        buildContext(req, res, { chrome, declaredPermissions: permissionCatalog, declaredSettings: settingsCatalog, user, ...i18nFor(pluginId), log: reqLog, ...(params ? { params } : {}), verifyCsrf, ...(system ? { system } : {}) });
      renderPage = viewsFor(ctx);

      // Plugin onRequest hooks run before routing and may short-circuit the request.
      if (anyRequestHooks) {
        const short = await runRequestHooks(plugins, contextFor);
        if (short) {
          // Like every other page-emitting path, so a form the hook renders has its matching cookie.
          csrfMint.setCookie();
          await sendResult(res, short.result, pluginViewsFor(short.ctx, short.plugin.id), carryLocale);
          return;
        }
      }

      const match = matchRoute(plugins, method, pathname);
      if (match) {
        const routeCtx = contextFor(match.plugin.id, match.params);
        if (!allows(match.route, routeCtx.user)) {
          // Anonymous → sign in, remembering the page as return_to; a signed-in user who simply
          // lacks the permission gets the 403 page.
          if (!routeCtx.user) { res.writeHead(303, { location: loginRedirect(routeCtx) }).end(); return; }
          reqLog.warn("forbidden: missing permission", { path: pathname, required: match.route.permission ?? "", sub: routeCtx.user.id });
          sendHtml(res, 403, await renderPage("403", {}));
          return;
        }
        csrfMint.setCookie();
        const result = (await match.route.handler(routeCtx)) ?? null;
        // The responding plugin observes its own route, params and all; the others get a plain
        // context for their own id (never another plugin's params).
        if (anyResponseHooks) await runResponseHooks(plugins, (id) => (id === match.plugin.id ? routeCtx : contextFor(id)), result);
        await sendResult(res, result, pluginViewsFor(routeCtx, match.plugin.id), carryLocale);
        return;
      }

      const builtin = matchBuiltinRoute(builtinRoutes, method, pathname);
      if (builtin) {
        await sendResult(res, await builtin.handler(ctx, csrfMint, contextFor), viewsFor(ctx), carryLocale);
        return;
      }

      // Known path, wrong method → 405 with Allow; otherwise nothing here → 404.
      const allow = allowedMethods(plugins, pathname);
      if (allow.length) {
        res.writeHead(405, { allow: allow.join(", "), "content-type": "text/plain; charset=utf-8" }).end("Method Not Allowed");
        return;
      }
      sendHtml(res, 404, await renderPage("404", {}));
    } catch (err) {
      // A guard thrown anywhere in handling maps to a response (not a 500): a `location` ⇒ a
      // redirect (requireSession → /login), otherwise the status renders the error page.
      if (err instanceof GuardError) {
        if (res.headersSent) return void res.end();
        if (err.location) return void res.writeHead(303, { location: err.location }).end();
        try {
          return void sendHtml(res, err.status, await renderPage("403", {}));
        } catch (renderErr) {
          // Same last resort as the 500 branch below: a throw here would leave the socket open
          // (this catch is the one that would have handled it), so end the response ourselves.
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
  };

  return createServer((req, res) => {
    // "close" (not "finish") fires on both a completed response and a premature disconnect, so an
    // aborted request is still logged and its span flushed.
    const startMs = Date.now();
    const reqLog = requestLogger(log, {
      requestId: randomUUID(),
      ...(typeof req.headers.traceparent === "string" ? { traceparent: req.headers.traceparent } : {}),
    });
    // end() must run exactly once, after BOTH the handler has unwound AND the response has closed.
    // Earlier would throw "already ended" from a still-running handler's ctx.log on a client abort,
    // or drop the access line on the happy path (the handler settles before close).
    let settled = false;
    let closed = false;
    const finalize = (): void => { if (settled && closed) void reqLog.end().catch(() => {}); };
    res.on("close", () => {
      closed = true;
      try {
        // path only (no query — it may carry tokens); method/status are header-safe here.
        reqLog.info("request", { method: req.method ?? "GET", ms: Date.now() - startMs, path: (req.url ?? "/").split("?", 1)[0] ?? "/", status: res.statusCode });
      } catch { /* never let logging crash a served request */ }
      finalize();
    });
    // Make reqLog ambient for the whole handler so all outbound fetch is traced. The .catch logs a
    // pathological escape via the app logger — not reqLog, which may be the thing that broke.
    void runWithLog(reqLog, () => handleRequest(req, res, reqLog))
      .catch((err) => log.error("request handler escaped its try/catch", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) }))
      .finally(() => { settled = true; finalize(); });
  });
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
