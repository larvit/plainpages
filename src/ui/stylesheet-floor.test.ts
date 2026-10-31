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

// Below Chromium 105 nothing but `:has()` reveals a folded branch, so the fold may only exist where
// the engine can undo it.
test("styles.css hides .nav-children only inside @supports selector(:has(a))", () => {
  const guard = stylesheet.indexOf("@supports selector(:has(a))");
  assert.ok(guard >= 0, "no @supports selector(:has(a)) guard");
  const hide = /\.nav-node\s*>\s*\.nav-children\s*\{\s*display:\s*none/.exec(stylesheet);
  assert.ok(hide && hide.index > guard, "the fold rule is missing or precedes the guard");
  const between = stylesheet.slice(guard, hide.index);
  assert.equal(between.split("{").length - between.split("}").length, 1, "the guard closes before the fold rule");
});

test("styles.css hides the theme switch where :has() is missing", () => {
  assert.match(stylesheet, /@supports not selector\(:has\(a\)\)\s*\{\s*\.theme-switch\s*\{\s*display:\s*none/);
});
