import { generateKeyPairSync, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// ES256 signing JWKS for the Kratos session tokenizer (§3). Ory recommends ES* over the
// symmetric HS family; ES256 is also our verifier's preferred alg (src/jwt.ts). Kratos
// signs with the FIRST key in the set and the app verifies by `kid` (§4) — so rotation is
// prepend a fresh key, keep the old one ~one TTL (10m) for in-flight tokens, then drop it.
// (Re)generate the committed dev key (prod supplies its own — see README):
//   docker compose run --rm -T web node src/gen-jwks.ts > ory/kratos/tokenizer/jwks.json

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
