import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkTagMatchesContract, readHostApiVersion } from "./contract-version.ts";

test("readHostApiVersion pulls the constant out of the real source, and returns null when absent", () => {
  const real = readFileSync("src/plugin-host/plugin.ts", "utf8");
  assert.match(readHostApiVersion(real) ?? "", /^\d+\.\d+\.\d+$/);
  assert.equal(readHostApiVersion('export const SOMETHING_ELSE = "1.0.0";'), null);
});

test("bumping HOST_API_VERSION is a deliberate act, so pin the shipped value", () => {
  // Not a substitute for the release gate — this test cannot see a tag. It is the tripwire that
  // makes an accidental edit fail here rather than at release time.
  assert.equal(readHostApiVersion(readFileSync("src/plugin-host/plugin.ts", "utf8")), "0.3.0");
});

test("every author-facing apiVersion sample matches the shipped contract", () => {
  // A plugin author copies these; a stale one produces a boot-aborting refuse on first run. The
  // examples deliberately write a literal rather than importing the constant (AGENTS.md), so this
  // is the only thing keeping the copies honest.
  const host = readHostApiVersion(readFileSync("src/plugin-host/plugin.ts", "utf8")) ?? "";
  const [major, minor] = host.split(".");
  for (const file of [
    "README.md",
    "examples/plugins/admin/plugin.ts",
    "examples/plugins/scheduling/plugin.ts",
    "release-tooling/dockerhub-overview.md.tmpl",
    "views/index.ejs",
  ]) {
    const found = [...readFileSync(file, "utf8").matchAll(/apiVersion: "(\d+\.\d+\.\d+)"/g)].map((m) => m[1]);
    assert.ok(found.length > 0, `${file} should carry at least one apiVersion sample`);
    for (const sample of found) {
      const [sMajor, sMinor] = (sample ?? "").split(".");
      assert.equal(`${sMajor}.${sMinor}`, `${major}.${minor}`, `${file} samples apiVersion ${sample}, host is ${host}`);
    }
  }
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
