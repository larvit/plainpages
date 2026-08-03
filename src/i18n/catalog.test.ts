import assert from "node:assert/strict";
import { test } from "node:test";
import { type Catalog, checkCatalog, isCatalog } from "./catalog.ts";

const baseline: Catalog = { greeting: "Hello", "shifts.count": { one: "{{count}} shift", other: "{{count}} shifts" } };
const parity = (locale: string, catalog: Catalog): string[] =>
  checkCatalog({ baseline, baselineLocale: "en-US", catalog, locale });

test("a complete translation reports nothing", () => {
  assert.deepEqual(parity("sv-SE", { greeting: "Hej", "shifts.count": { one: "{{count}} pass", other: "{{count}} pass" } }), []);
});

test("a missing or unknown key is reported", () => {
  const missing = parity("sv-SE", { "shifts.count": { one: "{{count}} pass", other: "{{count}} pass" } });
  assert.equal(missing.length, 1);
  assert.match(missing[0] ?? "", /missing key "greeting"/);

  const extra = parity("sv-SE", { ...baseline, stray: "x" });
  assert.equal(extra.length, 1);
  assert.match(extra[0] ?? "", /unknown key "stray".*en-US/);
});

test("a key must stay the same kind as in the baseline", () => {
  const flat = parity("sv-SE", { greeting: "Hej", "shifts.count": "{{count}} pass" });
  assert.equal(flat.length, 1);
  assert.match(flat[0] ?? "", /"shifts.count" must be a plural message/);

  const plural = parity("sv-SE", { greeting: { one: "Hej", other: "Hej" }, "shifts.count": { one: "{{count}} pass", other: "{{count}} pass" } });
  assert.equal(plural.length, 1);
  assert.match(plural[0] ?? "", /"greeting" must be a string/);
});

test("a plural message must cover exactly its own locale's categories", () => {
  const short = parity("cs-CZ", { greeting: "Ahoj", "shifts.count": { one: "{{count}} směna", other: "{{count}} směn" } });
  assert.equal(short.length, 1);
  assert.match(short[0] ?? "", /"shifts\.count".*cs-CZ.*few, many/);

  const long = parity("sv-SE", { greeting: "Hej", "shifts.count": { few: "{{count}} pass", one: "{{count}} pass", other: "{{count}} pass" } });
  assert.equal(long.length, 1);
  assert.match(long[0] ?? "", /"shifts\.count".*few/);
});

test("the baseline is checked against itself, so an incomplete plural fails at home too", () => {
  assert.deepEqual(checkCatalog({ baseline, baselineLocale: "en-US", catalog: baseline, locale: "en-US" }), []);
  const bad: Catalog = { greeting: "Hello", "shifts.count": { one: "{{count}} shift" } };
  assert.match(checkCatalog({ baseline: bad, baselineLocale: "en-US", catalog: bad, locale: "en-US" })[0] ?? "", /other/);
});

test("isCatalog accepts strings and plural objects, rejects anything else", () => {
  assert.equal(isCatalog({ a: "x", b: { other: "y" } }), true);
  assert.equal(isCatalog({ a: 1 }), false);
  assert.equal(isCatalog({ a: { other: 1 } }), false);
  assert.equal(isCatalog({ a: {} }), false); // an empty plural message says nothing
  assert.equal(isCatalog({ a: { bogus: "x" } }), false); // not a plural category
  assert.equal(isCatalog(null), false);
  assert.equal(isCatalog([]), false);
});

test("a translation must interpolate exactly what the baseline does", () => {
  const withVars: Catalog = { hi: "Hi {{name}}, you have {{n}} left" };
  const check = (catalog: Catalog): string[] => checkCatalog({ baseline: withVars, baselineLocale: "en-US", catalog, locale: "sv-SE" });

  assert.deepEqual(check({ hi: "Hej {{name}}, du har {{n}} kvar" }), []);
  assert.match(check({ hi: "Hej, du har {{n}} kvar" })[0] ?? "", /"hi" never uses \{\{name\}\}/); // dropped ⇒ a blank on screen
  assert.match(check({ hi: "Hej {{namn}}, du har {{n}} kvar" })[0] ?? "", /never uses \{\{name\}\}/); // misspelled ⇒ both problems
  assert.match(check({ hi: "Hej {{name}} {{n}} {{extra}}" })[0] ?? "", /uses \{\{extra\}\}/); // never supplied ⇒ renders raw
});
