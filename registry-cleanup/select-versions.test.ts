import assert from "node:assert/strict";
import { test } from "node:test";
import { planHashTagDeletions, selectOrphanedManifests } from "./select-versions.ts";

const headSha = "0582809000000000000000000000000000000001";
const releaseSha = "50006dd000000000000000000000000000000002";
const staleSha = "c8981c1000000000000000000000000000000003";

test("planHashTagDeletions deletes hash tags that are neither a branch head nor release-tagged", () => {
  const plan = planHashTagDeletions({
    branchHeadShas: [headSha],
    releaseTagShas: [releaseSha],
    versions: [headSha, releaseSha, staleSha],
  });
  assert.deepEqual(plan.deletions, [staleSha]);
  assert.deepEqual(plan.keptTags, [headSha, releaseSha]);
});

test("planHashTagDeletions keeps named tags and excludes sha256 manifest versions from keptTags", () => {
  const plan = planHashTagDeletions({
    branchHeadShas: [],
    releaseTagShas: [],
    versions: ["0.0.1", "0", "latest", "some-manual-tag", `sha256:${"a".repeat(64)}`, staleSha],
  });
  assert.deepEqual(plan.deletions, [staleSha]);
  assert.deepEqual(plan.keptTags, ["0.0.1", "0", "latest", "some-manual-tag"]);
});

test("planHashTagDeletions with no versions plans nothing", () => {
  const plan = planHashTagDeletions({ branchHeadShas: [headSha], releaseTagShas: [], versions: [] });
  assert.deepEqual(plan.deletions, []);
  assert.deepEqual(plan.keptTags, []);
});

test("selectOrphanedManifests picks only sha256 versions unreferenced by kept tags", () => {
  const referenced = `sha256:${"b".repeat(64)}`;
  const orphaned = `sha256:${"c".repeat(64)}`;
  const orphans = selectOrphanedManifests({
    referencedDigests: [referenced],
    versions: ["0.0.1", "latest", headSha, referenced, orphaned],
  });
  assert.deepEqual(orphans, [orphaned]);
});

test("selectOrphanedManifests with nothing referenced orphans every sha256 version", () => {
  const manifest = `sha256:${"d".repeat(64)}`;
  assert.deepEqual(selectOrphanedManifests({ referencedDigests: [], versions: [manifest, "latest"] }), [manifest]);
});
