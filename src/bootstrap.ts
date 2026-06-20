// One-command bootstrap (todo §3, the MVP bar). One-shot compose service: runs after
// kratos+keto are healthy (web waits on it), idempotent on every `docker compose up`:
//   1. generate the JWKS signing key if absent (committed dev key makes this a safety net);
//   2. seed a demo admin (admin@plainpages.local / admin) in Kratos;
//   3. grant it its roles in Keto so menu/permission checks resolve out of the box — `admin` plus
//      every discovered plugin's declared permission tokens, so a dropped-in plugin is usable by
//      the demo admin with no host config edit (the host stays plugin-agnostic).
// Then prints a first-run banner; fails loud on any unexpected upstream error.
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { discoverPlugins } from "./discovery.ts";
import { generateJwks, type JwkSet } from "./gen-jwks.ts";
import { createLogger, runWithLog, tracedFetch } from "./logger.ts";

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

// The roles to grant the demo admin = the configured base (ADMIN_ROLES, default just `admin`)
// unioned with every discovered plugin's declared permission tokens (a route/nav `permission` is a
// coarse role — granted as a Keto `Role:<token>#members` tuple). So the host names no plugin, yet a
// dropped-in plugin's tokens are seeded out of the box. Deduped, order-stable, blanks dropped.
export function seedRoles(adminRolesEnv: string | undefined, declaredTokens: string[]): string[] {
  const clean = (xs: string[]): string[] => xs.map((r) => r.trim()).filter(Boolean);
  return [...new Set([...clean((adminRolesEnv ?? "admin").split(",")), ...clean(declaredTokens)])];
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
  roles: string[];
}

export interface SeedResult {
  created: boolean;
  id: string;
  roles: string[];
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

  // Grant each role in Keto. PUT is idempotent — re-running just re-asserts the tuple.
  for (const role of opts.roles) {
    const grant = await http(`${opts.ketoWriteUrl}/admin/relation-tuples`, {
      body: JSON.stringify(roleTuple(id, role)),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    if (!grant.ok) throw new Error(`bootstrap: Keto grant role "${role}" failed (${grant.status}): ${await grant.text()}`);
  }

  return { created, id, roles: opts.roles };
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
// the "change before production" warning. Pure so it's testable; main() prints it verbatim.
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
  // Structured like the web app (§9) so prod logs stay uniform; honour LOG_FORMAT/SERVICE_NAME.
  const log = createLogger({
    format: env["LOG_FORMAT"] === "json" ? "json" : "text",
    ...(env["SERVICE_NAME"] ? { serviceName: env["SERVICE_NAME"] } : {}),
  });
  // runWithLog makes `log` ambient so seedAdmin's tracedFetch traces the Kratos/Keto seed calls.
  await runWithLog(log, async () => {
    if (ensureJwks(env["JWKS_FILE"] ?? "/etc/config/kratos/tokenizer/jwks.json")) log.info("generated a JWKS signing key");

    // Seed `admin` (or ADMIN_ROLES) + every discovered plugin's declared permission tokens, so the
    // shipped example — and any dropped-in plugin — works for the demo admin without a host edit.
    const declared = (await discoverPlugins()).flatMap((p) => (p.permissions ?? []).map((d) => d.token));
    const roles = seedRoles(env["ADMIN_ROLES"], declared);
    const email = env["ADMIN_EMAIL"] ?? "admin@plainpages.local";
    const password = env["ADMIN_PASSWORD"] ?? "admin";
    const result = await seedAdmin({
      email,
      fetchImpl: tracedFetch,
      ketoWriteUrl: env["KETO_WRITE_URL"] ?? "http://keto:4467",
      kratosAdminUrl: env["KRATOS_ADMIN_URL"] ?? "http://kratos:4434",
      password,
      roles,
    });
    log.info("admin seeded", { created: result.created, id: result.id, roles: result.roles.join(", ") });
    // The banner is human-facing UX (the first-run "you're ready" block), not a log event — print raw.
    console.log(firstRunBanner({ appUrl: env["APP_URL"] ?? "http://localhost:3000", email, password }));
  });
  await log.end(); // flush any pending OTLP spans/logs before the one-shot exits
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
