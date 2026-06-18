import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";
import { buildContext } from "./context.ts";
import { buildDashboardModel } from "./dashboard.ts";
import { PLUGINS_DIR } from "./discovery.ts";
import { AUTH_FLOWS, buildFlowView } from "./flow-view.ts";
import { runRequestHooks, runResponseHooks } from "./hooks.ts";
import type { JwksProvider } from "./jwks.ts";
import { authenticate, type VerifyOptions } from "./jwt-middleware.ts";
import type { KetoClient } from "./keto-client.ts";
import type { KratosAdmin } from "./kratos-admin.ts";
import { KratosError, type KratosPublic } from "./kratos-public.ts";
import { completeLogin, sessionCookie } from "./login.ts";
import { DEFAULT_MENU, type MenuConfig } from "./menu-config.ts";
import type { Plugin, RouteResult } from "./plugin.ts";
import { allowedMethods, isAuthorized, matchRoute } from "./router.ts";
import { routePublic, serveStatic } from "./static.ts";
import { renderPluginView } from "./view-resolver.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface AppOptions {
  auth?: VerifyOptions; // expected JWT issuer/audience + clock skew (config); used with jwks
  // Cache compiled templates; caller decides (server passes config.cacheTemplates).
  // Off by default so edits show live; the app itself never inspects the environment.
  cache?: boolean;
  jwks?: JwksProvider; // verify the session JWT → ctx.user/roles (§4); absent ⇒ always anonymous
  keto?: KetoClient; // Keto client; with kratos+kratosAdmin enables login completion (§4)
  kratos?: KratosPublic; // Kratos public client; enables the themed self-service routes (§4)
  kratosAdmin?: KratosAdmin; // Kratos admin client; with kratos+keto enables login completion (§4)
  menu?: MenuConfig; // central override + branding (config/menu.ts); defaults to DEFAULT_MENU
  plugins?: Plugin[]; // discovered manifests to mount (router); empty until §2 discovery runs
  pluginsDir?: string; // where plugin views/static live; defaults to the scanned plugins/
  publicDir?: string;
  viewsDir?: string;
}

