import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cssDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "css");

test("no stylesheet declares an oklch() colour, which an engine below Chromium 111 drops", () => {
  // A dropped custom property leaves var(--accent) invalid: white text on no background.
  for (const file of readdirSync(cssDir).filter((f) => f.endsWith(".css"))) {
    assert.ok(!/oklch\(/.test(readFileSync(join(cssDir, file), "utf8")), `${file} declares oklch()`);
  }
});
