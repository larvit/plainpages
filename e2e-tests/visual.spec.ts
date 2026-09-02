import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { allowConsole, expect, test } from "./console-guard.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SESSION_COOKIE = "plainpages_jwt"; // src/auth/login.ts — web verifies it against the committed dev JWKS

// Per engine: the three projects run this suite in parallel and would otherwise write one file.
const shot = (page: Page, name: string): Promise<Buffer> =>
  page.screenshot({ fullPage: true, path: `artifacts/screenshots/${test.info().project.name}/${name}.png` });

// Sign a session JWT with the committed dev tokenizer key (bind-mounted at /repo/jwks.json), so the
// gated dashboard renders for a "signed-in" user without standing up Ory — web verifies it
// with the same key by `kid`, exactly as it verifies a real Kratos-tokenizer JWT.
function devSession(permissions: string[] = []): string {
  const jwk = JSON.parse(readFileSync("/repo/jwks.json", "utf8")).keys[0];
  const key = createPrivateKey({ format: "jwk", key: jwk });
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "ES256", kid: jwk.kid, typ: "JWT" })}.${b64({ email: "demo@plainpages.local", exp: now + 3600, iat: now, permissions, sub: "visual-demo" })}`;
  return `${input}.${sign("SHA256", Buffer.from(input), { dsaEncoding: "ieee-p1363", key }).toString("base64url")}`;
}

// The dashboard is gated: a page navigation needs a session. Plant one per test — a plain
// member (no permissions) so the gated scheduling nav stays filtered out.
test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: SESSION_COOKIE, url: BASE_URL, value: devSession() }]);
});

test("captures the live pages for review", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.locator(".sidebar")).toBeVisible();
  // the default /dashboard is the instructional starter, not a mock-data list.
  await expect(page.getByRole("heading", { name: "Starter dashboard" })).toBeVisible();
  await shot(page, "live-01-dashboard");

  await page.goto("/dashboard");
  await page.locator("#theme-dark").check({ force: true }); // visually-hidden radio
  await shot(page, "live-03-dark");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await shot(page, "live-04-mobile");
  await page.setViewportSize({ width: 1280, height: 800 });
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

// The zero-JS URL-driven list — sortable headers, ?q search — is unit-tested per component and
// exercised live by the full-flow E2E's admin Users list, so it has no Ory-free counterpart here.

test("theme switch flips the palette with no JavaScript", async ({ page }) => {
  await page.goto("/dashboard");
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.locator("#theme-dark").check({ force: true });
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(dark).not.toBe(light);
});

// The menus are <button popovertarget> + [popover], so the browser dismisses them: the visitor no
// longer has to click the trigger again to get rid of one. Driven through the language picker; the
// profile menu is the same block. Anchoring is asserted too — without `position-anchor` the panel
// silently detaches and lands in the middle of the viewport.
test("a popover menu sits on its trigger and closes on an outside click or Esc — no JavaScript", async ({ page }) => {
  await page.goto("/dashboard");
  const trigger = page.locator('button[aria-label="Language"]');
  const panel = page.locator('button[aria-label="Language"] + .menu-pop');

  await expect(panel).toBeHidden();
  await trigger.click();
  await expect(panel).toBeVisible();

  // Anchored to the button that opened it: directly above (.up), right edges flush.
  const t = (await trigger.boundingBox())!;
  const p = (await panel.boundingBox())!;
  expect(Math.abs(p.x + p.width - (t.x + t.width))).toBeLessThan(2);
  expect(t.y - (p.y + p.height)).toBeGreaterThan(-1); // above the trigger, subpixel-tolerant
  expect(t.y - (p.y + p.height)).toBeLessThan(12);

  await page.getByRole("heading", { name: "Starter dashboard" }).click(); // anywhere else on the page
  await expect(panel).toBeHidden();

  await trigger.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused(); // the browser returns focus, so no trigger needs a tabindex
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

test("the public landing at / is ungated and links to sign in + register", async ({ page, context }) => {
  await context.clearCookies(); // visit "/" as a logged-out visitor (drop the beforeEach session)
  await page.goto("/");
  await expect(page.locator(".landing")).toBeVisible();
  // the same app shell every page renders — the menu shows even signed out (permission-filtered).
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator('use[href="#i-gear"]')).toHaveCount(0); // no settings cog to offer a signed-out visitor
  // Scoped to the landing itself: the anonymous sidebar offers a "Sign in" link of its own.
  await expect(page.locator("#main-content").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  await expect(page.locator("#main-content").getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/registration");
  await shot(page, "live-05-public-landing");
});

test("unknown routes serve the 404 page (a real user-facing flow, covered end-to-end)", async ({ page }) => {
  allowConsole(/status of 404 .*\/no-such-page$/); // the navigation under test, which Chromium and WebKit log — not a sub-resource of it
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back home" })).toBeVisible();
});

// The reference plugin (plugins/scheduling) ships discovered in the image, and shows all three
// gates: the public Overview is reachable by anyone, My shifts takes any session, and the shifts
// list needs a permission. The authenticated list/form flow is the full E2E (full-flow.spec).
// Side-effect-free.
test("the reference plugin: public Overview is open to all, My shifts takes any session, the gated Shifts redirects to /login", async ({ page, request }) => {
  // `request` is the isolated API context — it doesn't carry the beforeEach session cookie, so these
  // probes are genuinely anonymous.
  // The public overview is reachable with no session (200), not bounced to sign in.
  const pub = await request.get("/scheduling", { maxRedirects: 0 });
  expect(pub.status()).toBe(200);
  const body = await pub.text();
  expect(body).toContain("Scheduling");
  // Anonymous in the native shell: the gated Dashboard link is hidden (it would only dead-end at
  // /login), and the shell's Sign-in link carries the current page as return_to.
  expect(body).not.toContain('href="/dashboard"');
  expect(body).toContain('href="/login?return_to=%2Fscheduling"');

  // The gated shifts list still bounces (don't follow — this Ory-free suite has no /login handler);
  // assert the gate's 303 with the requested page preserved as return_to.
  const res = await request.get("/scheduling/shifts", { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()["location"]).toBe("/login?return_to=%2Fscheduling%2Fshifts");

  // A `session: true` route bounces an anonymous visitor the same way — no permission involved.
  const mine = await request.get("/scheduling/mine", { maxRedirects: 0 });
  expect(mine.status()).toBe(303);
  expect(mine.headers()["location"]).toBe("/login?return_to=%2Fscheduling%2Fmine");

  // The signed-in member (no scheduling permission) sees the public Scheduling → Overview leaf in the nav,
  // but the gated Shifts leaf is filtered out.
  await page.goto("/dashboard");
  await expect(page.locator('.sidebar a[href="/dashboard"]')).toHaveCount(1); // the one unified menu renders
  await expect(page.locator('.sidebar a[href="/scheduling"]')).toHaveCount(1); // public Overview shown
  await expect(page.locator('.sidebar a[href="/scheduling/shifts"]')).toHaveCount(0); // gated leaf filtered out
  await expect(page.locator('.sidebar a[href="/scheduling/mine"]')).toHaveCount(1); // session gate: a session is enough

  // And the page itself renders for that same member, holding no permission at all. This stack runs
  // no shifts upstream, so the list degrades to its empty state — which still names whose page it is.
  await page.goto("/scheduling/mine");
  await expect(page.getByRole("heading", { name: "My shifts" })).toBeVisible();
  await expect(page.getByText("No shifts are assigned to demo@plainpages.local.")).toBeVisible();
});
