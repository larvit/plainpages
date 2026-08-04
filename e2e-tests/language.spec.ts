import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Language switching in a real browser, Ory-free (the visual stack). Proves the whole path a
// visitor takes: pick a language, read the page in it, and stay in it while clicking around —
// including into a plugin, whose words come from its own catalog (plugins/scheduling/i18n/).

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SESSION_COOKIE = "plainpages_jwt";
const SHOTS = "artifacts/screenshots";

// Same trick as visual.spec.ts: sign a session JWT with the committed dev tokenizer key so the
// gated pages render without standing up Ory.
function devSession(permissions: string[] = []): string {
  const jwk = JSON.parse(readFileSync("/repo/jwks.json", "utf8")).keys[0];
  const key = createPrivateKey({ format: "jwk", key: jwk });
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "ES256", kid: jwk.kid, typ: "JWT" })}.${b64({ email: "demo@plainpages.local", exp: now + 3600, iat: now, permissions, sub: "lang-demo" })}`;
  return `${input}.${sign("SHA256", Buffer.from(input), { dsaEncoding: "ieee-p1363", key }).toString("base64url")}`;
}

test("the switcher changes language, and the choice survives clicking through the app", async ({ page, context }) => {
  await context.addCookies([{ name: SESSION_COOKIE, url: BASE_URL, value: devSession(["scheduling:read"]) }]);

  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();

  // The picker sits in the sidebar footer beside the theme switch; each entry is a plain link to
  // this same page in that language (zero-JS).
  await page.locator('summary[aria-label="Language"]').click();
  await page.getByRole("link", { name: /svenska/i }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "sv-SE");
  await expect(page).toHaveURL(/locale=sv-SE/);
  await expect(page.getByRole("heading", { name: "Startpanel" })).toBeVisible(); // the starter dashboard, in Swedish
  await expect(page.getByRole("link", { name: "Översikt", exact: true })).toBeVisible(); // the menu too
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ fullPage: true, path: `${SHOTS}/live-05-swedish.png` });

  // Clicking a menu item keeps Swedish — the host carries the choice onto the links it renders,
  // and the plugin's own page is translated from its own catalog. The section's own label comes
  // from the plugin's catalog too, so opening it proves the nav fragment was translated.
  await page.locator('summary[aria-label="Visa eller dölj Schemaläggning"]').click();
  await page.getByRole("link", { name: "Pass", exact: true }).click();
  await expect(page).toHaveURL(/\/scheduling\/shifts\?locale=sv-SE/);
  await expect(page.locator("html")).toHaveAttribute("lang", "sv-SE");
  await expect(page.getByRole("heading", { name: "Pass" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sök" })).toBeVisible(); // the core filter bar, in Swedish

  // The filter bar is a GET form: submitting it replaces the whole query string, so the choice
  // survives only because the form carries it as a hidden field.
  await page.getByRole("button", { name: "Sök" }).click();
  await expect(page).toHaveURL(/locale=sv-SE/);
  await expect(page.locator("html")).toHaveAttribute("lang", "sv-SE");

  // …and back to English the same way.
  await page.locator('summary[aria-label="Språk"]').click();
  await page.getByRole("link", { name: /English/i }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { name: "Shifts" })).toBeVisible();
});

test("a browser that asks for Swedish gets it without touching the URL", async ({ browser }) => {
  const context = await browser.newContext({ locale: "sv" }); // a browser set to Swedish, no region
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/`);

  await expect(page.locator("html")).toHaveAttribute("lang", "sv-SE");
  const signIn = page.locator("#main-content").getByRole("link", { name: "Logga in" });
  await expect(signIn).toBeVisible();
  // Nothing was chosen in the URL, so the links stay plain — the browser asks again on the next hit.
  await expect(signIn).toHaveAttribute("href", "/login");
  await context.close();
});

test("an uninstalled language falls back to English rather than failing", async ({ page }) => {
  const response = await page.goto("/?locale=sv-FI"); // sv-SE is installed; sv-FI is not
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
});
