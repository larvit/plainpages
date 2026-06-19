import { randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";
import { ADMIN_CLIENTS_BASE, ADMIN_GROUPS_BASE, ADMIN_ROLES_BASE, ADMIN_USERS_BASE } from "./admin-nav.ts";
import { type AdminClientsDeps, handleAdminClients } from "./admin-clients.ts";
import { type AdminGroupsDeps, handleAdminGroups } from "./admin-groups.ts";
import { type AdminRolesDeps, handleAdminRoles } from "./admin-roles.ts";
import { type AdminUsersDeps, handleAdminUsers } from "./admin-users.ts";
import { readFormBody } from "./body.ts";
import { buildPluginChrome } from "./chrome.ts";
import { buildContext, type User } from "./context.ts";
import { CSRF_FIELD, csrfCookie, ensureCsrfToken, verifyCsrfRequest } from "./csrf.ts";
import { buildDashboardModel } from "./dashboard.ts";
import { PLUGINS_DIR } from "./discovery.ts";
import { GuardError } from "./guards.ts";
import { AUTH_FLOWS, buildFlowView } from "./flow-view.ts";
import { runRequestHooks, runResponseHooks } from "./hooks.ts";
import { HydraError, type HydraAdmin } from "./hydra-admin.ts";
import type { JwksProvider } from "./jwks.ts";
import { resolveSession, type VerifyOptions } from "./jwt-middleware.ts";
import type { KetoClient } from "./keto-client.ts";
import type { KratosAdmin } from "./kratos-admin.ts";
import { KratosError, type KratosPublic } from "./kratos-public.ts";
import { clearSessionCookie, completeLogin, remintSession, sessionCookie } from "./login.ts";
import { resolveLoginChallenge } from "./oauth-login.ts";
import { acceptConsent, rejectConsent, resolveConsentChallenge } from "./oauth-consent.ts";
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
  csrfSecret?: string; // HMAC key for the double-submit CSRF token (config.csrfSecret); random if omitted
  hydra?: HydraAdmin; // Hydra admin client; with kratos enables the OAuth2 login challenge (§6)
  jwks?: JwksProvider; // verify the session JWT → ctx.user/roles (§4); absent ⇒ always anonymous
  keto?: KetoClient; // Keto client; with kratos+kratosAdmin enables login completion (§4)
  kratos?: KratosPublic; // Kratos public client; enables the themed self-service routes (§4)
  kratosAdmin?: KratosAdmin; // Kratos admin client; with kratos+keto enables login completion (§4)
  menu?: MenuConfig; // central override + branding (config/menu.ts); defaults to DEFAULT_MENU
  plugins?: Plugin[]; // discovered manifests to mount (router); empty until §2 discovery runs
  pluginsDir?: string; // where plugin views/static live; defaults to the scanned plugins/
  publicDir?: string;
  secureCookies?: boolean; // set Secure on our session/CSRF cookies (config.secureCookies; off in dev http)
  viewsDir?: string;
}

