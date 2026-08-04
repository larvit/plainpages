import { type Browser, type Page, expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Full browser E2E: the real Playwright UI against the live stack via the same-origin
// gateway (e2e-tests/compose.full.yml) — the browser-UI login the earlier full-stack suites deferred here.
// Coverage is the test titles below, plus the standalone SSO test.
//
// Runs on a fresh stack (`down -v` after, like the other full-stack suites). The serial admin
// journey and the standalone SSO test run in parallel (fullyParallel) but stay independent: each
// uses its own browser context, and only the SSO test writes the mock-OIDC identity — keep it so
// (no cross-group shared backend writes) or serialise the file if that ever changes.
const ADMIN_EMAIL = "admin@plainpages.local"; // seeded by bootstrap, holds the admin permission in Keto
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

// The themed Kratos page in another language: our own chrome, Kratos' own strings mapped by id, and
// the card's own links keeping the choice (they are rendered by the flow body, not by the menu).
test("the login page speaks the visitor's language, links included", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login?locale=sv-SE");
  await expect(page.locator("html")).toHaveAttribute("lang", "sv-SE");
  await expect(page.getByRole("heading", { name: "Logga in" })).toBeVisible();
  await expect(page.getByLabel("Lösenord", { exact: true })).toBeVisible(); // Kratos' own field, labelled via auth.field.password
  await expect(page.getByRole("link", { name: "Glömt lösenordet?" })).toHaveAttribute("href", /locale=sv-SE/);
  await expect(page.getByRole("link", { name: "Skapa ett" })).toHaveAttribute("href", /locale=sv-SE/);
  await page.context().close();
});

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

  // The list screens rebuild their query from the list state (sort/page/filter), so they are where
  // a chosen language used to get dropped — the core building blocks carry it now.
  test("a sorted, paged admin list keeps the visitor's language", async () => {
    await page.goto("/admin/users?locale=sv-SE");
    await expect(page.locator("html")).toHaveAttribute("lang", "sv-SE");
    await expect(page.getByRole("heading", { name: "Användare" })).toBeVisible();

    await page.getByRole("link", { name: /E-postadress/ }).click(); // a sort header
    await expect(page).toHaveURL(/locale=sv-SE/);
    await expect(page.locator("html")).toHaveAttribute("lang", "sv-SE");

    await page.getByRole("button", { name: "Använd filter" }).click(); // the filter bar's GET form
    await expect(page).toHaveURL(/locale=sv-SE/);
    await expect(page.locator("html")).toHaveAttribute("lang", "sv-SE");

    await page.getByRole("button", { name: "Visa" }).click(); // the rows-per-page GET form
    await expect(page).toHaveURL(/locale=sv-SE/);
    await expect(page.locator("html")).toHaveAttribute("lang", "sv-SE");

    // The breadcrumb is the chrome's way back up — it is rendered by the shell, not by the screen.
    await page.getByRole("navigation", { name: "Sidsökväg" }).getByRole("link").first().click();
    await expect(page).toHaveURL(/locale=sv-SE/);
    await expect(page.locator("html")).toHaveAttribute("lang", "sv-SE");
  });

  // A POST that re-renders a page: the write must keep the language, and the picker — which is on
  // every page — must point somewhere that answers GET rather than at the POST-only URL.
  test("a write keeps the visitor's language, and the picker still works on the POST-rendered page", async () => {
    await page.goto("/admin/users?locale=sv-SE");
    await page.getByRole("link", { name: "Ny användare" }).click();
    await page.fill('input[name="email"]', `lang-${suffix}@plainpages.local`);
    await page.getByRole("button", { name: "Skapa användare" }).click();
    await expect(page).toHaveURL(/locale=sv-SE/); // the POST → redirect → GET keeps it
    await expect(page.locator("html")).toHaveAttribute("lang", "sv-SE");

    // Open the new user's edit page the way the CRUD test does — the row's Edit link carries the id.
    const row = page.locator("tr", { hasText: `lang-${suffix}@plainpages.local` });
    const editHref = await row.locator('a[href^="/admin/users/"]').first().getAttribute("href");
    await page.goto(`${editHref}`);
    await expect(page.locator('button[aria-label="Språk"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Skapa återställningskod" }).click(); // POST-only route
    await expect(page.getByText("Återställningskod skapad")).toBeVisible();

    // The picker is here too, and following it lands on a real page in the other language.
    await page.locator('button[aria-label="Språk"]').click();
    await page.getByRole("link", { name: /English/i }).click();
    expect(page.url()).toContain("locale=en-US");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.getByRole("heading", { name: "Edit user" })).toBeVisible(); // not a 405
  });

  test("menu filters by permission: an admin sees the gated Admin section + the plugin", async () => {
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

    // Row actions sit behind the kebab popover: opening it reveals them, in the top layer, so the
    // scrolling table around the row cannot clip the panel.
    await row.locator("button.kebab").click();
    await expect(row.locator('a[href^="/admin/users/"]').first()).toBeVisible();

    // Delete through the confirm interstitial (the row's Edit link carries the id).
    const editHref = await row.locator('a[href^="/admin/users/"]').first().getAttribute("href");
    await page.goto(`${editHref}/delete`);
    await page.getByRole("button", { name: "Delete user" }).click(); // the confirm form's danger button

    await expect(page).toHaveURL(/\/admin\/users(\?|$)/);
    await expect(page.locator("tr", { hasText: email })).toHaveCount(0);
  });

  test("groups + permissions CRUD: create one of each (writes go to Keto) and see them listed", async () => {
    // A Keto set exists only while it has ≥1 member, so create needs a first member (the form
    // enforces it); pick the first option (a user) from the required picker.
    const group = `e2e-grp-${suffix}`;
    await page.goto("/admin/groups/new");
    await page.fill('input[name="name"]', group);
    await page.locator('select[name="member"]').selectOption({ index: 1 });
    await page.locator('.form-card button[type="submit"]').click();
    await expect(page).toHaveURL(/\/admin\/groups(\?|\/|$)/);
    await expect(page.locator("main")).toContainText(group);

    const permission = `e2e-permission-${suffix}`;
    await page.goto("/admin/permissions/new");
    await page.fill('input[name="name"]', permission);
    await page.locator('select[name="member"]').selectOption({ index: 1 });
    await page.locator('.form-card button[type="submit"]').click();
    await expect(page).toHaveURL(/\/admin\/permissions(\?|\/|$)/);
    await expect(page.locator("main")).toContainText(permission);
  });

  test("OAuth2 clients CRUD: register a client (writes go to Hydra), see the one-time secret once, then delete it via the confirm step", async () => {
    const name = `e2e-client-${suffix}`;
    await page.goto("/admin/clients");
    await page.getByRole("link", { name: "Register client" }).click();
    await page.fill('input[name="name"]', name);
    await page.fill('textarea[name="redirectUris"]', "https://app.example.com/callback");
    await page.locator('.form-card button[type="submit"]').click();

    // Hydra returns the secret exactly once, so the POST renders the detail directly (no PRG).
    await expect(page.locator("h1")).toHaveText("Client registered");
    const clientId = await page.locator("#cid").inputValue();
    expect(clientId).toBeTruthy();
    await expect(page.locator("#csecret")).toHaveValue(/.+/);

    // Listed; the row header links to the plain detail, which never shows the secret again.
    await page.goto("/admin/clients");
    const row = page.locator("tr", { hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/clients/${clientId}`));
    await expect(page.locator("#csecret")).toHaveCount(0);

    // Delete through the confirm interstitial (danger link on the detail → confirm form's button).
    await page.getByRole("link", { name: "Delete client" }).click();
    await page.getByRole("button", { name: "Delete client" }).click();
    await expect(page).toHaveURL(/\/admin\/clients(\?|$)/);
    await expect(page.locator("tr", { hasText: name })).toHaveCount(0);
  });

  test("plugin page: the reference plugin renders its upstream shifts inside the native shell", async () => {
    await page.goto("/scheduling/shifts");
    await expect(page.locator("h1")).toHaveText("Shifts");
    await expect(page.locator("table")).toContainText("Morning — Front desk"); // seeded by the mock upstream
  });

  test("logout: signing out ends the session and returns to the login page", async () => {
    await page.goto("/dashboard");
    await page.locator("button.profile").click(); // open the profile dropdown
    // Sign out is the only item in it — the menu offers nothing that goes nowhere.
    await expect(page.locator("#profile-menu .menu-item")).toHaveText(["Sign out"]);
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
  // A fresh SSO identity holds no permissions, so the gated Admin section stays hidden.
  await expect(page.locator('.sidebar a[href="/admin/users"]')).toHaveCount(0);
});
