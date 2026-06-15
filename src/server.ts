import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const { port } = loadConfig(); // validates the env (incl. prod secrets) — fails loud at boot

const server = createApp().listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});

// Drain in-flight requests on container stop instead of cutting them mid-response.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
