import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ejs from "ejs";

const themeSwitch = join(dirname(fileURLToPath(import.meta.url)), "..", "views", "partials", "theme-switch.ejs");
const render = (data: Record<string, unknown> = {}): Promise<string> => ejs.renderFile(themeSwitch, data);
const flat = (s: string): string => s.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

test("theme switch renders the Light/Auto/Dark radiogroup with CSS-coupled ids", async () => {
  // ids must be theme-light/auto/dark — styles.css keys html:has(#theme-…:checked) off them.
  const html = flat(await render({ value: "dark", label: "Appearance" }));
  assert.match(html, /<div class="theme-switch" role="radiogroup" aria-label="Appearance">/);
  assert.match(html, /<label><input type="radio" name="theme" id="theme-light">\s*<span>Light<\/span><\/label>/);
  assert.match(html, /<label><input type="radio" name="theme" id="theme-auto">\s*<span>Auto<\/span><\/label>/);
  assert.match(html, /<label><input type="radio" name="theme" id="theme-dark" checked>\s*<span>Dark<\/span><\/label>/);
});

test("theme switch defaults to Auto checked and a default label", async () => {
  const html = flat(await render());
  assert.match(html, /aria-label="Color theme"/);
  assert.match(html, /id="theme-auto" checked/);
  assert.doesNotMatch(html, /id="theme-light" checked|id="theme-dark" checked/);
});
