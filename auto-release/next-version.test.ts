import assert from "node:assert/strict";
import { test } from "node:test";
import { bumpFromUpdateType, maxLevel, nextVersion } from "./next-version.ts";

test("bumpFromUpdateType: only major/minor keep their level; everything else is patch", () => {
  assert.equal(bumpFromUpdateType("major"), "major");
  assert.equal(bumpFromUpdateType("minor"), "minor");
  assert.equal(bumpFromUpdateType("patch"), "patch");
  assert.equal(bumpFromUpdateType("digest"), "patch");
  assert.equal(bumpFromUpdateType("pin"), "patch");
  assert.equal(bumpFromUpdateType("lockFileMaintenance"), "patch");
  assert.equal(bumpFromUpdateType(""), "patch");
});

test("maxLevel: defaults to patch, escalates on the highest level present", () => {
  assert.equal(maxLevel([]), "patch");
  assert.equal(maxLevel(["patch"]), "patch");
  assert.equal(maxLevel(["patch", "minor"]), "minor");
  assert.equal(maxLevel(["minor", "major", "patch"]), "major");
  assert.equal(maxLevel(["digest", "pin"]), "patch");
  assert.equal(maxLevel(["", "bogus"]), "patch"); // unknown → patch, never throws
});

test("nextVersion pre-1.0 (major===0): shift down so we never auto-cross into 1.0.0", () => {
  // dep major → 0.x minor (the 0.x "breaking" slot); dep minor/patch → 0.x patch
  assert.equal(nextVersion("v0.0.2", "major"), "v0.1.0");
  assert.equal(nextVersion("v0.0.2", "minor"), "v0.0.3");
  assert.equal(nextVersion("v0.0.2", "patch"), "v0.0.3");
  assert.equal(nextVersion("v0.3.4", "major"), "v0.4.0");
  assert.equal(nextVersion("v0.3.4", "minor"), "v0.3.5");
  assert.equal(nextVersion("v0.3.4", "patch"), "v0.3.5");
});

test("nextVersion at/after 1.0.0: literal semver", () => {
  assert.equal(nextVersion("v1.2.3", "major"), "v2.0.0");
  assert.equal(nextVersion("v1.2.3", "minor"), "v1.3.0");
  assert.equal(nextVersion("v1.2.3", "patch"), "v1.2.4");
});

test("nextVersion rejects a tag that is not vX.Y.Z", () => {
  assert.throws(() => nextVersion("1.2.3", "patch"), /vX\.Y\.Z/);
  assert.throws(() => nextVersion("vx.y.z", "patch"), /vX\.Y\.Z/);
});