export function createApp(options: AppOptions = {}): Server {
  const authOptions = options.auth ?? {};
  const cache = options.cache ?? false;
  const csrfSecret = options.csrfSecret ?? randomBytes(32).toString("hex"); // server passes config; tests pass their own
  const secureCookies = options.secureCookies ?? false;
  const hydra = options.hydra;
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

  // `views: [viewsDir]` lets a view in a subfolder (e.g. admin/users.ejs) include() the shared
  // partials/ by the same root-relative name top-level views use (EJS tries relative first).
  const render = (view: string, data: Record<string, unknown>): Promise<string> =>
    ejs.renderFile(join(viewsDir, `${view}.ejs`), data, { cache, views: [viewsDir] });

  // A `view` RouteResult renders plugins/<id>/views/<view>.ejs; such views may include() the core
  // building-block partials (resolved from viewsDir) and their own partials/subfolders.
  const renderView = renderPluginView({ cache, coreViewsDir: viewsDir, pluginsDir });

  // Built-in admin screens (§5) — wired only when their Ory clients are present (the writes go
  // there). They render core views via `render` and are gated/CSRF-guarded inside the handler.
  // Users writes to Kratos; Groups writes to Keto and reads users from Kratos for the pickers.
  const adminDeps: AdminUsersDeps | null = kratosAdmin ? { csrfSecret, kratosAdmin, menu, render } : null;
  const adminGroupsDeps: AdminGroupsDeps | null = kratosAdmin && keto ? { csrfSecret, keto, kratosAdmin, menu, render } : null;
  const adminRolesDeps: AdminRolesDeps | null = kratosAdmin && keto ? { csrfSecret, keto, kratosAdmin, menu, render } : null;
  // OAuth2 clients (§6) write to Hydra; wired only when the Hydra admin client is present.
  const adminClientsDeps: AdminClientsDeps | null = hydra ? { csrfSecret, hydra, menu, render } : null;

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
      // If the token has lapsed but a live Kratos session still backs it (and we have the Ory
      // clients), silently re-mint it — "stay signed in" (§4): re-read roles from Keto, re-tokenize,
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
            console.error("session re-mint failed (Ory unreachable?):", err);
          }
        }
      }
      // CSRF token for this request's first-party forms: reuse a genuine cookie token, else mint
      // one (the form page below Set-Cookies it). Verified on our own state-changing routes (§4).
      const csrf = ensureCsrfToken(req.headers.cookie, csrfSecret);
      // Bound CSRF verifier handed to plugins via ctx.verifyCsrf (the host owns the secret).
      const verifyCsrf = (submitted: string | null | undefined): boolean =>
        verifyCsrfRequest({ cookieHeader: req.headers.cookie, secret: csrfSecret, submitted });
      // base context (no route params yet); reused for onRequest. Chrome is built lazily — only
      // plugin routes (and an onRequest short-circuit) read ctx.chrome, so the hot path stays free.
      const ctx = buildContext(req, res, {
        user, verifyCsrf,
        ...(anyRequestHooks ? { chrome: buildPluginChrome({ csrfToken: csrf.token, currentPath: pathname, menu, plugins, user }) } : {}),
      });

      // Plugin onRequest hooks run before routing and may short-circuit the request.
      if (anyRequestHooks) {
        const short = await runRequestHooks(plugins, ctx);
        if (short) {
          await sendResult(res, short.result, (view, data) => renderView(short.plugin.id, view, data));
          return;
        }
      }

      // Plugin routes (any method): gate on the route's permission, then run the handler. The
      // handler gets ctx.chrome (native app shell) + ctx.verifyCsrf (guard its own forms); a fresh
      // CSRF cookie is set so those forms have a valid double-submit token.
      const match = matchRoute(plugins, method, pathname);
      if (match) {
        const chrome = buildPluginChrome({ csrfToken: csrf.token, currentPath: pathname, menu, plugins, user });
        const routeCtx = buildContext(req, res, { chrome, params: match.params, user, verifyCsrf });
        if (!isAuthorized(match.route, routeCtx.roles)) {
          sendHtml(res, 403, await render("403", { title: "Forbidden" }));
          return;
        }
        if (csrf.fresh) res.appendHeader("set-cookie", csrfCookie(csrf.token, { secure: secureCookies }));
        const result = (await match.route.handler(routeCtx)) ?? null;
        if (anyResponseHooks) await runResponseHooks(plugins, routeCtx, result); // observers; a throw → 500
        await sendResult(res, result, (view, data) => renderView(match.plugin.id, view, data));
        return;
      }

      // Built-in admin screens (§5). Each handler gates (admin only; throws GuardError the catch
      // maps), CSRF-guards mutations, and returns html/redirect. Set the page's CSRF cookie when
      // freshly minted (its forms carry the matching token); null ⇒ unknown subpath → 404.
      if (adminDeps && pathname.startsWith(ADMIN_USERS_BASE)) {
        const result = await handleAdminUsers(ctx, csrf.token, adminDeps);
        if (result) {
          if (csrf.fresh) res.appendHeader("set-cookie", csrfCookie(csrf.token, { secure: secureCookies }));
          await sendResult(res, result, () => Promise.reject(new Error("admin screens return html, not view")));
          return;
        }
      }
      if (adminGroupsDeps && pathname.startsWith(ADMIN_GROUPS_BASE)) {
        const result = await handleAdminGroups(ctx, csrf.token, adminGroupsDeps);
        if (result) {
          if (csrf.fresh) res.appendHeader("set-cookie", csrfCookie(csrf.token, { secure: secureCookies }));
          await sendResult(res, result, () => Promise.reject(new Error("admin screens return html, not view")));
          return;
        }
      }
      if (adminRolesDeps && pathname.startsWith(ADMIN_ROLES_BASE)) {
        const result = await handleAdminRoles(ctx, csrf.token, adminRolesDeps);
        if (result) {
          if (csrf.fresh) res.appendHeader("set-cookie", csrfCookie(csrf.token, { secure: secureCookies }));
          await sendResult(res, result, () => Promise.reject(new Error("admin screens return html, not view")));
          return;
        }
      }
      if (adminClientsDeps && pathname.startsWith(ADMIN_CLIENTS_BASE)) {
        const result = await handleAdminClients(ctx, csrf.token, adminClientsDeps);
        if (result) {
          if (csrf.fresh) res.appendHeader("set-cookie", csrfCookie(csrf.token, { secure: secureCookies }));
          await sendResult(res, result, () => Promise.reject(new Error("admin screens return html, not view")));
          return;
        }
      }

      // Themed Kratos self-service pages (login/registration/recovery/verification/settings).
      const flowType = AUTH_FLOWS[pathname];
      if (kratos && flowType && (method === "GET" || method === "HEAD")) {
        const cookie = req.headers.cookie;
        const flowId = ctx.url.searchParams.get("flow");
        if (!flowId) {
          // No flow yet: init one server-side, relay Kratos' CSRF cookie, bounce to ?flow=<id>.
          // A `return_to` (e.g. the OAuth2 login challenge bouncing here, §6) is baked into the
          // flow so Kratos lands back there after login instead of the default completion route.
          const returnTo = ctx.url.searchParams.get("return_to") ?? undefined;
          const { flow, setCookie } = await kratos.initBrowserFlow(flowType, { ...(cookie ? { cookie } : {}), ...(returnTo ? { returnTo } : {}) });
          if (setCookie.length) res.appendHeader("set-cookie", setCookie);
          res.writeHead(303, { location: `${pathname}?flow=${flow.id}` }).end();
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

      // OAuth2 login challenge (§6): Hydra hands the browser here when another app logs in
      // *through* us. Resolve it via the Kratos session and accept; an unauthenticated user
      // bounces to our themed login and returns here once signed in. Provider-only.
      if (hydra && kratos && pathname === "/oauth2/login" && (method === "GET" || method === "HEAD")) {
        const challenge = ctx.url.searchParams.get("login_challenge");
        if (!challenge) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Missing login_challenge");
          return;
        }
        // Absolute return target so Kratos lands back here post-login. Host reflects what the
        // browser used (so it matches Kratos' allowed_return_urls); scheme follows SECURE_COOKIES.
        // A spoofed Host can't escape — Kratos validates return_to against its allow-list.
        const origin = `${secureCookies ? "https" : "http"}://${req.headers.host ?? "127.0.0.1:3000"}`;
        const selfUrl = `${origin}/oauth2/login?login_challenge=${encodeURIComponent(challenge)}`;
        try {
          const { redirect } = await resolveLoginChallenge({ hydra, kratos }, challenge, req.headers.cookie, selfUrl);
          res.writeHead(303, { location: redirect }).end();
        } catch (err) {
          // A stale/invalid/consumed challenge (Hydra 4xx — back button, slow login, re-used URL) is
          // user-reachable: tell them to restart rather than 500. A 5xx (Hydra down) rethrows → 500.
          if (err instanceof HydraError && err.status < 500) {
            res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("This sign-in request has expired. Please start again from the application you were signing in to.");
          } else throw err;
        }
        return;
      }

      // OAuth2 consent challenge (§6): after login Hydra hands the browser here. A first-party
      // (or Hydra-skipped) client is auto-granted its scopes; a third-party client gets the themed
      // consent screen, whose CSRF-guarded POST accepts (Allow) or rejects (Deny). Provider-only.
      if (hydra && kratos && pathname === "/oauth2/consent") {
        const consentDeps = { hydra, kratos };
        try {
          if (method === "GET" || method === "HEAD") {
            const challenge = ctx.url.searchParams.get("consent_challenge");
            if (!challenge) {
              res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Missing consent_challenge");
              return;
            }
            const { redirect, view } = await resolveConsentChallenge(consentDeps, challenge, req.headers.cookie);
            if (redirect) {
              res.writeHead(303, { location: redirect }).end();
              return;
            }
            // Third-party: show the consent screen, carrying a CSRF token its form echoes back.
            if (csrf.fresh) res.appendHeader("set-cookie", csrfCookie(csrf.token, { secure: secureCookies }));
            sendHtml(res, 200, await render("oauth-consent", { brand: menu.branding.name, consent: view, csrfField: CSRF_FIELD, csrfToken: csrf.token }));
            return;
          }
          if (method === "POST") {
            const form = await readFormBody(req);
            if (!verifyCsrfRequest({ cookieHeader: req.headers.cookie, secret: csrfSecret, submitted: form.get(CSRF_FIELD) })) {
              sendHtml(res, 403, await render("403", { title: "Forbidden" }));
              return;
            }
            const challenge = form.get("consent_challenge");
            if (!challenge) {
              res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Missing consent_challenge");
              return;
            }
            const redirect = form.get("decision") === "allow"
              ? await acceptConsent(consentDeps, challenge, req.headers.cookie)
              : await rejectConsent(consentDeps, challenge);
            res.writeHead(303, { location: redirect }).end();
            return;
          }
        } catch (err) {
          // Stale/consumed challenge (Hydra 4xx) → recoverable 400; a genuine outage (5xx) → 500 (as /oauth2/login).
          if (err instanceof HydraError && err.status < 500) {
            res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("This authorization request has expired. Please start again from the application you were signing in to.");
            return;
          }
          throw err;
        }
      }

      // OAuth2 RP-initiated logout (§6): Hydra hands the browser here to end the OAuth2 session
      // (hydra.yml urls.logout). Accept the challenge and resume to Hydra's post-logout redirect;
      // the first-party POST /logout (below) owns the Kratos session + our JWT cookie. Provider-only.
      // GET-accept is safe (like the login/consent handlers): the challenge is Hydra-minted +
      // single-use, so a forged GET can't fabricate one — we skip only the optional "confirm logout?".
      if (hydra && pathname === "/oauth2/logout" && (method === "GET" || method === "HEAD")) {
        const challenge = ctx.url.searchParams.get("logout_challenge");
        if (!challenge) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Missing logout_challenge");
          return;
        }
        try {
          const { redirect } = await hydra.acceptLogoutRequest(challenge);
          res.writeHead(303, { location: redirect }).end();
        } catch (err) {
          // Stale/consumed challenge (Hydra 4xx) → recoverable 400; a genuine outage (5xx) → 500.
          if (err instanceof HydraError && err.status < 500) {
            res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("This logout request has expired. Please start again from the application you were signing out of.");
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
        res.appendHeader("set-cookie", sessionCookie(completed.jwt, { secure: secureCookies }));
        res.writeHead(303, { location: "/" }).end();
        return;
      }

      // Logout: a state change, so a CSRF-guarded POST (the shell submits a form, not a GET link).
      // Clear our local JWT and revoke the Kratos session — Kratos' own cookie lives on its origin,
      // so redirect to its logout URL (it revokes the session, clears plainpages_session, then lands
      // on /login per kratos.yml). No active session ⇒ just clear our cookie and go to /login.
      if (pathname === "/logout" && method === "POST" && kratos) {
        const form = await readFormBody(req);
        if (!verifyCsrfRequest({ cookieHeader: req.headers.cookie, secret: csrfSecret, submitted: form.get(CSRF_FIELD) })) {
          sendHtml(res, 403, await render("403", { title: "Forbidden" }));
          return;
        }
        const flow = await kratos.createLogoutFlow(req.headers.cookie ? { cookie: req.headers.cookie } : {});
        res.appendHeader("set-cookie", clearSessionCookie({ secure: secureCookies }));
        res.writeHead(303, { location: flow?.logoutUrl ?? "/login" }).end();
        return;
      }

      if (pathname === "/" && (method === "GET" || method === "HEAD")) {
        // Roles from the verified JWT (anonymous ⇒ []); branding/override come from config/menu.ts.
        // The page carries the Sign-out form, so Set-Cookie a fresh CSRF token here when absent.
        if (csrf.fresh) res.appendHeader("set-cookie", csrfCookie(csrf.token, { secure: secureCookies }));
        sendHtml(res, 200, await render("index", { model: buildDashboardModel(ctx.url, ctx.roles, menu, csrf.token, user, plugins) }));
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
