import assert from "node:assert/strict";
import { generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cachingJwks, createJwksProvider, loadJwks, staticJwks } from "./jwks.ts";

const jwk = (kid: string): JsonWebKey => ({ ...(generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" }) as JsonWebKey), alg: "ES256", kid });
const committed = join(dirname(fileURLToPath(import.meta.url)), "..", "ory/kratos/tokenizer/jwks.json");

test("staticJwks selects by kid, falls back to the sole key when none, misses cleanly", async () => {
  const [a, b] = [jwk("k1"), jwk("k2")];
  const set = staticJwks([a, b]);
  assert.equal(await set.getKey("k2"), b);
  assert.equal(await set.getKey("nope"), null);
  assert.equal(await set.getKey(undefined), null); // ambiguous with >1 key
  assert.equal(await staticJwks([a]).getKey(undefined), a); // single-key dev default
});

test("loadJwks reads a file:// set and a base64:// inline set, rejects http", () => {
  // The committed dev tokenizer key.
  const fromFile = loadJwks(pathToFileURL(committed).href);
  assert.equal(fromFile[0]?.kid, "42634591-3e04-49d5-a818-284d7021a85f");

  const inline = JSON.stringify({ keys: [jwk("inline")] });
  assert.equal(loadJwks(`base64://${Buffer.from(inline).toString("base64")}`)[0]?.kid, "inline");

  assert.throws(() => loadJwks("http://keto:4466/keys"), /unsupported/);

  // Malformed sets fail loud at load, not as an opaque crypto error at verify time.
  const b64 = (o: unknown) => `base64://${Buffer.from(JSON.stringify(o)).toString("base64")}`;
  assert.throws(() => loadJwks(b64({})), /missing `keys`/);
  assert.throws(() => loadJwks(b64({ keys: ["nope"] })), /string `kty`/); // a non-object key
  assert.throws(() => loadJwks(b64({ keys: [{ kid: "x" }] })), /string `kty`/); // key missing kty
});

test("cachingJwks caches within TTL, reloads after expiry", async () => {
  let clock = 0;
  let calls = 0;
  const k = jwk("k1");
  const c = cachingJwks(async () => (calls++, [k]), { minRefetchMs: 500, now: () => clock, ttlMs: 1000 });
  assert.equal(await c.getKey("k1"), k); // cold → loads
  await c.getKey("k1"); // within TTL → cached
  assert.equal(calls, 1);
  clock = 1001; // past TTL
  await c.getKey("k1");
  assert.equal(calls, 2);
});

test("cachingJwks reloads on a kid miss (rotation), throttled by minRefetchMs", async () => {
  let clock = 0;
  let calls = 0;
  const [old, fresh] = [jwk("old"), jwk("new")];
  let set = [old];
  const c = cachingJwks(async () => (calls++, set), { minRefetchMs: 1000, now: () => clock, ttlMs: 100_000 });
  assert.equal(await c.getKey("old"), old); // cold load
  set = [old, fresh]; // a new key rotates in at the source
  clock = 500; // miss inside the throttle window → no reload
  assert.equal(await c.getKey("new"), null);
  assert.equal(calls, 1);
  clock = 1001; // throttle elapsed → rotation-on-miss reload picks it up
  assert.equal(await c.getKey("new"), fresh);
  assert.equal(calls, 2);
});

test("cachingJwks keeps the last-good set when a reload fails, but a cold load propagates", async () => {
  let clock = 0;
  let fail = false;
  const k = jwk("k");
  const c = cachingJwks(async () => {
    if (fail) throw new Error("boom");
    return [k];
  }, { now: () => clock, ttlMs: 1000 });
  assert.equal(await c.getKey("k"), k);
  fail = true;
  clock = 2000; // TTL expired; the reload throws but the cached key still serves
  assert.equal(await c.getKey("k"), k);

  await assert.rejects(() => cachingJwks(async () => { throw new Error("down"); }).getKey("x"), /down/);
});

test("createJwksProvider routes file/base64/http, primes + caches http, fails loud on a bad source", async () => {
  // file:// primed at boot from the committed dev key.
  assert.ok(await (await createJwksProvider(pathToFileURL(committed).href)).getKey(undefined));

  // base64:// inline set.
  const inline = `base64://${Buffer.from(JSON.stringify({ keys: [jwk("inl")] })).toString("base64")}`;
  assert.equal((await (await createJwksProvider(inline)).getKey("inl"))?.kid, "inl");

  // http(s):// fetched once at boot, then served from cache.
  let calls = 0;
  const k = jwk("h1");
  const fetchImpl = (async () => (calls++, new Response(JSON.stringify({ keys: [k] }), { status: 200 }))) as typeof fetch;
  const http = await createJwksProvider("http://issuer/keys", { fetchImpl, ttlMs: 10_000 });
  assert.equal(calls, 1); // primed at boot
  assert.equal((await http.getKey("h1"))?.kid, "h1");
  assert.equal(calls, 1); // cached

  // Fail loud at boot: non-2xx fetch, missing file, unsupported scheme.
  await assert.rejects(() => createJwksProvider("http://issuer/keys", { fetchImpl: (async () => new Response("no", { status: 500 })) as typeof fetch }), /500/);
  await assert.rejects(() => createJwksProvider("file:///nope/jwks.json"), /ENOENT/);
  await assert.rejects(() => createJwksProvider("ftp://x/keys"), /unsupported/);
});
