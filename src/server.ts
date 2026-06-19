import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { discoverPlugins } from "./discovery.ts";
import { withTimeout } from "./fetch-timeout.ts";
import { runBootHooks } from "./hooks.ts";
import { createHydraAdmin } from "./hydra-admin.ts";
import { createJwksProvider } from "./jwks.ts";
import { createKetoClient } from "./keto-client.ts";
import { createKratosAdmin } from "./kratos-admin.ts";
import { createKratosPublic } from "./kratos-public.ts";
import { loadMenuConfig } from "./menu-config.ts";

const config = loadConfig(); // validates the env (incl. enforced secrets) — fails loud at boot
const menu = await loadMenuConfig(); // config/menu.ts override + branding — fails loud if malformed
// Every outbound Ory call is bounded so a hung/silent Ory can't park a request handler forever.
const oryFetch = withTimeout(fetch, config.oryTimeoutSec * 1000);
// Ory clients for the themed self-service routes + login completion (§4).
const kratos = createKratosPublic({ baseUrl: config.kratosPublicUrl, fetchImpl: oryFetch });
const kratosAdmin = createKratosAdmin({ baseUrl: config.kratosAdminUrl, fetchImpl: oryFetch });
const keto = createKetoClient({ fetchImpl: oryFetch, readUrl: config.ketoReadUrl, writeUrl: config.ketoWriteUrl });
// Hydra admin client for the OAuth2 login/consent challenge handshake (§6).
const hydra = createHydraAdmin({ baseUrl: config.hydraAdminUrl, fetchImpl: oryFetch });
// Session-JWT verify key: primed at boot from the configured JWKS (file mount, base64 inline,
// or fetched http), then served from cache with TTL refresh + rotation-on-miss (§4).
const jwks = await createJwksProvider(config.jwksUrl, { fetchImpl: oryFetch }); // bound an http JWKS fetch too

const plugins = await discoverPlugins(); // scans plugins/, validates — fails loud on a bad plugin
console.log(`Discovered ${plugins.length} plugin(s)${plugins.length ? `: ${plugins.map((p) => p.id).join(", ")}` : ""}`);
await runBootHooks(plugins); // plugin onBoot — after discovery, before listen; a throw aborts boot

const server = createApp({
  auth: { audience: config.jwtAudience, clockSkewSec: config.jwtClockSkewSec, issuer: config.jwtIssuer },
  cache: config.cacheTemplates,
  csrfSecret: config.csrfSecret,
  hydra,
  jwks,
  keto,
  kratos,
  kratosAdmin,
  menu,
  plugins,
  secureCookies: config.secureCookies,
}).listen(config.port, () => {
  console.log(`Listening on http://localhost:${config.port}`);
});

// Drain in-flight requests on container stop instead of cutting them mid-response.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
