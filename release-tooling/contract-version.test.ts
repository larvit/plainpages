import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkTagMatchesContract, readHostApiVersion } from "./contract-version.ts";

test("readHostApiVersion pulls the constant out of the real source, and returns null when absent", () => {
  const real = readFileSync("src/plugin-host/plugin.ts", "utf8");
  assert.match(readHostApiVersion(real) ?? "", /^\d+\.\d+\.\d+$/);
  assert.equal(readHostApiVersion('export const SOMETHING_ELSE = "1.0.0";'), null);
});

test("the shipped tag and the shipped contract agree", () => {
  // Guards the pair the release gate checks, so a bump to one fails here before it fails in CI.
  assert.equal(readHostApiVersion(readFileSync("src/plugin-host/plugin.ts", "utf8")), "0.1.0");
});

test("checkTagMatchesContract: major.minor must agree, patch may lag", () => {
  assert.equal(checkTagMatchesContract("v0.1.0", "0.1.0").ok, true);
  assert.equal(checkTagMatchesContract("v0.1.7", "0.1.0").ok, true); // auto-release cut patches
  assert.equal(checkTagMatchesContract("0.1.0", "0.1.0").ok, true); // bare tag, no v
  assert.equal(checkTagMatchesContract("v0.2.0", "0.1.0").ok, false); // plugin-visible, needs a bump
  assert.equal(checkTagMatchesContract("v1.0.0", "0.1.0").ok, false);
});

test("checkTagMatchesContract names what to fix rather than just failing", () => {
  const res = checkTagMatchesContract("v0.2.0", "0.1.0");
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.error : "", /HOST_API_VERSION to 0\.2\.0/);
});

test("checkTagMatchesContract rejects junk on either side without throwing", () => {
  assert.equal(checkTagMatchesContract("v0.1.0", null).ok, false); // constant not found
  assert.equal(checkTagMatchesContract("nope", "0.1.0").ok, false);
  assert.equal(checkTagMatchesContract("v0.1.0", "1.0").ok, false);
});
