import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";
import { type BuiltinRoute, matchBuiltinRoute, type RequestCsrf } from "./builtin-routes.ts";
import { buildPluginChrome, type PageChrome } from "../ui/chrome.ts";
import { buildContext, type RequestContext, type User } from "./context.ts";
import { csrfCookie, ensureCsrfToken, verifyCsrfRequest } from "../auth/csrf.ts";
import type { Denylist } from "../auth/denylist.ts";
import { buildDashboardModel } from "../ui/dashboard.ts";
import { PLUGINS_DIR } from "../plugin-host/discovery.ts";
import { GuardError, loginRedirect } from "../auth/guards.ts";
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
import type { Plugin, RouteHandler, RouteResult } from "../plugin-host/plugin.ts";
import type { SystemCapabilities } from "../plugin-host/system.ts";
import { allowedMethods, isAuthorized, matchRoute } from "../plugin-host/router.ts";
import { buildAuthRoutes } from "../auth/routes.ts";
import { securityHeaders } from "./security-headers.ts";
import { routePublic, serveStatic } from "./static.ts";
import { renderPluginView } from "../plugin-host/view-resolver.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface AppOptions {
  appUrl?: string; // canonical public URL (config.appUrl); off-host GET/HEAD visitors are 308'd here. Omitted ⇒ no redirect
  auth?: VerifyOptions; // expected JWT issuer/audience + clock skew (config); used with jwks
  // Cache compiled templates; caller decides (server passes config.cacheTemplates).
  // Off by default so edits show live; the app itself never inspects the environment.
  cache?: boolean;
  csrfSecret?: string; // HMAC key for the double-submit CSRF token (config.csrfSecret); random if omitted
  denylist?: Denylist; // optional instant-revoke; the hot path rejects revoked subjects, admin writes record revokes
  hydra?: HydraAdmin; // Hydra admin client; with kratos enables the OAuth2 login challenge
  jwks?: JwksProvider; // verify the session JWT → ctx.user/roles; absent ⇒ always anonymous
  keto?: KetoClient; // Keto client; with kratos+kratosAdmin enables login completion
  kratos?: KratosPublic; // Kratos public client; enables the themed self-service routes
  kratosAdmin?: KratosAdmin; // Kratos admin client; with kratos+keto enables login completion
  log?: Log; // app-level logger; per-request access log + trace span. Default: silent (tests)
  menu?: MenuConfig; // central override + branding (config/menu.ts); defaults to DEFAULT_MENU
  plugins?: Plugin[]; // discovered manifests to mount (router); empty until discovery runs
  pluginsDir?: string; // where plugin views/static live; defaults to the scanned plugins/
  publicDir?: string;
  secureCookies?: boolean; // set Secure on our session/CSRF cookies (config.secureCookies; off in dev http)
  viewsDir?: string;
}

