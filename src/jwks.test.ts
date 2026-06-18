import assert from "node:assert/strict";
import { generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadJwks, staticJwks } from "./jwks.ts";

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
});
