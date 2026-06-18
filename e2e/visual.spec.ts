import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// The mockups are bind-mounted at /repo (sibling to /repo/public so their ../public/css/ resolves).
const MOCKUP = "file:///repo/html-css-foundation";
const APP_SHELL = `${MOCKUP}/App%20Shell.html`;
const AUTH = `${MOCKUP}/Auth.html`;
const SHOTS = "artifacts/screenshots";

const shot = (page: Page, name: string): Promise<Buffer> =>
  page.screenshot({ fullPage: true, path: `${SHOTS}/${name}.png` });

test.beforeAll(async () => { await mkdir(SHOTS, { recursive: true }); });

test("captures live pages + reference mockups for side-by-side review", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator("table.table tbody tr").first()).toBeVisible();
  await shot(page, "live-01-dashboard");

  await page.goto("/?sort=-name&status=active");
  await shot(page, "live-02-sorted-filtered");

  await page.goto("/");
  await page.locator("#theme-dark").check({ force: true }); // visually-hidden radio
  await shot(page, "live-03-dark");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await shot(page, "live-04-mobile");
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto(APP_SHELL);
  await shot(page, "mockup-01-app-shell");
  await page.goto(AUTH);
  await shot(page, "mockup-02-auth");
});

// The live DOM reuses the foundation's classes, so the same styles.css must compute identically
// on both — proof we render the intended graphics, independent of the (different) row data.
const PROPS = ["backgroundColor", "borderRadius", "borderTopColor", "color", "fontSize", "fontWeight"] as const;
const styleOf = (page: Page, selector: string): Promise<Record<string, string>> =>
  page.locator(selector).first().evaluate((el, props) => {
    const cs = getComputedStyle(el as Element);
    return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p) || (cs as unknown as Record<string, string>)[p]]));
  }, PROPS as unknown as string[]);

test("live components compute the same design-system styles as the reference mockup", async ({ page, context }) => {
  await page.goto("/");
  const ref = await context.newPage();
  await ref.goto(APP_SHELL);

  for (const selector of [".sidebar", ".topbar", ".brand", ".btn.btn-primary", ".theme-switch", ".filters", ".pager"]) {
    expect(await styleOf(page, selector), `computed style mismatch for ${selector}`).toEqual(await styleOf(ref, selector));
  }
  await ref.close();
});

test("every icon <use> resolves to a defined <symbol> (no broken graphics)", async ({ page }) => {
  await page.goto("/");
  const missing = await page.evaluate(() => {
    const ids = new Set([...document.querySelectorAll("symbol[id]")].map((s) => s.id));
    return [...document.querySelectorAll("use")]
      .map((u) => (u.getAttribute("href") ?? "").replace(/^#/, ""))
      .filter((id) => id && !ids.has(id));
  });
  expect(missing).toEqual([]);
});

test("sorting and search drive the list through the URL (zero-JS)", async ({ page }) => {
  await page.goto("/");
  const total = await page.locator("tbody tr").count();

  await page.getByRole("link", { name: /Name/ }).first().click();
  await expect(page).toHaveURL(/sort=name/);
  await expect(page.locator("thead th").filter({ hasText: "Name" })).toHaveAttribute("aria-sort", "ascending");

  await page.goto("/");
  await page.locator('input[name="q"]').fill("Avery");
  await page.getByRole("button", { name: /Apply filters/ }).click();
  await expect(page).toHaveURL(/q=Avery/);
  expect(await page.locator("tbody tr").count()).toBeLessThan(total);
});

test("theme switch flips the palette with no JavaScript", async ({ page }) => {
  await page.goto("/");
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.locator("#theme-dark").check({ force: true });
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(dark).not.toBe(light);
});

test("mobile layout hides the sidebar off-canvas behind the hamburger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".hamburger")).toBeVisible();

  const offCanvas = await page.locator(".sidebar").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.right <= 1 || r.left >= window.innerWidth;
  });
  expect(offCanvas).toBe(true);
});

test("Sign-out is a CSRF-guarded POST form: the token is issued on the page, a tokenless POST is refused", async ({ page }) => {
  await page.goto("/");
  // The page issues a CSRF cookie and embeds the same token in the Sign-out form (double-submit).
  const cookie = (await page.context().cookies()).find((c) => c.name === "plainpages_csrf");
  expect(cookie?.value, "GET / issues a plainpages_csrf cookie").toBeTruthy();
  const field = await page.locator('form[action="/logout"] input[name="_csrf"]').getAttribute("value");
  expect(field).toBe(cookie!.value);

  // A POST carrying the cookie but no form token is rejected before any Kratos call.
  const res = await page.request.post("/logout", { form: {}, maxRedirects: 0 });
  expect(res.status()).toBe(403);
});

test("unknown routes serve the 404 page (a real user-facing flow, covered end-to-end)", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back home" })).toBeVisible();
});
