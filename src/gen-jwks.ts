import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ES256 signing JWKS for the Kratos session tokenizer (§3) — Ory-recommended and the
// verifier's preferred alg (src/jwt.ts). Rotation runbook: README, JWT signing key.
// CLI (prod supplies its own key; the committed one is a dev throwaway):
//   gen-jwks.ts                       → a fresh one-key set (mint/replace; emergency rotation)
//   gen-jwks.ts --prepend <jwks.json> → new key first + the old ones (zero-downtime rotation)
//   gen-jwks.ts --prune   <jwks.json> → keep only the newest key (drop superseded, post-TTL)
// All write to stdout; redirect into the JWKS file (use a temp file for --prepend/--prune so
// the shell's `>` can't truncate the input before it's read).

export interface SigningJwk {
  kid: string;
  alg: "ES256";
  crv: string;
  d: string; // private scalar — this is a signing key, keep it secret
  kty: string;
  use: "sig";
  x: string;
  y: string;
}
export interface JwkSet {
  keys: SigningJwk[];
}

export function generateJwks(): JwkSet {
  const { crv, d, kty, x, y } = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
  if (!crv || !d || !kty || !x || !y) throw new Error("unexpected JWK shape from EC key");
  return { keys: [{ kid: randomUUID(), alg: "ES256", crv, d, kty, use: "sig", x, y }] };
}

// Rotate a JWKS: prepend a fresh key (Kratos signs with the first; the old keys still verify
// in-flight JWTs) — or, with `prune`, keep only the newest key (drop superseded ones once the
// old token TTL has elapsed). Pure list math; the active signing key is always keys[0].
export function rotateJwks(current: JwkSet, opts: { prune?: boolean } = {}): JwkSet {
  return opts.prune ? { keys: current.keys.slice(0, 1) } : { keys: [generateJwks().keys[0]!, ...current.keys] };
}

// CLI: print the resulting set to stdout (see the header for the redirect caveat).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rotate = args.includes("--prepend") || args.includes("--prune");
  let set: JwkSet;
  if (rotate) {
    const path = args.find((a) => !a.startsWith("--"));
    if (!path) throw new Error("usage: gen-jwks.ts [--prepend|--prune] <existing-jwks.json>");
    set = rotateJwks(JSON.parse(readFileSync(path, "utf8")) as JwkSet, { prune: args.includes("--prune") });
  } else set = generateJwks();
  process.stdout.write(`${JSON.stringify(set, null, 2)}\n`);
}
