import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { SupportStatement } from "@mdn/browser-compat-data";
import { floorViolations, lacking } from "./stylesheet-floor.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cssDir = join(root, "public", "css");

test("floorViolations flags a feature the floor lacks, with its line and the first version that has it", () => {
  assert.deepEqual(floorViolations(".a { color: red; }\n.b:has(.c) { color: red; }"), [
    "line 2: :has needs chrome 105, safari 15.4, firefox 121 (css.selectors.has)",
  ]);
  assert.deepEqual(floorViolations(".a { min-height: 100dvh; }"), [
    "line 1: dvh needs chrome 108, safari 15.4 (css.types.length.viewport_percentage_units_dynamic)",
  ]);
  assert.deepEqual(floorViolations(".a { accent-color: red; }"), [
    "line 1: accent-color needs chrome 93, safari 15.4 (css.properties.accent-color)",
  ]);
  assert.deepEqual(floorViolations(".a { overflow-wrap: anywhere; }"), [
    "line 1: overflow-wrap: anywhere needs safari 15.4 (css.properties.overflow-wrap.anywhere)",
  ]);
  assert.equal(floorViolations(".a { & .b { color: red; } }").length, 1);
  assert.deepEqual(floorViolations("@layer base { .a { color: red; } }"), [
    "line 1: @layer needs chrome 99, safari 15.4 (css.at-rules.layer)",
  ]);
});

test("floorViolations flags media range and or syntax, which a floor engine drops with the whole query", () => {
  assert.deepEqual(floorViolations("@media (width >= 600px) { .a { color: red; } }"), [
    "line 1: media range syntax needs chrome 104, safari 16.4 (css.at-rules.media.range_syntax)",
  ]);
  assert.deepEqual(floorViolations("@media (hover: hover) or (pointer: fine) { .a { color: red; } }"), [
    "line 1: media or syntax needs chrome 104, safari 16.4 (css.at-rules.media.or_syntax)",
  ]);
});

test("floorViolations passes a media feature the floor lacks, since an engine without it reads the query as false", () => {
  assert.deepEqual(floorViolations("@media (forced-colors: active) { .a { color: red; } }"), []);
});

test("floorViolations reports a bracket nothing closes, with its line", () => {
  assert.deepEqual(floorViolations(".a { color: red; }\n.b { color: red;"), ["line 2: { is never closed"]);
  assert.deepEqual(floorViolations(".a {\n  width: calc(1px;\n}"), ["line 2: ( is never closed"]);
});

test("floorViolations checks a custom property's value, since the var() reading it fails unseen", () => {
  assert.deepEqual(floorViolations(":root { --accent: oklch(0.5 0.1 250); }"), [
    "line 1: oklch() needs chrome 111, safari 15.4 (css.types.color.oklch)",
  ]);
});

test("floorViolations allows a feature inside an @supports that tests it, and only then", () => {
  assert.deepEqual(floorViolations("@supports selector(:has(a)) { .b:has(.c) { color: red; } }"), []);
  assert.deepEqual(floorViolations("@media (min-width: 1px) { @supports (min-height: 100dvh) { .a { min-height: 100dvh; } } }"), []);
  assert.equal(floorViolations("@supports not selector(:has(a)) { .b:has(.c) { color: red; } }").length, 1);
  assert.equal(floorViolations("@supports (display: grid) and (not selector(:has(a))) { .b:has(.c) { color: red; } }").length, 1);
  assert.equal(floorViolations("@supports (min-height: 100dvh) { .b:has(.c) { color: red; } }").length, 1);
  assert.equal(floorViolations("@supports (position-anchor: auto) { .a { top: anchor(bottom); } }").length, 1);
  assert.equal(floorViolations("@supports at-rule(@layer) { @layer base { .a { color: red; } } }").length, 1);
});

test("floorViolations takes as a guard only a part of the @supports condition that must hold", () => {
  const has = ["line 1: :has needs chrome 105, safari 15.4, firefox 121 (css.selectors.has)"];
  assert.deepEqual(floorViolations("@supports (display: grid) or selector(:has(a)) { .b:has(.c) { color: red; } }"), has);
  assert.deepEqual(floorViolations("@supports selector(:has(a)) and ((display: grid) or (display: flex)) { .b:has(.c) { color: red; } }"), []);
  assert.deepEqual(floorViolations("@supports (display: grid) and ((display: flex) or selector(:has(a))) { .b:has(.c) { color: red; } }"), has);
});

