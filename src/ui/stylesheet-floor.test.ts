import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cssDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "css");

// A custom property holding oklch() passes unchecked on an engine below Chromium 111, so the
// var() that reads it is invalid at computed-value time: white text on no background.
for (const file of readdirSync(cssDir).filter((f) => f.endsWith(".css"))) {
  test(`${file} declares no oklch() colour`, () => {
    assert.ok(!/oklch\(/i.test(readFileSync(join(cssDir, file), "utf8")));
  });
}

const stylesheet = readFileSync(join(cssDir, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// The index of the `}` closing the block whose `{` is the first one at or after `start`.
function blockEnd(start: number): number {
  let depth = 0;
  for (let i = stylesheet.indexOf("{", start); i < stylesheet.length; i++) {
    if (stylesheet[i] === "{") depth++;
    if (stylesheet[i] === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced braces in styles.css");
}

// The text is all there is to check: Playwright's engines all support `:has()`, so no E2E sees the
// stylesheet an older engine gets.
// Chromium below 105 and Firefox below 121 have no `:has()`, and nothing else reveals a folded
// branch there, so the fold may only exist where `:has()` works.
test("styles.css folds .nav-children only inside @supports selector(:has(a))", () => {
  const open = stylesheet.indexOf("@supports selector(:has(a)) {");
  assert.ok(open >= 0, "no @supports selector(:has(a)) block");
  const close = blockEnd(open);
  const outside = stylesheet.slice(0, open) + stylesheet.slice(close + 1);
  assert.ok(!/\.nav-children\s*\{[^}]*display:\s*none/.test(outside), "a .nav-children rule hides it outside the guard");
  assert.match(stylesheet.slice(open, close), /\.nav-children\s*\{\s*display:\s*none/, "the fold rule is gone");
});

// `@supports` adds no specificity, so the hiding rule has to come after the base `.theme-switch` rule.
test("styles.css hides the theme switch and the nav toggles where :has() is missing, after their base rules", () => {
  const guard = stylesheet.indexOf("@supports not selector(:has(a)) {");
  assert.ok(guard >= 0, "no @supports not selector(:has(a)) block");
  const base = stylesheet.search(/^\.theme-switch\s*\{/m);
  assert.ok(base >= 0 && base < guard, "the guard precedes the base .theme-switch rule");
  const block = stylesheet.slice(guard, stylesheet.indexOf("\n}", guard));
  assert.match(block, /\.theme-switch\s*\{\s*display:\s*none/);
  assert.match(block, /\.nav-disc\s*\{\s*visibility:\s*hidden/);
});

// Without `:has()` nothing reads #nav-toggle, so an off-canvas sidebar there is unreachable and the
// hamburger does nothing: the sidebar has to stay in the flow, with the hamburger hidden.
test("styles.css moves the sidebar off-canvas at 860px only inside @supports selector(:has(a))", () => {
  const open = stylesheet.indexOf("@media (max-width: 860px) {");
  assert.ok(open >= 0, "no @media (max-width: 860px) block");
  const close = blockEnd(open);
  const media = stylesheet.slice(open, close);
  const guard = media.indexOf("@supports selector(:has(a)) {");
  assert.ok(guard >= 0, "no @supports selector(:has(a)) block inside the 860px media block");
  const guardEnd = blockEnd(open + guard) - open;
  const outside = media.slice(0, guard) + media.slice(guardEnd + 1);
  const inside = media.slice(guard, guardEnd);
  for (const offCanvas of [/translateX\(-100%\)/, /position:\s*fixed/, /#nav-toggle/, /\.hamburger/]) {
    assert.doesNotMatch(outside, offCanvas, `${offCanvas} applies outside the guard`);
    assert.match(inside, offCanvas, `${offCanvas} is gone from the guard`);
  }
});
