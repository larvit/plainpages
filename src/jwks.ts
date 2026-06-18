import type { JsonWebKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// JWKS provider: resolve the JWT verify key by the JWS `kid` (todo §4). The middleware
// calls `getKey` per request. `staticJwks` holds a fixed set loaded once at boot from the
// mounted/dev key; HTTP fetch + TTL refresh + rotation-on-miss is the next §4 item.
export interface JwksProvider {
  getKey(kid: string | undefined): Promise<JsonWebKey | null>;
}

function parseJwks(text: string): JsonWebKey[] {
  const parsed = JSON.parse(text) as { keys?: unknown };
  if (!Array.isArray(parsed.keys)) throw new Error("JWKS: missing `keys` array");
  return parsed.keys as JsonWebKey[];
}

// Load a JWKS from the configured location: `file://` reads the mounted tokenizer key (the
// dev default + prod mount), `base64://` decodes an inline set (README rotation). `http(s)://`
// is the rotating-cache's job (next §4 item) — fail loud rather than silently no-fetch.
export function loadJwks(jwksUrl: string): JsonWebKey[] {
  if (jwksUrl.startsWith("base64://")) return parseJwks(Buffer.from(jwksUrl.slice("base64://".length), "base64").toString("utf8"));
  const url = new URL(jwksUrl);
  if (url.protocol === "file:") return parseJwks(readFileSync(fileURLToPath(url), "utf8"));
  throw new Error(`loadJwks: unsupported JWKS URL scheme (HTTP fetch lands with the §4 JWKS cache): ${jwksUrl}`);
}

// A fixed in-memory key set. Pick by `kid`; with no `kid` fall back to the sole key (single-
// key dev default). Async so the §4 cache can drop in refetch-on-miss without touching callers.
export function staticJwks(keys: JsonWebKey[]): JwksProvider {
  return {
    getKey: async (kid) => {
      if (kid === undefined) return keys.length === 1 ? keys[0]! : null;
      return keys.find((k) => k.kid === kid) ?? null;
    },
  };
}
