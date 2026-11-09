// The one-shot compose service (`node src/auth/bootstrap.ts`) that prepares a stack. It starts once
// Kratos and Keto are healthy, `web` waits for it, and it repeats safely on every `docker compose up`.
// Steps, in the order `main` runs them: write the JWKS signing key if absent, create each storage
// plugin's database and role, then seed the demo admin in Kratos and grant it in Keto every
// discovered plugin's declared permissions (plus ADMIN_PERMISSIONS). Any unexpected upstream error
// fails the run loudly.
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type BootstrapConfig, loadBootstrapConfig, resolvePluginDbConnectionLimit, resolvePluginDbSecret } from "../config.ts";
import { discoverPlugins } from "../plugin-host/discovery.ts";
import { declaredPermissions, isValidPermissionName, type Plugin } from "../plugin-host/plugin.ts";
import { provisionStorage } from "../plugin-host/storage-provisioning.ts";
import { storagePluginIds } from "../plugin-host/storage.ts";
import { generateJwks, type JwkSet } from "./gen-jwks.ts";
import { createKetoClient, type KetoClient } from "./keto-client.ts";
import { createKratosAdmin, type KratosAdmin } from "./kratos-admin.ts";
import { KratosError } from "./kratos-public.ts";
import { createLogger, runWithLog, tracedFetch, type Log } from "../logger.ts";

type Env = Record<string, string | undefined>;

// --- Pure payload builders (the Kratos/Keto request contracts) -----------------------

export function identityPayload(email: string, password: string) {
  return {
    credentials: { password: { config: { password } } }, // cleartext; Kratos hashes it
    schema_id: "default",
    traits: { email, name: { first: "Admin", last: "User" } },
  };
}

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
  keto: KetoClient;
  kratos: KratosAdmin;
  password: string;
  permissions: string[];
}

export interface SeedResult {
  created: boolean;
  id: string;
  permissions: string[];
}

export async function seedAdmin(opts: SeedOptions): Promise<SeedResult> {
  const { created, id } = await createOrFindAdmin(opts.kratos, opts.email, opts.password);

  for (const permission of opts.permissions) {
    try {
      await opts.keto.writeTuple(permissionTuple(id, permission));
    } catch (err) {
      throw new Error(`bootstrap: granting "${permission}" in Keto: ${(err as Error).message}`, { cause: err });
    }
  }

  return { created, id, permissions: opts.permissions };
}

// A Kratos 409 means the admin exists (a re-run), so look its id up by login identifier.
async function createOrFindAdmin(kratos: KratosAdmin, email: string, password: string): Promise<{ created: boolean; id: string }> {
  try {
    return { created: true, id: (await kratos.createIdentity(identityPayload(email, password))).id };
  } catch (err) {
    if (!(err instanceof KratosError) || err.status !== 409) throw new Error(`bootstrap: ${(err as Error).message}`, { cause: err });
  }
  const found = (await kratos.listIdentities({ credentialsIdentifier: email })).identities[0];
  if (!found) throw new Error(`bootstrap: ${email} reported as existing but not found`);
  return { created: false, id: found.id };
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
  const env = { ...process.env }; // snapshot: the storage credentials leave process.env before discovery
  const config = loadBootstrapConfig(env); // first, so a bad setting fails before any step has run
  // Structured like the web app so prod logs stay uniform.
  const log = createLogger({ format: config.logFormat, ...(config.serviceName ? { serviceName: config.serviceName } : {}) });
  // runWithLog makes `log` ambient so the Kratos/Keto clients' tracedFetch traces the seed calls.
  await runWithLog(log, async () => {
    if (ensureJwks(config.jwksFile)) log.info("generated a JWKS signing key");
    // Discovery imports every plugin module — and its dependencies — into *this* process, which holds
    // the credential that may CREATE DATABASE/ROLE. Same move as server.ts, on the stronger secret.
    delete process.env["PLUGIN_DB_ADMIN_URL"];
    delete process.env["PLUGIN_DB_SECRET"];
    const plugins = await discoverPlugins();
    await provisionPluginStorage(env, plugins, log);
    await seedAdminAndPermissions(config, plugins, log);
  });
  await log.end(); // flush any pending OTLP spans/logs before the one-shot exits
}

