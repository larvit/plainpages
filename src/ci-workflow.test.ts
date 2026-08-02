// Guards the docs-only fast path in .gitea/workflows/ci.yml: a branch that only touches *.md
// skips `ci.sh`, but must still publish its commit-hash image — release.yml re-tags that exact
// image, and fast-forward-only merges make every branch head a main commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ci = readFileSync(new URL("../.gitea/workflows/ci.yml", import.meta.url), "utf8");
const steps = ci.split("\n      - ").slice(1);
const step = (needle: string) => {
	const found = steps.filter((s) => s.includes(needle));
	assert.equal(found.length, 1, `exactly one step contains ${needle}`);
	return found[0]!;
};

test("checkout is unshallow — the merge-base with main needs the branch's history", () => {
	assert.match(step("actions/checkout"), /fetch-depth: 0/);
});

test("a docs-only branch skips the test gate", () => {
	assert.match(step("bash ci.sh"), /if: steps\.scope\.outputs\.docs_only != 'true'/);
});

test("a docs-only branch still pushes its commit-hash image", () => {
	assert.doesNotMatch(step("docker push"), /^\s*if:/m);
});

test("only *.md counts as docs, and anything unexpected runs the gate", () => {
	const detect = step("docs_only=");
	assert.ok(detect.includes("\\.md$"), "the non-docs match is a *.md suffix test");
	assert.ok(detect.includes("docs_only=false"), "the fallback is the full gate, never a skip");
});
