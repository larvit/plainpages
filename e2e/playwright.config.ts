import { defineConfig, devices } from "@playwright/test";

// Visual + functional checks against the live app (the `web` compose service, BASE_URL). Run via
// compose.e2e.yml. Parallel per the project's E2E principle; deterministic colorScheme/viewport
// so the rendered design is stable across runs.
export default defineConfig({
  testDir: ".",
  outputDir: "artifacts/test-output",
  fullyParallel: true,
  forbidOnly: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "artifacts/report" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    colorScheme: "light",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
