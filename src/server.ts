import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { discoverPlugins } from "./discovery.ts";

const config = loadConfig(); // validates the env (incl. enforced secrets) — fails loud at boot

const plugins = await discoverPlugins(); // scans plugins/, validates — fails loud on a bad plugin (router wiring is next §2)
console.log(`Discovered ${plugins.length} plugin(s)${plugins.length ? `: ${plugins.map((p) => p.id).join(", ")}` : ""}`);

const server = createApp({ cache: config.cacheTemplates }).listen(config.port, () => {
  console.log(`Listening on http://localhost:${config.port}`);
});

// Drain in-flight requests on container stop instead of cutting them mid-response.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
