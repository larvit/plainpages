import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestContext } from "./context.ts";
import type { Plugin, PluginHooks } from "./plugin.ts";
import { runBootHooks, runRequestHooks, runResponseHooks } from "./hooks.ts";

const ctx = {} as RequestContext; // the hooks only thread ctx through; they never read it

function plugin(id: string, hooks: PluginHooks): Plugin {
  return { apiVersion: "1.0.0", hooks, id };
}

test("runBootHooks runs each onBoot in order, skips plugins without one, and a throw aborts", async () => {
  const calls: string[] = [];
  await runBootHooks([
    plugin("a", { onBoot: () => void calls.push("a") }),
    plugin("b", {}), // no onBoot → skipped
    plugin("c", { onBoot: async () => void calls.push("c") }),
  ]);
  assert.deepEqual(calls, ["a", "c"]);

  await assert.rejects(runBootHooks([plugin("x", { onBoot: () => { throw new Error("boom"); } })]), /boom/);
});

test("runRequestHooks short-circuits on the first RouteResult (with its plugin); later hooks skipped", async () => {
  const calls: string[] = [];
  const short = await runRequestHooks([
    plugin("a", { onRequest: () => void calls.push("a") }), // returns void → continue
    plugin("b", { onRequest: () => { calls.push("b"); return { html: "stop" }; } }),
    plugin("c", { onRequest: () => void calls.push("c") }), // never reached
  ], ctx);

  assert.deepEqual(short?.result, { html: "stop" });
  assert.equal(short?.plugin.id, "b"); // the owning plugin (so a `view` result resolves correctly)
  assert.deepEqual(calls, ["a", "b"]);

  // No hook short-circuits → null (proceed with normal routing).
  assert.equal(await runRequestHooks([plugin("a", { onRequest: () => {} })], ctx), null);
});

test("runResponseHooks runs every onResponse as an observer with the result; a throw fails", async () => {
  const seen: unknown[] = [];
  await runResponseHooks([
    plugin("a", { onResponse: (_c, r) => void seen.push(r) }),
    plugin("b", {}), // no onResponse → skipped
  ], ctx, { html: "ok" });
  assert.deepEqual(seen, [{ html: "ok" }]);

  await assert.rejects(runResponseHooks([plugin("x", { onResponse: () => { throw new Error("boom"); } })], ctx, null), /boom/);
});
