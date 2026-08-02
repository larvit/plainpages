// Guards the docs-only fast path: `ci.sh` no-ops when nothing but *.md changed since main. The
// decision lives in ci.sh alone so `bash ci.sh` reproduces CI locally, and the workflow must still
// push the commit-hash image when it no-ops — release.yml re-tags that exact image, and
// fast-forward-only merges make every branch head a main commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const workflow = read(".gitea/workflows/ci.yml");
const gate = read("ci.sh");
const step = (needle: string) => {
	const found = workflow.split("\n      - ").slice(1).filter((s) => s.includes(needle));
	assert.equal(found.length, 1, `exactly one workflow step contains ${needle}`);
	return found[0]!;
};

test("the skip decision lives in ci.sh, so the workflow only runs it", () => {
	assert.match(gate, /docs_only\(\)/);
	assert.doesNotMatch(workflow, /docs_only|merge-base|GITHUB_OUTPUT/);
});

test("checkout is unshallow — the docs-only check needs the branch's history", () => {
	assert.match(step("actions/checkout"), /fetch-depth: 0/);
});

test("the commit-hash image is pushed even when the gate no-ops", () => {
	assert.doesNotMatch(step("docker push"), /^\s*if:/m);
});

test("only *.md counts as docs, and a dirty working tree counts as changed", () => {
	assert.ok(gate.includes("\\.md$"), "the non-docs match is a *.md suffix test");
	assert.match(gate, /git status --porcelain/, "uncommitted code can never be skipped over");
});
