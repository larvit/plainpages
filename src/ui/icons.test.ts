import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { ICON_NAMES, buildIconSprite } from "./icons.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Resolved by specifier, not by path: the install lives above the app dir, not in it (Dockerfile).
const lucideDir = join(dirname(fileURLToPath(import.meta.resolve("lucide-static/package.json"))), "icons");
const partial = join(rootDir, "views", "partials", "icons.ejs");

const symbolInner = (sprite: string, id: string): string =>
  sprite.match(new RegExp(`<symbol id="${id}"[^>]*>(.*?)</symbol>`))?.[1] ?? "";

test("icons partial inlines exactly the used lucide-static icons", async () => {
  const built = buildIconSprite(lucideDir);

  // The committed partial must be exactly the generator output — proves provenance
  // and flags drift when the pinned lucide-static is bumped without regenerating.
  assert.equal(readFileSync(partial, "utf8"), built);

  const html = await ejs.renderFile(partial, {});
  const ids = [...html.matchAll(/<symbol id="(i-[a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, Object.keys(ICON_NAMES)); // only the used icons, complete + ordered
  assert.match(html.trimStart(), /^<svg width="0" height="0"[^>]*aria-hidden="true"/);

  // Independent spot-checks: a wrong id→icon mapping is caught regardless of the builder.
  assert.match(symbolInner(built, "i-x"), /M18 6 6 18/);
  assert.match(symbolInner(built, "i-search"), /circle cx="11" cy="11" r="8"/);
  assert.match(symbolInner(built, "i-kebab"), /circle cx="12" cy="12" r="1"/);
  assert.match(symbolInner(built, "i-bell"), /M10\.268 21/); // lucide v1.18 path, not an older one
});
