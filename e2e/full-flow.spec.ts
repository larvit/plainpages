import { type Browser, type Page, expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Full browser E2E: the real Playwright UI against the live stack via the same-origin
// gateway (compose.e2e-full.yml) — the browser-UI login the earlier full-stack suites deferred here.
// Coverage is the test titles below, plus the standalone SSO test.
//
// Runs on a fresh stack (`down -v` after, like the other full-stack suites). The serial admin
// journey and the standalone SSO test run in parallel (fullyParallel) but stay independent: each
// uses its own browser context, and only the SSO test writes the mock-OIDC identity — keep it so
// (no cross-group shared backend writes) or serialise the file if that ever changes.
const ADMIN_EMAIL = "admin@plainpages.local"; // seeded by bootstrap, holds the admin role in Keto
const ADMIN_PASSWORD = "admin";
const SSO_EMAIL = "sso-user@plainpages.local"; // minted by the mock OIDC provider on first SSO login
const suffix = randomUUID().slice(0, 8); // unique per run so re-runs don't collide on names

// Drive the themed password login form → Kratos → /auth/complete → dashboard, signed in.
async function loginPassword(page: Page): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible(); // a path to password reset
  await page.fill('input[name="identifier"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.locator('.auth-form button[type="submit"]').click();
  await expect(page.locator(".profile-mail")).toHaveText(ADMIN_EMAIL); // waits through the redirect chain
}

test.describe.serial("authenticated admin journey", () => {
  let browser: Browser;
  let page: Page;

  test.beforeAll(async ({ browser: b }) => {
    browser = b;
    page = await (await browser.newContext()).newPage();
    test.setTimeout(90_000);
    await loginPassword(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test("menu filters by role: an admin sees the gated Admin section + the plugin", async () => {
    // The signed-in admin holds admin + scheduling:read/write, so both gated sections are present
    // in the menu (collapsed by default → assert they're in the DOM, not necessarily visible).
    await page.goto("/dashboard");
    await expect(page.locator('.sidebar a[href="/admin/users"]')).toHaveCount(1);
    await expect(page.locator('.sidebar a[href="/scheduling/shifts"]')).toHaveCount(1);
  });

  test("users CRUD: create a user, see it listed, then delete it via the confirm step", async () => {
    const email = `e2e-${suffix}@plainpages.local`;
    await page.goto("/admin/users/new");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="first"]', "E2E");
    await page.fill('input[name="last"]', "User");
    await page.locator('.form-card button[type="submit"]').click();

    await expect(page).toHaveURL(/\/admin\/users(\?|$)/); // PRG back to the list
    const row = page.locator("tr", { hasText: email });
    await expect(row).toBeVisible();

    // Delete through the confirm interstitial (the row's Edit link carries the id).
    const editHref = await row.locator('a[href^="/admin/users/"]').first().getAttribute("href");
    await page.goto(`${editHref}/delete`);
    await page.getByRole("button", { name: "Delete user" }).click(); // the confirm form's danger button

    await expect(page).toHaveURL(/\/admin\/users(\?|$)/);
    await expect(page.locator("tr", { hasText: email })).toHaveCount(0);
  });

  test("groups + roles CRUD: create one of each (writes go to Keto) and see them listed", async () => {
    // A Keto set exists only while it has ≥1 member, so create needs a first member (the form
    // enforces it); pick the first option (a user) from the required picker.
    const group = `e2e-grp-${suffix}`;
    await page.goto("/admin/groups/new");
    await page.fill('input[name="name"]', group);
    await page.locator('select[name="member"]').selectOption({ index: 1 });
    await page.locator('.form-card button[type="submit"]').click();
    await expect(page).toHaveURL(/\/admin\/groups(\?|\/|$)/);
    await expect(page.locator("main")).toContainText(group);

    const role = `e2e-role-${suffix}`;
    await page.goto("/admin/roles/new");
    await page.fill('input[name="name"]', role);
    await page.locator('select[name="member"]').selectOption({ index: 1 });
    await page.locator('.form-card button[type="submit"]').click();
    await expect(page).toHaveURL(/\/admin\/roles(\?|\/|$)/);
    await expect(page.locator("main")).toContainText(role);
  });

  test("plugin page: the reference plugin renders its upstream shifts inside the native shell", async () => {
    await page.goto("/scheduling/shifts");
    await expect(page.locator("h1")).toHaveText("Shifts");
    await expect(page.locator("table")).toContainText("Morning — Front desk"); // seeded by the mock upstream
  });

  test("logout: signing out ends the session and returns to the login page", async () => {
    await page.goto("/dashboard");
    await page.locator("summary.profile").click(); // open the profile dropdown
    await page.locator('form[action="/logout"] button[type="submit"]').click();
    await page.waitForURL(/\/login(\?|$)/);
    // The session is gone: /dashboard is gated, so it bounces back to the login page (no admin nav).
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.locator('.sidebar a[href="/admin/users"]')).toHaveCount(0);
  });
});

test("return_to: a deep link while logged out returns to that page after login", async ({ page }) => {
  test.setTimeout(90_000);
  // A gated deep link, logged out → bounced to the themed login (return_to is baked into the Kratos
  // flow server-side, so it's consumed, not shown in the settled URL).
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await page.fill('input[name="identifier"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.locator('.auth-form button[type="submit"]').click();
  // Completion routes through /auth/complete (mints the JWT) and on to the requested page, not the dashboard.
  await expect(page).toHaveURL(/\/admin\/users(\?|$)/);
  await expect(page.locator("h1")).toHaveText("Users");
});

test("mocked SSO login: the provider button signs a user in via OIDC", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  await expect(page.locator(".sso-btn")).toBeVisible(); // the configured provider renders a button
  await page.locator(".sso-btn").click();
  // Mock OIDC auto-approves → Kratos creates the identity → /auth/complete → dashboard, signed in.
  await expect(page.locator(".profile-mail")).toHaveText(SSO_EMAIL);
  // A fresh SSO identity holds no roles, so the gated Admin section stays hidden.
  await expect(page.locator('.sidebar a[href="/admin/users"]')).toHaveCount(0);
});
