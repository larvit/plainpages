import { createApp } from "./http/app.ts";
import { loadConfig } from "./config.ts";
import { createDenylist } from "./auth/denylist.ts";
import { discoverPlugins } from "./plugin-host/discovery.ts";
import { withTimeout } from "./auth/fetch-timeout.ts";
import { runBootHooks } from "./plugin-host/hooks.ts";
import { createHydraAdmin } from "./auth/hydra-admin.ts";
import { createJwksProvider } from "./auth/jwks.ts";
import { createKetoClient } from "./auth/keto-client.ts";
import { createKratosAdmin } from "./auth/kratos-admin.ts";
import { createKratosPublic } from "./auth/kratos-public.ts";
import { createLogger, tracedFetch } from "./logger.ts";
import { loadMenuConfig } from "./ui/menu-config.ts";

const config = loadConfig(); // validates the env (incl. enforced secrets) — fails loud at boot
// App-level logger: structured, OTLP-capable when OTLP_ENDPOINT is set. The hot path clones it
// per request for access logging + a trace span (src/http/app.ts); console-only otherwise.
const log = createLogger({ format: config.logFormat, level: config.logLevel, otlpEndpoint: config.otlpEndpoint, otlpProtocol: config.otlpProtocol, serviceName: config.serviceName });
const menu = await loadMenuConfig(); // config/menu.ts override + branding — fails loud if malformed
// Every outbound Ory call is traced through the active request's logger (a client span continuing
// the trace + a propagated traceparent — tracedFetch) and bounded by the Ory timeout, so a hung/
// silent Ory can't park a request handler forever. Off the request path it's a plain timed fetch.
const oryFetch = withTimeout(tracedFetch, config.oryTimeoutSec * 1000);
// Ory clients for the themed self-service routes + login completion.
const kratos = createKratosPublic({ baseUrl: config.kratosPublicUrl, fetchImpl: oryFetch });
const kratosAdmin = createKratosAdmin({ baseUrl: config.kratosAdminUrl, fetchImpl: oryFetch });
const keto = createKetoClient({ fetchImpl: oryFetch, readUrl: config.ketoReadUrl, writeUrl: config.ketoWriteUrl });
// Hydra admin client for the OAuth2 login/consent challenge handshake.
const hydra = createHydraAdmin({ baseUrl: config.hydraAdminUrl, fetchImpl: oryFetch });
// Session-JWT verify key: primed at boot from the configured JWKS (file mount, base64 inline,
// or fetched http), then served from cache with TTL refresh + rotation-on-miss.
const jwks = await createJwksProvider(config.jwksUrl, { fetchImpl: oryFetch }); // bound an http JWKS fetch too
// Optional instant-revoke, off unless REVOCATION_DENYLIST=true: an in-memory denylist the
// hot path consults and the admin screens populate on deactivate/delete/role-change.
const denylist = config.revocationDenylist ? createDenylist({ ttlSec: config.revocationTtlSec }) : undefined;

const plugins = await discoverPlugins(); // scans plugins/, validates — fails loud on a bad plugin
log.info("plugins discovered", { count: plugins.length, ids: plugins.map((p) => p.id).join(", ") });
await runBootHooks(plugins); // plugin onBoot — after discovery, before listen; a throw aborts boot

const server = createApp({
  // Canonical-host redirect target (off-host GET/HEAD visitors are sent here). Opt-in: omitted unless
  // APP_URL is set, so the redirect is fully off — and costs nothing — when unconfigured.
  ...(config.appUrl ? { appUrl: config.appUrl } : {}),
  auth: { audience: config.jwtAudience, clockSkewSec: config.jwtClockSkewSec, issuer: config.jwtIssuer },
  cache: config.cacheTemplates,
  csrfSecret: config.csrfSecret,
  ...(denylist ? { denylist } : {}),
  hydra,
  jwks,
  keto,
  kratos,
  kratosAdmin,
  log,
  menu,
  plugins,
  secureCookies: config.secureCookies,
}).listen(config.port, () => {
  log.info("listening", { port: config.port, url: config.appUrl ?? `http://localhost:${config.port}` });
});

// Drain in-flight requests on container stop instead of cutting them mid-response, then flush any
// pending OTLP export before exiting so the last logs/spans aren't lost. Guard re-entry so a second
// signal (or SIGTERM-then-SIGINT during a slow drain) doesn't double-close or end() an ended log.
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    server.close(() => void log.end().finally(() => process.exit(0)));
  });
}
