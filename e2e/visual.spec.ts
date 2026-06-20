import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// The mockups are bind-mounted at /repo (sibling to /repo/public so their ../public/css/ resolves).
const MOCKUP = "file:///repo/html-css-foundation";
const APP_SHELL = `${MOCKUP}/App%20Shell.html`;
const AUTH = `${MOCKUP}/Auth.html`;
const SHOTS = "artifacts/screenshots";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SESSION_COOKIE = "plainpages_jwt"; // src/login.ts — web verifies it against the committed dev JWKS

const shot = (page: Page, name: string): Promise<Buffer> =>
  page.screenshot({ fullPage: true, path: `${SHOTS}/${name}.png` });

// Sign a session JWT with the committed dev tokenizer key (bind-mounted at /repo/jwks.json), so the
// gated dashboard (§10) renders for a "signed-in" user without standing up Ory — web verifies it
// with the same key by `kid`, exactly as it verifies a real Kratos-tokenizer JWT.
function devSession(roles: string[] = []): string {
  const jwk = JSON.parse(readFileSync("/repo/jwks.json", "utf8")).keys[0];
  const key = createPrivateKey({ format: "jwk", key: jwk });
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "ES256", kid: jwk.kid, typ: "JWT" })}.${b64({ email: "demo@plainpages.local", exp: now + 3600, iat: now, roles, sub: "visual-demo" })}`;
  return `${input}.${sign("SHA256", Buffer.from(input), { dsaEncoding: "ieee-p1363", key }).toString("base64url")}`;
}

test.beforeAll(async () => { await mkdir(SHOTS, { recursive: true }); });

// The dashboard is gated (§10): a page navigation needs a session. Plant one per test — a plain
// member (no roles) so the gated scheduling/admin nav stays filtered out, matching the mockup.
test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: SESSION_COOKIE, url: BASE_URL, value: devSession() }]);
});

test("captures live pages + reference mockups for side-by-side review", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator("table.table tbody tr").first()).toBeVisible();
  await shot(page, "live-01-dashboard");

  await page.goto("/dashboard?sort=-name&status=active");
  await shot(page, "live-02-sorted-filtered");

  await page.goto("/dashboard");
  await page.locator("#theme-dark").check({ force: true }); // visually-hidden radio
  await shot(page, "live-03-dark");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
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
  await page.goto("/dashboard");
  const ref = await context.newPage();
  await ref.goto(APP_SHELL);

  for (const selector of [".sidebar", ".topbar", ".brand", ".btn.btn-primary", ".theme-switch", ".filters", ".pager"]) {
    expect(await styleOf(page, selector), `computed style mismatch for ${selector}`).toEqual(await styleOf(ref, selector));
  }
  await ref.close();
});

test("every icon <use> resolves to a defined <symbol> (no broken graphics)", async ({ page }) => {
  await page.goto("/dashboard");
  const missing = await page.evaluate(() => {
    const ids = new Set([...document.querySelectorAll("symbol[id]")].map((s) => s.id));
    return [...document.querySelectorAll("use")]
      .map((u) => (u.getAttribute("href") ?? "").replace(/^#/, ""))
      .filter((id) => id && !ids.has(id));
  });
  expect(missing).toEqual([]);
});

test("sorting and search drive the list through the URL (zero-JS)", async ({ page }) => {
  await page.goto("/dashboard");
  const total = await page.locator("tbody tr").count();

  await page.getByRole("link", { name: /Name/ }).first().click();
  await expect(page).toHaveURL(/sort=name/);
  await expect(page.locator("thead th").filter({ hasText: "Name" })).toHaveAttribute("aria-sort", "ascending");

  await page.goto("/dashboard");
  await page.locator('input[name="q"]').fill("Avery");
  await page.getByRole("button", { name: /Apply filters/ }).click();
  await expect(page).toHaveURL(/q=Avery/);
  expect(await page.locator("tbody tr").count()).toBeLessThan(total);
});

test("theme switch flips the palette with no JavaScript", async ({ page }) => {
  await page.goto("/dashboard");
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.locator("#theme-dark").check({ force: true });
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(dark).not.toBe(light);
});

test("mobile layout hides the sidebar off-canvas behind the hamburger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.locator(".hamburger")).toBeVisible();

  const offCanvas = await page.locator(".sidebar").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.right <= 1 || r.left >= window.innerWidth;
  });
  expect(offCanvas).toBe(true);
});

test("Sign-out is a CSRF-guarded POST form: the token is issued on the page, a tokenless POST is refused", async ({ page }) => {
  await page.goto("/dashboard");
  // The page issues a CSRF cookie and embeds the same token in the Sign-out form (double-submit).
  const cookie = (await page.context().cookies()).find((c) => c.name === "plainpages_csrf");
  expect(cookie?.value, "GET /dashboard issues a plainpages_csrf cookie").toBeTruthy();
  const field = await page.locator('form[action="/logout"] input[name="_csrf"]').getAttribute("value");
  expect(field).toBe(cookie!.value);

  // A POST carrying the cookie but no form token is rejected before any Kratos call.
  const res = await page.request.post("/logout", { form: {}, maxRedirects: 0 });
  expect(res.status()).toBe(403);
});

test("the public landing at / is ungated and links to sign in + register (§10)", async ({ page, context }) => {
  await context.clearCookies(); // visit "/" as a logged-out visitor (drop the beforeEach session)
  await page.goto("/");
  await expect(page.locator(".landing")).toBeVisible(); // the standalone landing, not the app shell
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/registration");
  await shot(page, "live-05-public-landing");
});

test("unknown routes serve the 404 page (a real user-facing flow, covered end-to-end)", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back home" })).toBeVisible();
});

// The reference plugin (plugins/scheduling) ships discovered in the image. Its public Overview is
// reachable by anyone and its menu header shows for everyone; the shifts list stays permission-gated,
// so an anonymous visitor is bounced to sign in. The authenticated list/form flow is the §8 full
// E2E (full-flow.spec). Side-effect-free.
test("the reference plugin: public Overview is open to all, the gated Shifts redirects to /login (§10)", async ({ page, request }) => {
  // `request` is the isolated API context — it doesn't carry the beforeEach session cookie, so these
  // probes are genuinely anonymous.
  // The public overview is reachable with no session (200), not bounced to sign in.
  const pub = await request.get("/scheduling", { maxRedirects: 0 });
  expect(pub.status()).toBe(200);
  expect(await pub.text()).toContain("Scheduling");

  // The gated shifts list still bounces (don't follow — this Ory-free suite has no /login handler);
  // assert the gate's 303 with the requested page preserved as return_to (§9).
  const res = await request.get("/scheduling/shifts", { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()["location"]).toBe("/login?return_to=%2Fscheduling%2Fshifts");

  // The signed-in member (no scheduling role) sees the public Scheduling → Overview leaf in the nav,
  // but the gated Shifts leaf is filtered out.
  await page.goto("/dashboard");
  await expect(page.locator(".sidebar")).toContainText("People"); // dashboard nav renders
  await expect(page.locator('.sidebar a[href="/scheduling"]')).toHaveCount(1); // public Overview shown
  await expect(page.locator('.sidebar a[href="/scheduling/shifts"]')).toHaveCount(0); // gated leaf filtered out
});
