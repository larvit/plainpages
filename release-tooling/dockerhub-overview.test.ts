import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { leftoverPlaceholders, renderOverview } from "./dockerhub-overview.ts";

test("renderOverview substitutes every occurrence, not just the first", () => {
  const out = renderOverview("pull a:{{VERSION}} then b:{{VERSION}}", "1.2.3");
  assert.equal(out, "pull a:1.2.3 then b:1.2.3");
});

test("leftoverPlaceholders catches a typo'd placeholder, deduped, and passes clean text", () => {
  assert.deepEqual(leftoverPlaceholders("a {{VERISON}} b {{VERISON}}"), ["{{VERISON}}"]);
  assert.deepEqual(leftoverPlaceholders(renderOverview("x {{VERSION}}", "0.1.0")), []);
});

test("the real README-dockerhub.md renders clean and pins no literal image tag", () => {
  const rendered = renderOverview(readFileSync("README-dockerhub.md", "utf8"), "9.9.9");
  assert.deepEqual(leftoverPlaceholders(rendered), []);
  assert.match(rendered, /larvit\/plainpages:9\.9\.9/); // the placeholder actually reaches the examples
  // A hardcoded version here is what went stale on the live page; the release must own every one.
  assert.doesNotMatch(rendered, /larvit\/plainpages:\d+\.\d+\.\d+(?<!9\.9\.9)/);
});