export function createApp(options: AppOptions = {}): Server {
  const authOptions = options.auth ?? {};
  const cache = options.cache ?? false;
  const jwks = options.jwks;
  const keto = options.keto;
  const kratos = options.kratos;
  const kratosAdmin = options.kratosAdmin;
  const menu = options.menu ?? DEFAULT_MENU;
  const plugins = options.plugins ?? [];
  const pluginIds = new Set(plugins.map((p) => p.id));
  // Skip the hook pipeline entirely unless a plugin declares the hook (keeps the hot path free).
  const anyRequestHooks = plugins.some((p) => p.hooks?.onRequest);
  const anyResponseHooks = plugins.some((p) => p.hooks?.onResponse);
  const pluginsDir = options.pluginsDir ?? PLUGINS_DIR;
  const publicDir = options.publicDir ?? join(rootDir, "public");
  const viewsDir = options.viewsDir ?? join(rootDir, "views");

  const render = (view: string, data: Record<string, unknown>): Promise<string> =>
    ejs.renderFile(join(viewsDir, `${view}.ejs`), data, { cache });

  // A `view` RouteResult renders plugins/<id>/views/<view>.ejs; such views may include() the core
  // building-block partials (resolved from viewsDir) and their own partials/subfolders.
  const renderView = renderPluginView({ cache, coreViewsDir: viewsDir, pluginsDir });

  const sendHtml = (res: ServerResponse, status: number, html: string): void => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  };

  return createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

      if (pathname.startsWith("/public/") && (method === "GET" || method === "HEAD")) {
        // /public/<id>/… serves a plugin's public/; everything else the core public/.
        // Before auth: assets don't need a verified user, and the JWT cookie rides every request.
        const { dir, subPath } = routePublic(pathname.slice("/public/".length), publicDir, pluginsDir, pluginIds);
        await serveStatic(dir, subPath, res, method === "HEAD");
        return;
      }

      // Verify the session JWT once (cached JWKS) → ctx.user/roles; none/invalid ⇒ anonymous.
      const user = jwks ? await authenticate(req.headers.cookie, jwks, authOptions) : null;
      const ctx = buildContext(req, res, { user }); // base context (no route params yet); reused for onRequest

      // Plugin onRequest hooks run before routing and may short-circuit the request.
      if (anyRequestHooks) {
        const short = await runRequestHooks(plugins, ctx);
        if (short) {
          await sendResult(res, short.result, (view, data) => renderView(short.plugin.id, view, data));
          return;
        }
      }

      // Plugin routes (any method): gate on the route's permission, then run the handler.
      const match = matchRoute(plugins, method, pathname);
      if (match) {
        const routeCtx = buildContext(req, res, { params: match.params, user });
        if (!isAuthorized(match.route, routeCtx.roles)) {
          sendHtml(res, 403, await render("403", { title: "Forbidden" }));
          return;
        }
        const result = (await match.route.handler(routeCtx)) ?? null;
        if (anyResponseHooks) await runResponseHooks(plugins, routeCtx, result); // observers; a throw → 500
        await sendResult(res, result, (view, data) => renderView(match.plugin.id, view, data));
        return;
      }

      // Themed Kratos self-service pages (login/registration/recovery/verification/settings).
      const flowType = AUTH_FLOWS[pathname];
      if (kratos && flowType && (method === "GET" || method === "HEAD")) {
        const cookie = req.headers.cookie;
        const flowId = ctx.url.searchParams.get("flow");
        if (!flowId) {
          // No flow yet: init one server-side, relay Kratos' CSRF cookie, bounce to ?flow=<id>.
          const { flow, setCookie } = await kratos.initBrowserFlow(flowType, cookie ? { cookie } : {});
          res.writeHead(303, { location: `${pathname}?flow=${flow.id}`, ...(setCookie.length ? { "set-cookie": setCookie } : {}) }).end();
          return;
        }
        try {
          const flow = await kratos.getFlow(flowType, flowId, cookie ? { cookie } : {});
          sendHtml(res, 200, await render("auth", { brand: menu.branding.name, flow: buildFlowView(flow, flowType) }));
        } catch (err) {
          // Expired/unknown flow → restart by re-initialising (drop the stale ?flow=).
          if (err instanceof KratosError && [403, 404, 410].includes(err.status)) {
            res.writeHead(303, { location: pathname }).end();
          } else throw err;
        }
        return;
      }

      // Login completion: where Kratos lands the browser after authenticating (kratos.yml).
      // Mint our session JWT — read roles from Keto, project onto the identity, tokenize —
      // and store it as the cookie; no active session bounces back to sign in (§4).
      if (pathname === "/auth/complete" && method === "GET" && kratos && kratosAdmin && keto) {
        const completed = await completeLogin({ keto, kratosAdmin, kratosPublic: kratos }, req.headers.cookie);
        if (!completed) {
          res.writeHead(303, { location: "/login" }).end();
          return;
        }
        // secure: off in dev http; the §9 cookie hardening toggles it on for prod.
        res.writeHead(303, { location: "/", "set-cookie": sessionCookie(completed.jwt) }).end();
        return;
      }

      if (pathname === "/" && (method === "GET" || method === "HEAD")) {
        // Roles from the verified JWT (anonymous ⇒ []); branding/override come from config/menu.ts.
        sendHtml(res, 200, await render("index", { model: buildDashboardModel(ctx.url, ctx.roles, menu) }));
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
      console.error(err);
      if (res.headersSent) return void res.end(); // a partial body is already on the wire
      try {
        // Render before writing: if the 500 page itself throws, headers stay unsent
        // and we fall back to plain text below instead of a half-written response.
        sendHtml(res, 500, await render("500", { title: "Server error" }));
      } catch (renderErr) {
        console.error(renderErr);
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("Internal Server Error");
      }
    }
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
