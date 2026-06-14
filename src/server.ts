import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const { port } = loadConfig(); // validates the env (incl. prod secrets) — fails loud at boot

createApp().listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
