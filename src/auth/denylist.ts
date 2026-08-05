// Optional revocation denylist: instant permission/session revoke without putting Keto back on the
// hot path. Off by default — enable with REVOCATION_DENYLIST=true. An admin action records the
// subject as revoked-now; the hot path then rejects that subject's pre-revoke tokens at once,
// forcing a re-mint (which re-reads permissions from Keto, or clears a now-dead session).
//
// An in-memory, auto-evicting Map — no database, so it stays inside the stateless model. Entries
// self-evict after one token TTL, by which point any pre-revoke token has expired anyway.
// Single-process: instant on the instance that handled the revoke, elsewhere the guarantee falls
// back to the token TTL. Back it with a shared store for hard multi-instance instant-revoke.

export interface Denylist {
  // Hot-path check: is a token for `sub`, issued at `iat` (unix sec), revoked? A token minted
  // after the latest revoke passes (a fresh re-login); a missing `iat` fails closed.
  isRevoked(sub: string, iat: number | undefined): boolean;
  // Record `sub` (a Kratos identity id) as revoked as of now: every token for it minted at or
  // before this instant is rejected until it would have expired anyway.
  revoke(sub: string): void;
}

export interface DenylistOptions {
  now?: () => number; // unix seconds; injectable for tests
  ttlSec?: number; // entry lifetime; keep ≥ tokenizer TTL + clock skew (default 900 ≥ 10m + 60s)
}

export function createDenylist(options: DenylistOptions = {}): Denylist {
  const ttl = options.ttlSec ?? 900;
  const clock = options.now ?? (() => Math.floor(Date.now() / 1000));
  const revokedAt = new Map<string, number>(); // sub → unix sec of its latest revoke

  return {
    isRevoked(sub, iat) {
      const at = revokedAt.get(sub);
      if (at === undefined) return false;
      if (clock() - at > ttl) {
        revokedAt.delete(sub); // expired entry — any token it could match is long gone
        return false;
      }
      return iat === undefined || iat <= at; // pre-revoke token (or unknown iat) ⇒ revoked
    },
    revoke(sub) {
      const now = clock();
      // Full-scan prune (cheap, and only on a revoke — never the hot path) keeps the map bounded
      // to recently-revoked subjects.
      for (const [s, at] of revokedAt) if (now - at > ttl) revokedAt.delete(s);
      revokedAt.set(sub, now); // latest revoke wins; advances the cutoff
    },
  };
}
