import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig(); // validates the env (incl. enforced secrets) — fails loud at boot

const server = createApp({ cache: config.cacheTemplates }).listen(config.port, () => {
  console.log(`Listening on http://localhost:${config.port}`);
});

// Drain in-flight requests on container stop instead of cutting them mid-response.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
