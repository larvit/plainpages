import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { jwtFrom, leftoverPlaceholders, renderOverview } from "./dockerhub-overview.ts";

const TEMPLATE = "release-tooling/dockerhub-overview.md.tmpl";
const template = () => readFileSync(TEMPLATE, "utf8");

test("renderOverview substitutes every occurrence, not just the first", () => {
  const out = renderOverview("pull a:{{VERSION}} then b:{{VERSION}}", "1.2.3");
  assert.equal(out, "pull a:1.2.3 then b:1.2.3");
});

test("leftoverPlaceholders catches a typo'd placeholder, deduped, and passes clean text", () => {
  assert.deepEqual(leftoverPlaceholders("a {{VERISON}} b {{VERISON}}"), ["{{VERISON}}"]);
  assert.deepEqual(leftoverPlaceholders(renderOverview("x {{VERSION}}", "0.1.0")), []);
});

test("the real template renders clean, and the release owns its own image tag", () => {
  const rendered = renderOverview(template(), "9.9.9");
  assert.deepEqual(leftoverPlaceholders(rendered), []);
  assert.match(rendered, /larvit\/plainpages:9\.9\.9/); // the placeholder actually reaches the examples
  assert.doesNotMatch(rendered, /larvit\/plainpages:\d+\.\d+\.\d+(?<!9\.9\.9)/);
});

test("the quick start's sidecars are pinned to the same versions this repo runs", () => {
  // The page is published automatically, so a drifted pin here ships a topology CI never tested.
  const pins = (source: string) =>
    new Map([...source.matchAll(/image: ([^:\s]+):(v?\d\S*)/g)].map((m) => [m[1] ?? "", m[2] ?? ""]));
  const ours = new Map([
    ...pins(readFileSync("compose.override.yml", "utf8")),
    ...pins(readFileSync("compose.yml", "utf8")), // production wins: the template is the prod quick start
  ]);
  const published = pins(template());
  assert.ok(published.size > 0, "the template should pin sidecars");
  for (const [image, tag] of published) {
    assert.equal(tag, ours.get(image), `${TEMPLATE} pins ${image}:${tag}, this repo runs ${ours.get(image)}`);
  }
});

test("jwtFrom accepts only a non-empty string token, never throwing on a hostile body", () => {
  assert.equal(jwtFrom({ token: "abc" }), "abc");
  assert.equal(jwtFrom(null), null); // valid JSON, and the shape a proxy can return
  assert.equal(jwtFrom("<html>rate limited</html>"), null);
  assert.equal(jwtFrom({}), null);
  assert.equal(jwtFrom({ token: "" }), null);
  assert.equal(jwtFrom({ token: 42 }), null);
});
