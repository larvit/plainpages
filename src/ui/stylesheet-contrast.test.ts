import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "css", "styles.css"), "utf8");

const token = (name: string): string => {
  const hex = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\b`, "i").exec(css)?.[1];
  assert.ok(hex, `--${name} is not a six-digit hex colour`);
  return hex;
};

const luminance = (hex: string): number => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// WCAG AA for normal text.
for (const theme of ["l", "d"]) {
  for (const tone of ["pos", "neg", "warn", "info"]) {
    test(`${tone} badge text reaches 4.5:1 in ${theme === "l" ? "light" : "dark"} mode`, () => {
      assert.ok(contrast(token(`${theme}-${tone}`), token(`${theme}-${tone}-bg`)) >= 4.5);
    });
  }
  test(`text on the accent reaches 4.5:1 in ${theme === "l" ? "light" : "dark"} mode`, () => {
    assert.ok(contrast(token(`${theme}-on-accent`), token(`${theme}-accent`)) >= 4.5);
  });
}
