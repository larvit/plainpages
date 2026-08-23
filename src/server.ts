import { createApp } from "./http/app.ts";
import { loadConfig } from "./config.ts";
import { createDenylist } from "./auth/denylist.ts";
import { discoverPlugins } from "./plugin-host/discovery.ts";
import { HOST_API_VERSION } from "./plugin-host/plugin.ts";
import { withTimeout } from "./auth/fetch-timeout.ts";
import { runBootHooks } from "./plugin-host/hooks.ts";
import { createHydraAdmin } from "./auth/hydra-admin.ts";
import { createI18n } from "./i18n/runtime.ts";
import { loadI18n } from "./i18n/load.ts";
import { createJwksProvider } from "./auth/jwks.ts";
import { createKetoClient } from "./auth/keto-client.ts";
import { createKratosAdmin } from "./auth/kratos-admin.ts";
import { createKratosPublic } from "./auth/kratos-public.ts";
import { createLogger, tracedFetch } from "./logger.ts";
import { loadMenuConfig } from "./ui/menu-config.ts";
import { resolveSettings, settingsEnvNames, strayNames } from "./plugin-host/settings.ts";
import { buildCredentials, storagePluginIds, type StorageCredentials } from "./plugin-host/storage.ts";

const config = loadConfig(); // validates the env (incl. enforced secrets) — fails loud at boot
// The storage secret is in `config` now, so drop it from the environment before ANY plugin code
// runs: a plugin module's top level evaluates during discovery, long before onBoot. Defence in
// depth, not a boundary (AGENTS.md) — and only ever move this line earlier, never later.
delete process.env["PLUGIN_DB_SECRET"];
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
// hot path consults and the admin screens populate on deactivate/delete/permission-change.
const denylist = config.revocationDenylist ? createDenylist({ ttlSec: config.revocationTtlSec }) : undefined;

const plugins = await discoverPlugins(); // scans plugins/, validates — fails loud on a bad plugin
log.info("plugins discovered", { count: plugins.length, ids: plugins.map((p) => p.id).join(", ") });
// Translation catalogs: the core locales plus each discovered plugin's — fails loud if a locale
// drifts from its en-US baseline, so a half-translated deploy never reaches a visitor. Loaded
// before the boot hooks, so a catalog mismatch aborts before a plugin's onBoot has any side effect.
const i18n = createI18n(await loadI18n({ logger: log, pluginIds: plugins.map((p) => p.id) }));
log.info("locales loaded", { locales: i18n.available.join(", ") });

// A plugin's database credentials are derived, never stored — so the only thing that can be missing
// is the server itself. Refuse at boot rather than at that plugin's first query, hours later.
const pluginDbUrl = config.pluginDbUrl;
const declaresStorage = storagePluginIds(plugins);
if (declaresStorage.length > 0 && pluginDbUrl === undefined) {
  throw new Error(`config: PLUGIN_DB_URL must be set — these plugins declare storage: ${declaresStorage.join(", ")}`);
}

const storageCredentials = new Map<string, StorageCredentials>();
if (pluginDbUrl !== undefined) {
  for (const id of declaresStorage) storageCredentials.set(id, buildCredentials(pluginDbUrl, id, config.pluginDbSecret));
}
// Operator-supplied plugin settings, resolved against the environment the manifests declared. A bad
// or missing value is refused here rather than at that plugin's first use, hours later.
const settings = resolveSettings(plugins, process.env, { requireSecureSecrets: config.requireSecureSecrets });
if (settings.errors.length > 0) throw new Error(`Plugin settings:\n${settings.errors.map((e) => `  - ${e}`).join("\n")}`);
// A stray is usually a typo in the very variable the operator meant to set — naming it turns two
// unrelated-looking errors into one. Reported, never acted on.
const strays = strayNames(process.env, settingsEnvNames(plugins));
if (strays.length > 0) log.warn("settings variables no installed plugin declares", { variables: strays.join(", ") });

// onBoot is the only way storage credentials and settings are handed over, so without one they are
// resolved and undeliverable. A warning, not a refusal — the plugin still works, it just gets neither.
for (const [what, ids] of [
  ["settings", plugins.filter((plugin) => plugin.settings?.length && !plugin.hooks?.onBoot)],
  ["storage", plugins.filter((plugin) => plugin.storage && !plugin.hooks?.onBoot)],
] as const) {
  if (ids.length > 0) log.warn(`plugins declare ${what} but have no onBoot to receive it`, { plugins: ids.map((plugin) => plugin.id).join(", ") });
}

// plugin onBoot — after discovery, before listen; a throw aborts boot.
await runBootHooks(plugins, (plugin) => {
  const storage = storageCredentials.get(plugin.id);
  const values = settings.values.get(plugin.id);
  return { ...(values ? { settings: values } : {}), ...(storage ? { storage } : {}) };
});

const server = createApp({
  // Canonical-host redirect target (off-host GET/HEAD visitors are sent here). Opt-in: omitted unless
  // APP_URL is set, so the redirect is fully off — and costs nothing — when unconfigured.
  ...(config.appUrl ? { appUrl: config.appUrl } : {}),
  auth: { audience: config.jwtAudience, clockSkewSec: config.jwtClockSkewSec, issuer: config.jwtIssuer },
  cache: config.cacheTemplates,
  csrfSecret: config.csrfSecret,
  ...(denylist ? { denylist } : {}),
  hydra,
  i18n,
  jwks,
  keto,
  kratos,
  kratosAdmin,
  log,
  menu,
  plugins,
  secureCookies: config.secureCookies,
  settingsCatalog: settings.catalog,
}).listen(config.port, () => {
  log.info("listening", { apiVersion: HOST_API_VERSION, port: config.port, url: config.appUrl ?? `http://localhost:${config.port}` });
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
