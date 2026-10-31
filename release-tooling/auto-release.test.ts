import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("auto-release's checkout doesn't persist credentials, so the tag push authenticates as renovate-bot", () => {
  const workflow = readFileSync(".gitea/workflows/renovate.yml", "utf8");
  const job = workflow.slice(workflow.indexOf("\n  auto-release:"));
  const checkout = job.slice(job.indexOf("actions/checkout@"), job.indexOf("\n      - name:"));
  assert.match(checkout, /^\s+persist-credentials: false$/m);
});
