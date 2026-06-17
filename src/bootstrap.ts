// One-command bootstrap (todo §3, the MVP bar). Runs as the one-shot `bootstrap` compose
// service after kratos+keto are healthy; `web` waits for it to finish. Idempotent — safe
// to re-run on every `docker compose up`:
//   1. generate the JWKS signing key if absent (committed dev key makes this a safety net);
//   2. seed a demo admin identity (admin@plainpages.local / admin) in Kratos;
//   3. grant it the `admin` role in Keto so menu/permission checks resolve out of the box.
// On finish it prints a first-run banner (login URL + creds + change-before-prod warning).
// Fails loud on any unexpected upstream error.
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateJwks, type JwkSet } from "./gen-jwks.ts";

// --- Pure payload builders (the Kratos/Keto request contracts) -----------------------

export function identityPayload(email: string, password: string) {
  return {
    credentials: { password: { config: { password } } }, // cleartext; Kratos hashes it
    schema_id: "default",
    traits: { email, name: { first: "Admin", last: "User" } },
  };
}

// Coarse-role grant: `Role:<role>#members@user:<id>`. Subject ids are `user:<kratos-id>`
// (namespaces.keto.ts) — the source of truth the login flow projects into the JWT roles.
export function roleTuple(identityId: string, role: string) {
  return { namespace: "Role", object: role, relation: "members", subject_id: `user:${identityId}` };
}

// --- JWKS safety net -----------------------------------------------------------------

export interface JwksFsHooks {
  exists?: (path: string) => boolean;
  generate?: () => JwkSet;
  write?: (path: string, content: string) => void;
}

// Generate the signing key only when the file is missing; returns whether it wrote one.
export function ensureJwks(path: string, hooks: JwksFsHooks = {}): boolean {
  const exists = hooks.exists ?? existsSync;
  if (exists(path)) return false;
  const generate = hooks.generate ?? generateJwks;
  const write = hooks.write ?? ((p, c) => writeFileSync(p, c));
  write(path, `${JSON.stringify(generate(), null, 2)}\n`);
  return true;
}

// --- Admin seeding -------------------------------------------------------------------

export interface SeedOptions {
  email: string;
  fetchImpl?: typeof fetch;
  ketoWriteUrl: string;
  kratosAdminUrl: string;
  password: string;
  role: string;
}

export interface SeedResult {
  created: boolean;
  id: string;
  role: string;
}

export async function seedAdmin(opts: SeedOptions): Promise<SeedResult> {
  const http = opts.fetchImpl ?? fetch;

  // Create the identity. A 409 means it already exists (a re-run) — look up its id.
  const res = await http(`${opts.kratosAdminUrl}/admin/identities`, {
    body: JSON.stringify(identityPayload(opts.email, opts.password)),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  let created: boolean;
  let id: string;
  if (res.status === 201) {
    id = ((await res.json()) as { id: string }).id;
    created = true;
  } else if (res.status === 409) {
    id = await findIdentityId(http, opts.kratosAdminUrl, opts.email);
    created = false;
  } else {
    throw new Error(`bootstrap: Kratos create identity failed (${res.status}): ${await res.text()}`);
  }

  // Grant the role in Keto. PUT is idempotent — re-running just re-asserts the tuple.
  const grant = await http(`${opts.ketoWriteUrl}/admin/relation-tuples`, {
    body: JSON.stringify(roleTuple(id, opts.role)),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
  if (!grant.ok) throw new Error(`bootstrap: Keto grant role failed (${grant.status}): ${await grant.text()}`);

  return { created, id, role: opts.role };
}

async function findIdentityId(http: typeof fetch, adminUrl: string, email: string): Promise<string> {
  const res = await http(`${adminUrl}/admin/identities?credentials_identifier=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error(`bootstrap: Kratos lookup failed (${res.status}): ${await res.text()}`);
  const found = ((await res.json()) as { id: string }[])[0];
  if (!found?.id) throw new Error(`bootstrap: ${email} reported as existing but not found`);
  return found.id;
}

// --- First-run banner ----------------------------------------------------------------

// Loud, scannable block in the compose logs: where to log in + the seeded demo creds +
// the "change before production" warning. Pure so it's testable; main() console.logs it.
export function firstRunBanner(opts: { appUrl: string; email: string; password: string }): string {
  const rule = "─".repeat(58);
  return [
    `┌${rule}`,
    `│ Plainpages is ready — log in at ${opts.appUrl}`,
    `│   email:    ${opts.email}`,
    `│   password: ${opts.password}`,
    `│ ⚠ Demo admin credentials — change them before production.`,
    `└${rule}`,
  ].join("\n");
}

// --- CLI (the bootstrap container entrypoint) ----------------------------------------

async function main() {
  const env = process.env;
  if (ensureJwks(env["JWKS_FILE"] ?? "/etc/config/kratos/tokenizer/jwks.json")) console.log("bootstrap: generated a JWKS signing key");

  const role = env["ADMIN_ROLE"] ?? "admin";
  const email = env["ADMIN_EMAIL"] ?? "admin@plainpages.local";
  const password = env["ADMIN_PASSWORD"] ?? "admin";
  const result = await seedAdmin({
    email,
    ketoWriteUrl: env["KETO_WRITE_URL"] ?? "http://keto:4467",
    kratosAdminUrl: env["KRATOS_ADMIN_URL"] ?? "http://kratos:4434",
    password,
    role,
  });
  console.log(`bootstrap: admin ${result.created ? "created" : "already present"} (${result.id}); role "${role}" granted`);
  console.log(firstRunBanner({ appUrl: env["APP_URL"] ?? "http://localhost:3000", email, password }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
