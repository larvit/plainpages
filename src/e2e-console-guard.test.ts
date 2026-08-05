// Guards the E2E console guard: a spec that imports `test` straight from Playwright runs unwatched,
// and a browser warning nobody looks at is exactly what the guard exists to catch — so the wiring is
// asserted here, in the fast unit gate, rather than discovered by a silent gap in an E2E run. A text
// guard: @playwright/test is installed in the e2e-tests image, not in the one running these tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../e2e-tests/${p}`, import.meta.url), "utf8");
const specs = readdirSync(new URL("../e2e-tests/", import.meta.url)).filter((f) => f.endsWith(".spec.ts"));

test("every spec takes its `test` from the console guard, never straight from Playwright", () => {
  assert.ok(specs.length >= 5, "scans the E2E specs");
  for (const spec of specs) {
    const source = read(spec);
    assert.match(source, /^import \{[^}]*\btest\b[^}]*\} from "\.\/console-guard\.ts";$/m, `${spec} imports test from the guard`);
    assert.doesNotMatch(source, /^import \{(?![^}]*\btype\b)[^}]*\} from "@playwright\/test";$/m, `${spec} imports no value from @playwright/test`);
    assert.doesNotMatch(source, /\.newPage\(/, `${spec} takes its page from the fixture or watchedPage(), never a raw newPage()`);
  }
});

test("the guard reads console errors, warnings and uncaught page errors, and fails on what it kept", () => {
  const guard = read("console-guard.ts");
  assert.match(guard, /type === "error" \|\| type === "warning"/);
  assert.match(guard, /page\.on\("pageerror"/);
  assert.match(guard, /expect\(unexpected, .*\)\.toEqual\(\[\]\)/);
});

test("the Ory-free specs run in all three engines, so each engine's console is read", () => {
  const config = read("playwright.config.ts");
  for (const engine of ["firefox", "webkit"]) {
    assert.match(config, new RegExp(`name: "${engine}", testMatch: ORY_FREE`), `${engine} runs the Ory-free specs`);
  }
  assert.match(config, /const ORY_FREE = \/\\\/\(visual\|language\)\\\.spec\\\.ts\$\//);
});
