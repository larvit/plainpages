import type { JsonWebKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { currentLog } from "../logger.ts";

// JWKS provider: resolve the JWT verify key by the JWS `kid`. The middleware calls
// `getKey` per request. `staticJwks` holds a fixed set; `cachingJwks` fetches over the network
// (or re-reads a mounted file), caches for a TTL, and reloads once on a `kid` miss so a rotated-
// in key is picked up without a restart (README: zero-downtime rotation). `createJwksProvider`
// picks the right one from the configured URL scheme and primes it at boot (fail loud).
export interface JwksProvider {
  getKey(kid: string | undefined): Promise<JsonWebKey | null>;
}

const TTL_MS = 5 * 60_000; // serve a fetched set this long before reloading
const MIN_REFETCH_MS = 60_000; // floor between rotation-on-miss reloads — a stream of bogus kids can't hammer the source

export interface JwksCacheOptions {
  fetchImpl?: typeof fetch;
  minRefetchMs?: number;
  now?: () => number; // unix ms; injectable for tests
  ttlMs?: number;
}

function parseJwks(text: string): JsonWebKey[] {
  const parsed = JSON.parse(text) as { keys?: unknown };
  if (!Array.isArray(parsed.keys)) throw new Error("JWKS: missing `keys` array");
  // Validate element shape here so a malformed key fails loud at load, not as an opaque crypto
  // error on the first authenticated request (the verifier keys off `kty`/`kid`).
  for (const k of parsed.keys) {
    if (typeof k !== "object" || k === null || typeof (k as JsonWebKey).kty !== "string") {
      throw new Error("JWKS: each key must be an object with a string `kty`");
    }
  }
  return parsed.keys as JsonWebKey[];
}

// Load a JWKS synchronously from a local source: `file://` reads a mounted key, `base64://`
// decodes an inline set (README rotation). HTTP is `cachingJwks`'s job — fail loud here.
export function loadJwks(jwksUrl: string): JsonWebKey[] {
  if (jwksUrl.startsWith("base64://")) return parseJwks(Buffer.from(jwksUrl.slice("base64://".length), "base64").toString("utf8"));
  const url = new URL(jwksUrl);
  if (url.protocol === "file:") return parseJwks(readFileSync(fileURLToPath(url), "utf8"));
  throw new Error(`loadJwks: unsupported JWKS URL scheme (use cachingJwks for http): ${jwksUrl}`);
}

async function fetchJwks(jwksUrl: string, fetchImpl: typeof fetch): Promise<JsonWebKey[]> {
  const res = await fetchImpl(jwksUrl, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`JWKS fetch ${jwksUrl}: HTTP ${res.status}`);
  return parseJwks(await res.text());
}

function pick(keys: JsonWebKey[], kid: string | undefined): JsonWebKey | null {
  // No `kid`: fall back to the sole key (single-key dev default), else ambiguous → null.
  if (kid === undefined) return keys.length === 1 ? keys[0]! : null;
  return keys.find((k) => k.kid === kid) ?? null;
}

// A fixed in-memory key set — loaded once, never reloads. For immutable sources (base64 inline).
export function staticJwks(keys: JsonWebKey[]): JwksProvider {
  return { getKey: async (kid) => pick(keys, kid) };
}

// A self-refreshing provider over an async loader. Holds keys for `ttlMs`, then reloads on the
// next lookup; on a `kid` miss it reloads once more (rotation-on-miss), throttled by `minRefetchMs`.
// A reload failure keeps the last-good set (transient resilience); only a cold cache propagates it
// (→ the middleware fails closed). `prime()` does the eager boot load. Concurrent loads coalesce.
export function cachingJwks(load: () => Promise<JsonWebKey[]>, opts: JwksCacheOptions = {}): JwksProvider & { prime: () => Promise<void> } {
  const ttlMs = opts.ttlMs ?? TTL_MS;
  const minRefetchMs = opts.minRefetchMs ?? MIN_REFETCH_MS;
  const now = opts.now ?? Date.now;
  let keys: JsonWebKey[] = [];
  let loadedAt = -Infinity;
  let inflight: Promise<void> | null = null;

  const refresh = (): Promise<void> =>
    (inflight ??= load().then(
      (k) => { keys = k; loadedAt = now(); inflight = null; },
      (e: unknown) => { inflight = null; throw e; },
    ));

  return {
    prime: refresh,
    getKey: async (kid) => {
      if (keys.length === 0 || now() - loadedAt > ttlMs) {
        try { await refresh(); } catch (e) { if (keys.length === 0) throw e; } // else keep last-good
      }
      const hit = pick(keys, kid);
      if (hit || kid === undefined) return hit;
      if (now() - loadedAt >= minRefetchMs) {
        currentLog()?.debug("jwks reload on kid miss (rotation?)", { kid }); // rare — only an unknown kid
        try { await refresh(); } catch { /* keep last-good */ }
      }
      return pick(keys, kid);
    },
  };
}

// Build the verify-key provider from the configured JWKS URL and prime it at boot (fail loud):
// `base64://` → immutable inline set; `file://` → re-readable cache (rotation by remount/edit);
// `http(s)://` → fetched, cached, rotation-on-miss. The middleware sees only `getKey`.
export async function createJwksProvider(jwksUrl: string, opts: JwksCacheOptions = {}): Promise<JwksProvider> {
  if (jwksUrl.startsWith("base64://")) return staticJwks(loadJwks(jwksUrl));
  const { protocol } = new URL(jwksUrl);
  let load: () => Promise<JsonWebKey[]>;
  if (protocol === "file:") load = async () => loadJwks(jwksUrl);
  else if (protocol === "http:" || protocol === "https:") {
    const fetchImpl = opts.fetchImpl ?? fetch;
    load = () => fetchJwks(jwksUrl, fetchImpl);
  } else throw new Error(`createJwksProvider: unsupported JWKS URL scheme: ${jwksUrl}`);
  const provider = cachingJwks(load, opts);
  await provider.prime();
  return provider;
}
