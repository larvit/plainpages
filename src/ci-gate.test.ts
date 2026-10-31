// Guards the docs-only fast path: `ci.sh` no-ops when nothing but *.md changed since main. The
// decision lives in ci.sh alone so `bash ci.sh` reproduces CI locally, and the workflow must still
// push the commit-hash image when it no-ops — release.yml re-tags that exact image, and
// fast-forward-only merges make every branch head a main commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const workflow = read(".gitea/workflows/ci.yml");
// Comments stripped: the flags below must be asserted against the code, not against prose naming them.
const gate = read("ci.sh").split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
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

test("every E2E suite the gate runs writes its artifacts as the invoking user", () => {
	// The documented hand-run commands carry the same flag (src/compose.test.ts).
	const runs = gate.split("\n").filter((l) => /docker compose .*\brun\b.*\be2e\b/.test(l));
	assert.equal(runs.length, 3, "the e2e-tests typecheck, the suite helper and the devstack run");
	for (const line of runs)
		assert.match(line, /--user "\$\(id -u\):\$\(id -g\)"/, `runs as the caller: ${line.trim()}`);
});

test("the gate typechecks e2e-tests in the runner image, where @playwright/test resolves", () => {
	assert.match(gate, /docker compose .*\brun\b.*--no-deps\b.*\be2e\b npm run typecheck/);
	assert.match(read("e2e-tests/package.json"), /"typecheck": "tsc --noEmit"/);
});

test("only *.md counts as docs; a dirty tree and a rename both count as changed", () => {
	assert.ok(gate.includes("\\.md$"), "the non-docs match is a *.md suffix test");
	assert.match(gate, /git status --porcelain --no-renames/, "uncommitted code and a staged rename can never be skipped over");
	assert.match(gate, /git diff --name-only --no-renames/, "a rename must list both of its paths");
});
