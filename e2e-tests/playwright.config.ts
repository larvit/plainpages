import { defineConfig, devices } from "@playwright/test";

// Visual + functional checks against the live app (the `web` compose service, BASE_URL). Run via
// e2e-tests/compose.visual.yml. Parallel per the project's E2E principle; deterministic colorScheme/viewport
// so the rendered design is stable across runs.

const ORY_FREE = /(visual|language)\.spec\.ts$/;

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
  // The Ory-free suites run in all three engines: the console guard (console-guard.ts) only sees an
  // engine's warnings when that engine renders the page, and the newest platform features in the app
  // (popover, CSS anchor positioning, `:has()`) are exactly where engines disagree. They stay
  // side-effect-free, so three parallel runs of them don't collide. The Ory-backed suites write to
  // one shared backend and stay on chromium.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", testMatch: ORY_FREE, use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", testMatch: ORY_FREE, use: { ...devices["Desktop Safari"] } },
  ],
});
