import { expect, test } from "@playwright/test";

// Regression: the from-scratch dev experience the README/banner advertises must work. `docker compose
// up`, open the printed login URL (http://localhost:3000), sign in as the seeded admin → you land on
// the dashboard, signed in. Originally this dumped the user on http://127.0.0.1:3000/error?id=…
// ("Page not found"): the banner printed `localhost` but kratos.yml hard-coded `127.0.0.1`, and a
// host-scoped Kratos CSRF cookie can't cross `localhost`↔`127.0.0.1`, so the cross-host login POST
// lost it and Kratos redirected to its error sink.
//
// The fix makes APP_URL the single source for the public host: the web app canonicalises every
// off-host visitor onto it (so localhost / 127.0.0.1 / any alias funnel to one cookie host), Kratos'
// browser URLs derive from it, and a real /error page replaces the 404.
//
// This is faithful to the user's environment: the runner uses the host network
// (compose.e2e-devstack.yml) against the plain `docker compose up` topology, so it sees
// http://localhost:3000 (web) and http://127.0.0.1:4433 (Kratos public) exactly as a host browser
// does. The proxied full-flow suite can't catch this regression — it fronts web + Kratos on one origin.
const ADMIN_EMAIL = "admin@plainpages.local"; // seeded by bootstrap
const ADMIN_PASSWORD = "admin";

async function signIn(page: import("@playwright/test").Page): Promise<void> {
  await page.fill('input[name="identifier"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.locator('.auth-form button[type="submit"]').click();
}

test("seeded admin logs in from the advertised URL (http://localhost:3000) and reaches the dashboard", async ({ page }) => {
  test.setTimeout(90_000);
  // Open the app at the URL the first-run banner prints, then follow its "Log in" call to action.
  await page.goto("/");
  await page.getByRole("link", { name: "Log in" }).click();
  await signIn(page);

  // Signed in on the app — NOT dumped on the Kratos /error "Page not found" page.
  await expect(page).not.toHaveURL(/\/error(\?|$)/);
  await expect(page.locator("h1"), 'must not land on the "Page not found" 404 view').not.toHaveText("Page not found");
  await expect(page.locator(".profile-mail")).toHaveText(ADMIN_EMAIL);
});

test("entering on the wrong host (http://127.0.0.1:3000) is canonicalised to APP_URL and login still works", async ({ page }) => {
  test.setTimeout(90_000);
  // The exact trigger from the bug report: a user types 127.0.0.1 instead of the advertised localhost.
  // The canonical-host redirect sends them to localhost before the flow starts, so the CSRF cookie
  // and the cross-origin Kratos POST share one host and login succeeds.
  await page.goto("http://127.0.0.1:3000/login");
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\//); // 308'd onto the canonical host
  await signIn(page);

  await expect(page).not.toHaveURL(/\/error(\?|$)/);
  await expect(page.locator(".profile-mail")).toHaveText(ADMIN_EMAIL);
});
