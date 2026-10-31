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
