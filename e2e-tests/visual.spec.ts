import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { allowConsole, expect, test } from "./console-guard.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SESSION_COOKIE = "plainpages_jwt"; // src/auth/login.ts — web verifies it against the committed dev JWKS

// Per engine: the three projects run this suite in parallel and would otherwise write one file.
const shot = (page: Page, name: string): Promise<Buffer> =>
  page.screenshot({ fullPage: true, path: `artifacts/screenshots/${test.info().project.name}/${name}.png` });

// Either side of the stylesheet's 860px and 560px breakpoints.
const VIEWPORTS = [
  { name: "desktop-xl", width: 1920, height: 1080 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone-small", width: 320, height: 568 },
] as const;

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

// A key press, not scrollIntoView (a script can scroll a box no reader can) and not the wheel
// (Firefox's synthetic event never reaches the document).
for (const [name, path, tail] of [
  ["the starter dashboard", "/dashboard", ".form-actions .btn"],
  ["the public landing", "/", ".landing-actions .btn"],
] as const) {
  for (const { width } of VIEWPORTS) {
    test(`${name} scrolls to its end at ${width}px wide`, async ({ page }) => {
      await page.setViewportSize({ width, height: 200 });
      await page.goto(path);

      const overflows = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
      expect(overflows, "the page must overflow, or it proves nothing").toBe(true);
      await page.keyboard.press("End");
      await expect(page.locator(tail).last()).toBeInViewport({ ratio: 1 });
    });
  }
}

// Green only while #nav-toggle is position: fixed — a label tap focuses it, and focus scrolls into view.
test("closing the mobile drawer leaves the reader where the scrim found them", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 200 });
  await page.goto("/dashboard");

  await page.locator(".hamburger").click();
  await expect(page.locator("#nav-toggle")).toBeChecked();
  // Scripted, because a key press with focus on the toggle does not scroll in every engine — and
  // what is under test is closing the drawer, not how the reader got down the page.
  await page.evaluate(() => window.scrollTo(0, 120));
  const at = await page.evaluate(() => window.scrollY);
  expect(at, "the page must have somewhere to scroll behind the scrim").toBeGreaterThan(0);

  // The exposed strip beside the 264px panel: the scrim spans the viewport, so its centre is under
  // the drawer and a centre click lands on the panel instead.
  await page.locator(".scrim").click({ position: { x: 340, y: 100 } });
  await expect(page.locator("#nav-toggle")).not.toBeChecked();
  expect(await page.evaluate(() => window.scrollY), "closing the drawer must not move the page").toBe(at);
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
});

// The page is a document, so a column wider than the viewport can only show as sideways scroll.
for (const { name, width, height } of VIEWPORTS) {
  for (const [path, label] of [["/dashboard", "dashboard"], ["/", "landing"], ["/scheduling", "plugin"]] as const) {
    test(`the ${label} page fits ${width}px wide, with no sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(path);
      const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth] as const);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      await shot(page, `live-${label}-${name}`);
    });
  }
}

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

test("the hamburger opens the drawer over the scrim, and a link in it navigates", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page.locator(".hamburger").click();

  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toBeInViewport({ ratio: 1 });
  // A click is refused while the scrim sits above the drawer, which a lower z-index would cause.
  await sidebar.locator("summary").first().click(); // the dashboard is the current page, so its links are in a folded branch
  const link = sidebar.locator(".nav-children a.nav-self").first();
  const target = await link.getAttribute("href");
  await link.click();
  await expect(page).toHaveURL((url) => url.pathname === target?.split("?")[0]);
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

// Measured on the rendered elements, so a theme block that drops --on-accent fails here.
const contrastOf = (el: Element): number => {
  const luminance = (rgb: string): number => {
    const [r = 0, g = 0, b = 0] = (rgb.match(/[\d.]+/g) ?? []).map((c) => {
      const v = Number(c) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const style = getComputedStyle(el);
  const [hi = 0, lo = 0] = [luminance(style.color), luminance(style.backgroundColor)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
for (const [name, colorScheme, forceDark] of [["light", "light", false], ["dark", "dark", false], ["forced dark", "light", true]] as const) {
  test(`text on the accent reaches 4.5:1 in ${name} mode`, async ({ page, context }) => {
    await context.clearCookies();
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    if (forceDark) await page.locator("#theme-dark").check({ force: true });
    // No page of this stack has a second page of results, so add the current-page button.
    await page.locator("#main-content").evaluate((el) => el.insertAdjacentHTML("beforeend", '<a class="page-btn" aria-current="page" href="#">2</a>'));
    for (const selector of [".landing .btn-primary", ".brand-mark", ".page-btn"]) {
      await expect.poll(() => page.locator(selector).first().evaluate(contrastOf), { message: selector }).toBeGreaterThanOrEqual(4.5); // polls past the colour transition
    }
  });
}

test("a nav branch is folded until its toggle opens it — no JavaScript", async ({ page }) => {
  await page.goto("/dashboard");
  const child = page.locator('.sidebar a[href="/scheduling"]');
  await expect(child).toBeHidden();
  await page.locator('.sidebar summary[aria-label="Toggle Scheduling"]').click();
  await expect(child).toBeVisible();
});

test("the reference plugin's lead text is inset by --pad-x, like the bars around it", async ({ page }) => {
  await page.goto("/scheduling");
  const [inset, padX] = await page.locator(".scheduling-page > p").evaluate((p) => [
    p.getBoundingClientRect().left - (p.parentElement as HTMLElement).getBoundingClientRect().left,
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pad-x")),
  ] as const);
  expect(inset).toBe(padX);
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

  // No shifts upstream on this stack, so this also pins the degraded page: the reason, never a 500
  // and never a claim about what is assigned.
  await page.goto("/scheduling/mine");
  await expect(page.getByRole("heading", { name: "My shifts" })).toBeVisible();
  await expect(page.getByText("Couldn't reach the scheduling service")).toBeVisible();
  await expect(page.getByText("No shifts are assigned to")).toHaveCount(0);
});