test("floorViolations passes what the floor has, vendor prefixes, font-family names, and syntax inside comments, strings and url()", () => {
  const css = `/* .x:has(y) { min-height: 100dvh } */
    @media (prefers-color-scheme: dark) and (orientation: portrait) { :root { color-scheme: dark; } }
    .a::before, .a:focus-within { content: "{ :has( }"; display: grid; gap: 4px; inset: 0;
      grid-template-columns: repeat(3, minmax(0, 1fr)); width: min(86vw, 20rem); transition: .15s ease;
      background: rgba(0,0,0,.4) url("data:image/svg+xml;utf8,<svg/>"); transform: rotate(45deg); }
    .b { -webkit-font-smoothing: antialiased; -webkit-user-select: none; font-family: Avenir, ui-sans-serif, sans-serif; }
    summary::-webkit-details-marker { display: none; }
    @-webkit-keyframes spin { to { opacity: 0; } }`;
  assert.deepEqual(floorViolations(css), []);
});

test("floorViolations refuses what MDN has no entry for, so a typo or a new feature can't pass unchecked", () => {
  assert.deepEqual(floorViolations(".a { colr: red; }"), ["line 1: colr has no MDN compat entry"]);
  assert.equal(floorViolations(".a { width: 3zz; }").length, 1);
  assert.equal(floorViolations(".a:hovr { color: red; }").length, 1);
  assert.deepEqual(floorViolations("@media (hovr: hover) { .a { color: red; } }"), ["line 1: (hovr) has no MDN compat entry"]);
});

const safari = (support: SupportStatement): string[] =>
  lacking({ chrome: { version_added: "1" }, firefox: { version_added: "1" }, safari: support });

test("lacking counts only an unprefixed, unflagged, unrenamed support statement the floor still has", () => {
  assert.deepEqual(safari({ version_added: "15" }), []);
  assert.deepEqual(safari({ version_added: "15.4" }), ["safari 15.4"]);
  assert.deepEqual(safari({ version_added: "≤16" }), ["safari 16"]);
  assert.deepEqual(safari({ version_added: "preview" }), ["safari (none yet)"]);
  assert.deepEqual(safari({ version_added: "3", prefix: "-webkit-" }), ["safari (none yet)"]);
  assert.deepEqual(safari({ version_added: "3", flags: [{ type: "preference", name: "x" }] }), ["safari (none yet)"]);
  assert.deepEqual(safari({ version_added: "3", alternative_name: "x" }), ["safari (none yet)"]);
  assert.deepEqual(safari({ version_added: "3", version_removed: "15" }), ["safari (none yet)"]);
  assert.deepEqual(safari({ version_added: "3", version_removed: "15.4" }), []);
  assert.deepEqual(safari([{ version_added: "3", version_removed: "14" }, { version_added: "16" }]), ["safari 16"]);
});

const stylesheets = globSync(["public/**/*.css", "examples/**/*.css", "plugins/**/*.css"], { cwd: root, exclude: ["**/node_modules/**"] });

test("the floor check finds the stylesheets", () => {
  assert.ok(stylesheets.includes("public/css/styles.css"));
  assert.ok(stylesheets.includes("examples/plugins/scheduling/public/scheduling.css"));
});

for (const file of stylesheets) {
  test(`${file} uses nothing the browser floor lacks outside an @supports guarding it`, () => {
    assert.deepEqual(floorViolations(readFileSync(join(root, file), "utf8")), []);
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
  const open = stylesheet.lastIndexOf("@supports selector(:has(a)) {", stylesheet.indexOf(".nav-node > .nav-children"));
  assert.ok(open >= 0, "no @supports selector(:has(a)) block before the fold rule");
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

// Both inputs are invisible in the base rules and only a `:has()` rule marks the choice, so without
// `:has()` the native control is the only sign of what is selected or focused.
test("styles.css shows the segmented and chip inputs where :has() is missing, after their base rules", () => {
  const guard = stylesheet.indexOf("@supports not selector(:has(a)) {");
  assert.ok(guard >= 0, "no @supports not selector(:has(a)) block");
  const block = stylesheet.slice(guard, blockEnd(guard));
  for (const input of [".segmented input", ".chip input"]) {
    assert.ok(stylesheet.indexOf(`${input} {`) < guard, `the base ${input} rule comes after the guard`);
  }
  assert.match(block, /\.segmented input,\s*\.chip input\s*\{[^}]*position:\s*static[^}]*opacity:\s*1/);
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
