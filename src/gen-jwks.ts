import { generateKeyPairSync, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// ES256 signing JWKS for the Kratos session tokenizer (§3) — Ory-recommended and the
// verifier's preferred alg (src/jwt.ts). Rotation runbook: README, JWT signing key.
// (Re)generate the committed dev key (prod supplies its own):
//   docker compose run --rm -T --no-deps web node src/gen-jwks.ts > ory/kratos/tokenizer/jwks.json

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

// CLI: print a fresh set to stdout (redirect into the jwks.json above).
if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(`${JSON.stringify(generateJwks(), null, 2)}\n`);
