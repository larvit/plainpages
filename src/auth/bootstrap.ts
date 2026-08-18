// One-command bootstrap (the MVP bar). One-shot compose service: runs after
// kratos+keto are healthy (web waits on it), idempotent on every `docker compose up`:
//   1. generate the JWKS signing key if absent (committed dev key makes this a safety net);
//   2. seed a demo admin (admin@plainpages.local / admin) in Kratos;
//   3. grant it its permissions in Keto so menu/permission checks resolve out of the box — every
//      discovered plugin's declared permission names (plus any ADMIN_PERMISSIONS), so a dropped-in
//      plugin is usable by the demo admin with no host config edit (the host stays plugin-agnostic).
// Then prints a first-run banner; fails loud on any unexpected upstream error.
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolvePluginDbConnectionLimit, resolvePluginDbSecret } from "../config.ts";
import { discoverPlugins } from "../plugin-host/discovery.ts";
import { declaredPermissions, isValidPermissionName, type Plugin } from "../plugin-host/plugin.ts";
import { provisionStorage } from "../plugin-host/storage-provisioning.ts";
import { storagePluginIds } from "../plugin-host/storage.ts";
import { generateJwks, type JwkSet } from "./gen-jwks.ts";
import { createLogger, runWithLog, tracedFetch, type Log } from "../logger.ts";

type Env = Record<string, string | undefined>;

// Kept closed to PUBLIC on every boot, not just on a fresh volume — a plugin role would otherwise
// reach the auth plane's catalogs and connection slots (ory/postgres/init/init.sql seeds the same).
const ORY_DATABASES = ["hydra", "keto", "kratos"];

// --- Pure payload builders (the Kratos/Keto request contracts) -----------------------

export function identityPayload(email: string, password: string) {
  return {
    credentials: { password: { config: { password } } }, // cleartext; Kratos hashes it
    schema_id: "default",
    traits: { email, name: { first: "Admin", last: "User" } },
  };
}

// Coarse-permission grant: `Permission:<permission>#members@user:<id>`. Subject ids are `user:<kratos-id>`
// (namespaces.keto.ts) — the source of truth the login flow projects into the JWT permissions.
export function permissionTuple(userId: string, permission: string) {
  return { namespace: "Permission", object: permission, relation: "granted", subject_id: `user:${userId}` };
}

// ADMIN_PERMISSIONS (empty by default) unioned with every discovered plugin's declared names, so
// the host names no plugin yet a dropped-in one is seeded out of the box.
//
// ADMIN_PERMISSIONS is the one place an operator names a permission by hand, so it is held to the
// same `<resource>:<action>` rule as a manifest — but *dropped with a warning*, never fatal:
// fail-loud belongs at the manifest boundary where a developer authored the mistake, whereas this
// is operator env and bootstrap gates `web`, so the whole stack must not refuse to start over a
// stale variable. The name it would have written gates nothing anyway.
export function seedPermissions(adminPermissionsEnv: string | undefined, declaredNames: string[]): { ignored: string[]; permissions: string[] } {
  const clean = (xs: string[]): string[] => xs.map((r) => r.trim()).filter(Boolean);
  const configured = clean((adminPermissionsEnv ?? "").split(","));
  const ignored = configured.filter((name) => !isValidPermissionName(name));
  const valid = configured.filter((name) => isValidPermissionName(name));
  return { ignored, permissions: [...new Set([...valid, ...clean(declaredNames)])] };
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
  permissions: string[];
}

export interface SeedResult {
  created: boolean;
  id: string;
  permissions: string[];
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