export function createApp(options: AppOptions = {}): Server {
  // The denylist (when enabled) rides in the verify options so resolveSession rejects a revoked
  // subject on the hot path; the bound `revoke` is handed to the admin handlers that should
  // revoke instantly. Both absent ⇒ the feature is fully off (no cost, no behaviour change).
  const denylist = options.denylist;
  const authOptions: VerifyOptions = denylist ? { ...(options.auth ?? {}), denylist } : (options.auth ?? {});
  const revoke = denylist ? (sub: string): void => denylist.revoke(sub) : undefined;
  const cache = options.cache ?? false;
  // Canonical public host (APP_URL): when set, an off-host GET/HEAD visitor is redirected here so
  // every cookie (esp. Kratos' cross-origin CSRF cookie) shares one host. Omitted ⇒ feature off.
  const canonical = options.appUrl ? new URL(options.appUrl) : undefined;
  const canonicalHost = canonical?.host; // host[:port], default ports omitted — matches the Host header
  const canonicalOrigin = canonical?.origin; // scheme + host[:port], no trailing slash
  const csrfSecret = options.csrfSecret ?? randomBytes(32).toString("hex"); // server passes config; tests pass their own
  const secureCookies = options.secureCookies ?? false;
  const hydra = options.hydra;
  const jwks = options.jwks;
  const keto = options.keto;
  const kratos = options.kratos;
  const kratosAdmin = options.kratosAdmin;
  // Privileged host services handed to a system plugin via ctx.system — the Ory admin clients and
  // the instant-revoke hook. Only the wired capabilities are present; with none wired ctx.system
  // stays undefined, so an ordinary deployment (no Ory, hence no system plugin) pays nothing.
  const system: SystemCapabilities | undefined = kratosAdmin || keto || hydra || revoke
    ? { ...(hydra ? { hydra } : {}), ...(keto ? { keto } : {}), ...(kratosAdmin ? { kratosAdmin } : {}), ...(revoke ? { revoke } : {}) }
    : undefined;
  // Silent default so unit/integration tests stay quiet; server.ts injects the configured logger.
  const log = options.log ?? createLogger({ level: "none" });
  const menu = options.menu ?? DEFAULT_MENU;
  const plugins = options.plugins ?? [];
  const pluginIds = new Set(plugins.map((p) => p.id));
  // A plugin may fully replace the public landing "/" (`home`) or the gated dashboard "/dashboard"
  // (`dashboard`) — Discovery's findConflicts guarantees at most one of each, so `find` is
  // unambiguous; the predicates narrow the slot to defined.
  const homePlugin = plugins.find((p): p is Plugin & { home: RouteHandler } => typeof p.home === "function");
  const dashboardPlugin = plugins.find((p): p is Plugin & { dashboard: RouteHandler } => typeof p.dashboard === "function");
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

  // A `view` RouteResult renders plugins/<id>/views/<view>.ejs; such views may include() the core
  // building-block partials (resolved from viewsDir) and their own partials/subfolders.
  const renderView = renderPluginView({ cache, coreViewsDir: viewsDir, pluginsDir });

  const sendHtml = (res: ServerResponse, status: number, html: string): void => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  };

  // The public landing "/": ungated — anyone may see it. A plugin may fully own it via `home`
  // (rendered against its own views, native shell via ctx.chrome, with a fresh CSRF cookie for
  // any form it ships). Else the built-in intro page with prominent sign-in / register links
  // (`user` picks "go to dashboard" vs sign-in; the shell's Sign-out form needs the CSRF cookie).
  const serveHome = async (ctx: RequestContext, csrf: RequestCsrf): Promise<RouteResult | null> => {
    csrf.setCookie();
    if (homePlugin) {
      const result = (await homePlugin.home(ctx)) ?? null;
      if (anyResponseHooks) await runResponseHooks(plugins, ctx, result);
      await sendResult(ctx.res, result, (view, data) => renderView(homePlugin.id, view, data));
      return null;
    }
    return { data: { chrome: ctx.chrome, user: ctx.user }, view: "home" };
  };

  // The post-login app home "/dashboard", gated to a signed-in user: anonymous bounces to sign
  // in, remembering /dashboard as return_to. A plugin may fully own it via `dashboard` — its
  // handler renders against its own views, same path as a plugin route. Else the built-in
  // mock-data People list with the one global menu (ctx.chrome.nav) + branding from config/menu.ts.
  const serveDashboard = async (ctx: RequestContext, csrf: RequestCsrf): Promise<RouteResult | null> => {
    if (!ctx.user) return { redirect: loginRedirect(ctx), status: 303 };
    // The page carries the Sign-out form, so Set-Cookie a fresh CSRF token here when absent.
    csrf.setCookie();
    if (dashboardPlugin) {
      const result = (await dashboardPlugin.dashboard(ctx)) ?? null;
      if (anyResponseHooks) await runResponseHooks(plugins, ctx, result);
      await sendResult(ctx.res, result, (view, data) => renderView(dashboardPlugin.id, view, data));
      return null;
    }
    return { data: { model: buildDashboardModel({ csrfToken: csrf.token, menu, nav: ctx.chrome.nav, user: ctx.user }) }, view: "index" };
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
    try {
      const method = req.method ?? "GET";
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

      // Set before any branch so every response — static/redirect/error included — inherits them
      // (writeHead merges these with its own headers; a plugin's RouteResult.headers can override).
      for (const [name, value] of secHeaderEntries) res.setHeader(name, value);

      if (pathname.startsWith("/public/") && (method === "GET" || method === "HEAD")) {
        // /public/<id>/… serves a plugin's public/; everything else the core public/.
        // Before auth: assets don't need a verified user, and the JWT cookie rides every request.
        const { dir, subPath } = routePublic(pathname.slice("/public/".length), publicDir, pluginsDir, pluginIds);
        await serveStatic(dir, subPath, res, method === "HEAD", (err) => reqLog.error("static stream error", { error: String(err) }));
        return;
      }

      // Canonical host (APP_URL): a visitor who reached us on a different host (localhost vs
      // 127.0.0.1, a secondary domain) is sent to the configured origin, path + query preserved, so
      // the browser, the themed forms, and the cross-origin Kratos POST all share one cookie host —
      // otherwise the host-scoped Kratos CSRF cookie is lost and login dumps onto /error. Static
      // assets above are served on any host (health checks). GET/HEAD only — a 308 must not replay a
      // cross-host POST; first-party forms are always served from a canonical page anyway.
      if (canonicalHost && (method === "GET" || method === "HEAD")) {
        const host = req.headers.host;
        if (host !== undefined && host !== canonicalHost) {
          res.writeHead(308, { location: canonicalOrigin + (req.url ?? "/") }).end();
          return;
        }
      }

      // Verify the session JWT once (cached JWKS) → ctx.user/roles; none/invalid ⇒ anonymous.
      // If the token has lapsed but a live Kratos session still backs it (and we have the Ory
      // clients), silently re-mint it — "stay signed in": re-read roles from Keto, re-tokenize,
      // and set the fresh cookie via setHeader so it rides whatever response this request produces
      // (a dead session clears the stale cookie). This is the only place the hot path touches Ory.
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
            // Ory unreachable (Kratos/Keto 5xx, refused, timeout) — degrade to anonymous instead of
            // 500ing every lapsed request. Leave the cookie alone: it can re-mint once Ory recovers.
            reqLog.warn("session re-mint failed (Ory unreachable?)", { error: String(err) });
          }
        }
      }
      // CSRF token for this request's first-party forms: reuse a genuine cookie token, else mint
      // one (a page-emitting handler Set-Cookies it via csrfMint). Verified on our own
      // state-changing routes.
      const csrf = ensureCsrfToken(req.headers.cookie, csrfSecret);
      const csrfMint: RequestCsrf = {
        setCookie: (): void => { if (csrf.fresh) res.appendHeader("set-cookie", csrfCookie(csrf.token, { secure: secureCookies })); },
        token: csrf.token,
      };
      // Bound CSRF verifier handed to plugins via ctx.verifyCsrf (the host owns the secret).
      const verifyCsrf = (submitted: string | null | undefined): boolean =>
        verifyCsrfRequest({ cookieHeader: req.headers.cookie, secret: csrfSecret, submitted });
      // Chrome (brand/global-nav/user/theme/csrf) composes the whole menu, so it's resolved lazily and
      // at most once per request: this app-level memo shares it across the contexts below, and each
      // ctx.chrome getter only triggers it when a handler actually reads it (a json/redirect handler,
      // or the public "/" with a standalone home, never composes the menu).
      let chromeMemo: PageChrome | undefined;
      const chrome = (): PageChrome => (chromeMemo ??= buildPluginChrome({ csrfToken: csrf.token, currentPath: pathname, menu, plugins, user }));

      // base context (no route params yet); reused for onRequest hooks and the landing routes.
      const ctx = buildContext(req, res, { chrome, log: reqLog, user, verifyCsrf, ...(system ? { system } : {}) });

      // Plugin onRequest hooks run before routing and may short-circuit the request.
      if (anyRequestHooks) {
        const short = await runRequestHooks(plugins, ctx);
        if (short) {
          // Set the fresh CSRF cookie like every other page-emitting path, so a form the hook
          // renders (its token is in ctx.chrome.csrfToken) has the matching double-submit cookie.
          csrfMint.setCookie();
          await sendResult(res, short.result, (view, data) => renderView(short.plugin.id, view, data));
          return;
        }
      }

      // Plugin routes (any method): gate on the route's permission, then run the handler. The
      // handler gets ctx.chrome (native app shell) + ctx.verifyCsrf (guard its own forms); a fresh
      // CSRF cookie is set so those forms have a valid double-submit token.
      const match = matchRoute(plugins, method, pathname);
      if (match) {
        const routeCtx = buildContext(req, res, { chrome, log: reqLog, params: match.params, user, verifyCsrf, ...(system ? { system } : {}) });
        if (!isAuthorized(match.route, routeCtx.roles)) {
          // Anonymous → sign in (like the built-in screens' requireSession), remembering the page as
          // return_to; a signed-in user who simply lacks the role gets the 403 page.
          if (!routeCtx.user) { res.writeHead(303, { location: loginRedirect(routeCtx) }).end(); return; }
          reqLog.warn("forbidden: missing role", { path: pathname, required: match.route.permission ?? "", sub: routeCtx.user.id });
          sendHtml(res, 403, await render("403", { title: "Forbidden" }));
          return;
        }
        csrfMint.setCookie();
        const result = (await match.route.handler(routeCtx)) ?? null;
        if (anyResponseHooks) await runResponseHooks(plugins, routeCtx, result); // observers; a throw → 500
        await sendResult(res, result, (view, data) => renderView(match.plugin.id, view, data));
        return;
      }

      // Built-in endpoints (the auth/OAuth2 group, the landing slots, /error) from the internal
      // route table — same handler shape as plugin routes; a `view` result renders the core views,
      // null means the handler wrote to ctx.res itself.
      const builtin = matchBuiltinRoute(builtinRoutes, method, pathname);
      if (builtin) {
        await sendResult(res, await builtin.handler(ctx, csrfMint), render);
        return;
      }

      // Known path, wrong method → 405 with Allow; otherwise nothing here → 404.
      const allow = allowedMethods(plugins, pathname);
      if (allow.length) {
        res.writeHead(405, { allow: allow.join(", "), "content-type": "text/plain; charset=utf-8" }).end("Method Not Allowed");
        return;
      }
      sendHtml(res, 404, await render("404", { title: "Not found" }));
    } catch (err) {
      // A guard thrown anywhere in handling maps to a response (not a 500): a `location` ⇒ a
      // redirect (requireSession → /login), otherwise the status renders the error page.
      if (err instanceof GuardError) {
        if (res.headersSent) return void res.end();
        if (err.location) return void res.writeHead(303, { location: err.location }).end();
        return void sendHtml(res, err.status, await render("403", { title: "Forbidden" }));
      }
      reqLog.error("unhandled request error", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
      if (res.headersSent) return void res.end(); // a partial body is already on the wire
      try {
        // Render before writing: if the 500 page itself throws, headers stay unsent
        // and we fall back to plain text below instead of a half-written response.
        sendHtml(res, 500, await render("500", { title: "Server error" }));
      } catch (renderErr) {
        reqLog.error("error page render failed", { error: renderErr instanceof Error ? (renderErr.stack ?? renderErr.message) : String(renderErr) });
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("Internal Server Error");
      }
    }
  };

  return createServer((req, res) => {
    // Per-request log + trace span: a "request" span, continuing an upstream W3C traceparent
    // when present (distributed tracing across a proxy). "close" (not "finish") fires on both a
    // completed response and a premature disconnect/abort, so an aborted/truncated request is still
    // logged and its span flushed.
    const startMs = Date.now();
    const reqLog = requestLogger(log, {
      requestId: randomUUID(),
      ...(typeof req.headers.traceparent === "string" ? { traceparent: req.headers.traceparent } : {}),
    });
    // end() must run exactly once, after BOTH the handler has fully unwound (settled) AND the
    // response has closed (the access line is then emitted with the final status). Ending earlier
    // would throw "already ended" from a still-running handler's ctx.log/tracedFetch on a client
    // abort, or drop the access line on the happy path (handler settles before close). Coordinating
    // the two signals avoids both. Logging must never crash a served request, so it's all guarded.
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
    // Make reqLog ambient for the whole handler (sync body + every await) so all outbound fetch is
    // traced. handleRequest owns its own try/catch; the .catch logs a pathological escape via the
    // app logger (not reqLog, which may be the thing that broke), never crashing the request.
    void runWithLog(reqLog, () => handleRequest(req, res, reqLog))
      .catch((err) => log.error("request handler escaped its try/catch", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) }))
      .finally(() => { settled = true; finalize(); });
  });
}

type ViewRenderer = (view: string, data: Record<string, unknown>) => Promise<string>;

// Turn a handler's RouteResult into the HTTP response. `null` = the handler took over `ctx.res`
// itself (the void escape hatch). Author `headers` override the content-type default.
async function sendResult(res: ServerResponse, result: RouteResult | null, renderView: ViewRenderer): Promise<void> {
  if (result == null || res.writableEnded) return;
  if ("redirect" in result) {
    res.writeHead(result.status ?? 303, { location: result.redirect }).end();
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
