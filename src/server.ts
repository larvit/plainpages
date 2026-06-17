import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { discoverPlugins } from "./discovery.ts";
import { runBootHooks } from "./hooks.ts";
import { createKratosPublic } from "./kratos-public.ts";
import { loadMenuConfig } from "./menu-config.ts";

const config = loadConfig(); // validates the env (incl. enforced secrets) — fails loud at boot
const menu = await loadMenuConfig(); // config/menu.ts override + branding — fails loud if malformed
const kratos = createKratosPublic({ baseUrl: config.kratosPublicUrl }); // themed self-service routes (§4)

const plugins = await discoverPlugins(); // scans plugins/, validates — fails loud on a bad plugin
console.log(`Discovered ${plugins.length} plugin(s)${plugins.length ? `: ${plugins.map((p) => p.id).join(", ")}` : ""}`);
await runBootHooks(plugins); // plugin onBoot — after discovery, before listen; a throw aborts boot

const server = createApp({ cache: config.cacheTemplates, kratos, menu, plugins }).listen(config.port, () => {
  console.log(`Listening on http://localhost:${config.port}`);
});

// Drain in-flight requests on container stop instead of cutting them mid-response.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
