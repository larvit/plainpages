import assert from "node:assert/strict";
import test from "node:test";
import { withTimeout } from "./fetch-timeout.ts";

test("withTimeout injects an abort signal that fires after the deadline", async () => {
  let seenSignal: AbortSignal | undefined;
  const slow: typeof fetch = ((_input, init) => {
    seenSignal = (init as RequestInit | undefined)?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      seenSignal?.addEventListener("abort", () => reject(seenSignal!.reason));
    });
  }) as typeof fetch;

  await assert.rejects(withTimeout(slow, 20)("http://x/"), (e: unknown) => (e as Error).name === "TimeoutError");
  assert.ok(seenSignal instanceof AbortSignal); // the wrapped call received a real signal
});

test("withTimeout keeps a caller-supplied signal instead of overriding it", async () => {
  let seen: AbortSignal | undefined;
  const fake: typeof fetch = ((_input, init) => { seen = (init as RequestInit | undefined)?.signal ?? undefined; return Promise.resolve(new Response("ok")); }) as typeof fetch;
  const mine = new AbortController().signal;
  await withTimeout(fake, 50)("http://x/", { signal: mine });
  assert.equal(seen, mine);
});