  // Grant each permission in Keto. PUT is idempotent — re-running just re-asserts the tuple.
  for (const permission of opts.permissions) {
    const grant = await http(`${opts.ketoWriteUrl}/admin/relation-tuples`, {
      body: JSON.stringify(permissionTuple(id, permission)),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    if (!grant.ok) throw new Error(`bootstrap: Keto grant permission "${permission}" failed (${grant.status}): ${await grant.text()}`);
  }

  return { created, id, permissions: opts.permissions };
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
    `│ Plainpages is ready — sign in at ${opts.appUrl}`,
    `│   email:    ${opts.email}`,
    `│   password: ${opts.password}`,
    `│ ⚠ Demo admin credentials — change them before production.`,
    `└${rule}`,
  ].join("\n");
}

// --- CLI (the bootstrap container entrypoint) ----------------------------------------

async function main() {
  const env = process.env;
  // Structured like the web app so prod logs stay uniform; honour LOG_FORMAT/SERVICE_NAME.
  const log = createLogger({
    format: env["LOG_FORMAT"] === "json" ? "json" : "text",
    ...(env["SERVICE_NAME"] ? { serviceName: env["SERVICE_NAME"] } : {}),
  });
  // runWithLog makes `log` ambient so seedAdmin's tracedFetch traces the Kratos/Keto seed calls.
  await runWithLog(log, async () => {
    if (ensureJwks(env["JWKS_FILE"] ?? "/etc/config/kratos/tokenizer/jwks.json")) log.info("generated a JWKS signing key");
    const plugins = await discoverPlugins();
    await provisionPluginStorage(env, plugins, log);
    await seedAdminAndPermissions(env, plugins, log);
  });
  await log.end(); // flush any pending OTLP spans/logs before the one-shot exits
}

// A database and login role for each plugin that asked for one. It happens here because bootstrap
// holds the stack's only provisioning credentials — web derives the same password and connects as
// the plugin's own role.
async function provisionPluginStorage(env: Env, plugins: Plugin[], log: Log): Promise<void> {
  const ids = storagePluginIds(plugins);
  const adminUrl = env["PLUGIN_DB_ADMIN_URL"];
  // Still connect with nothing to provision, as long as storage is configured: uninstalling the
  // last storage plugin is exactly when an orphaned database needs naming.
  if (ids.length === 0 && !adminUrl) return;
  if (!adminUrl) throw new Error(`bootstrap: PLUGIN_DB_ADMIN_URL must be set — these plugins declare storage: ${ids.join(", ")}`);
  const result = await provisionStorage({
    adminUrl,
    connectionLimit: resolvePluginDbConnectionLimit(env),
    lockdownDatabases: ORY_DATABASES,
    pluginIds: ids,
    secret: resolvePluginDbSecret(env),
  });
  if (result.provisioned.length > 0) log.info("plugin storage provisioned", { databases: result.provisioned.join(", ") });
  // Never dropped, so an uninstalled plugin's data outlives it — say so, or nobody can find it.
  if (result.orphans.length > 0) {
    log.warn("plugin databases no installed plugin claims", { databases: result.orphans.join(", ") });
  }
}

// Seed every discovered plugin's declared permission names (plus any ADMIN_PERMISSIONS), so the
// shipped example — and any dropped-in plugin — works for the demo admin without a host edit.
async function seedAdminAndPermissions(env: Env, plugins: Plugin[], log: Log): Promise<void> {
  const declared = declaredPermissions(plugins).map((decl) => decl.name);
  const { ignored, permissions } = seedPermissions(env["ADMIN_PERMISSIONS"], declared);
  if (ignored.length > 0) {
    log.warn("ignoring ADMIN_PERMISSIONS entries that are not <resource>:<action>", { ignored: ignored.join(", ") });
  }
  const email = env["ADMIN_EMAIL"] ?? "admin@plainpages.local";
  const password = env["ADMIN_PASSWORD"] ?? "admin";
  const result = await seedAdmin({
    email,
    fetchImpl: tracedFetch,
    ketoWriteUrl: env["KETO_WRITE_URL"] ?? "http://keto:4467",
    kratosAdminUrl: env["KRATOS_ADMIN_URL"] ?? "http://kratos:4434",
    password,
    permissions,
  });
  log.info("admin seeded", { created: result.created, id: result.id, permissions: result.permissions.join(", ") });
  // The banner is human-facing UX (the first-run "you're ready" block), not a log event — print raw.
  console.log(firstRunBanner({ appUrl: env["APP_URL"] ?? "http://localhost:3000", email, password }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