// A database and login role for each plugin that asked for one. It happens here because bootstrap
// holds the stack's only provisioning credentials — web derives the same password and connects as
// the plugin's own role.
export async function provisionPluginStorage(env: Env, plugins: Plugin[], log: Log, provision = provisionStorage): Promise<void> {
  const ids = storagePluginIds(plugins);
  const adminUrl = env["PLUGIN_DB_ADMIN_URL"];
  // Still connect with nothing to provision, as long as storage is configured: uninstalling the
  // last storage plugin is exactly when an orphaned database needs naming.
  if (ids.length === 0 && !adminUrl) return;
  if (!adminUrl) throw new Error(`bootstrap: PLUGIN_DB_ADMIN_URL must be set — these plugins declare storage: ${ids.join(", ")}`);
  // Provisioned here, connected to from web: a different server means the role is created in one
  // place and looked for in another, surfacing inside a plugin as "password authentication failed".
  // Warned, not refused — web reaching a pooler that cannot run CREATE DATABASE is a legitimate split.
  const mismatch = serverMismatch(adminUrl, env["PLUGIN_DB_URL"]);
  if (mismatch) log.warn("PLUGIN_DB_ADMIN_URL and PLUGIN_DB_URL name different servers", { servers: mismatch });
  const result = await provision({
    adminUrl,
    connectionLimit: resolvePluginDbConnectionLimit(env),
    pluginIds: ids,
    secret: resolvePluginDbSecret(env),
  });
  if (result.provisioned.length > 0) log.info("plugin storage provisioned", { databases: result.provisioned.join(", ") });
  // Never dropped, so an uninstalled plugin's data outlives it — say so, or nobody can find it.
  if (result.orphans.length > 0) {
    log.warn("plugin databases no installed plugin claims", { databases: result.orphans.join(", ") });
  }
}

// Describes the disagreement, or null when they agree (or when web's URL is unset — that is web's
// own boot error to raise, naming the plugin that wanted storage).
export function serverMismatch(adminUrl: string, webUrl: string | undefined): string | null {
  if (!webUrl) return null;
  const [admin, web] = [safeHostPort(adminUrl), safeHostPort(webUrl)];
  if (admin === null || web === null || admin === web) return null; // a malformed URL fails in config.ts
  return `${admin} vs ${web}`;
}

function safeHostPort(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}`;
  } catch {
    return null;
  }
}

// Seed every discovered plugin's declared permission names (plus any ADMIN_PERMISSIONS), so the
// shipped example — and any dropped-in plugin — works for the demo admin without a host edit.
async function seedAdminAndPermissions(config: BootstrapConfig, plugins: Plugin[], log: Log): Promise<void> {
  const declared = declaredPermissions(plugins).map((decl) => decl.name);
  const { ignored, permissions } = seedPermissions(config.adminPermissions, declared);
  if (ignored.length > 0) {
    log.warn("ignoring ADMIN_PERMISSIONS entries that are not <resource>:<action>", { ignored: ignored.join(", ") });
  }
  const result = await seedAdmin({
    email: config.adminEmail,
    keto: createKetoClient({ fetchImpl: tracedFetch, readUrl: config.ketoReadUrl, writeUrl: config.ketoWriteUrl }),
    kratos: createKratosAdmin({ baseUrl: config.kratosAdminUrl, fetchImpl: tracedFetch }),
    password: config.adminPassword,
    permissions,
  });
  log.info("admin seeded", { created: result.created, id: result.id, permissions: result.permissions.join(", ") });
  // The banner is human-facing UX (the first-run "you're ready" block), not a log event — print raw.
  console.log(firstRunBanner({ appUrl: config.appUrl, email: config.adminEmail, password: config.adminPassword }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
