// Per-plugin Postgres storage: the naming, credential and DDL rules (README → Plugin storage).
// Pure — the connecting half lives in storage-provisioning.ts, so `web` never loads a driver.

import { createHmac } from "node:crypto";
import type { Plugin } from "./plugin.ts";

// Database and role share one name, so reconnecting needs nothing looked up. The prefix also keeps
// a plugin id from ever naming an Ory database.
export const NAME_PREFIX = "plugin_";

// Postgres truncates an identifier at 63 bytes, which would silently collide two long ids.
export const MAX_STORAGE_PLUGIN_ID = 63 - NAME_PREFIX.length;

// `url` pre-assembles the other fields as a DSN, which most drivers take directly.
export interface StorageCredentials {
  database: string;
  host: string;
  password: string;
  port: number;
  url: string;
  user: string;
}

export function storageName(pluginId: string): string {
  return `${NAME_PREFIX}${pluginId}`;
}

export function isValidStoragePluginId(pluginId: string): boolean {
  return pluginId.length <= MAX_STORAGE_PLUGIN_ID;
}

export function storagePluginIds(plugins: Plugin[]): string[] {
  return plugins.filter((plugin) => plugin.storage).map((plugin) => plugin.id);
}

// Derived, never stored — which is what keeps the host free of state it would have to persist.
export function derivePassword(secret: string, pluginId: string): string {
  return createHmac("sha256", secret).update(pluginId).digest("base64url");
}

// `baseUrl` names the server and its connection parameters, and carries no credentials of its own.
export function buildCredentials(baseUrl: string, pluginId: string, secret: string): StorageCredentials {
  const name = storageName(pluginId);
  const password = derivePassword(secret, pluginId);
  const url = new URL(baseUrl);
  url.username = name;
  url.password = password;
  url.pathname = `/${name}`;
  return { database: name, host: url.hostname, password, port: Number(url.port) || 5432, url: url.href, user: name };
}

// CREATE ROLE/DATABASE bind no parameters, so the name and password are quoted into the statement.
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

// A database this host provisioned once and no installed plugin claims any more. Nothing drops it,
// so naming it is the only way an operator finds it again.
export function orphanNames(existing: string[], provisioned: string[]): string[] {
  return existing.filter((name) => name.startsWith(NAME_PREFIX) && !provisioned.includes(name)).sort();
}

export interface ProvisionPlan {
  connectionLimit: number;
  databaseExists: boolean;
  name: string;
  password: string;
  roleExists: boolean;
}

// One plugin's full plan, in order. Both role branches state the same attributes, so every boot
// re-asserts them: a privilege granted by hand out of band does not survive silently.
export function provisionSql(plan: ProvisionPlan): string[] {
  if (!Number.isSafeInteger(plan.connectionLimit)) {
    throw new Error(`storage: connectionLimit must be an integer, got ${plan.connectionLimit}`); // interpolated unquoted
  }
  const identifier = quoteIdentifier(plan.name);
  // NOSUPERUSER/NOCREATEDB/NOCREATEROLE: a plugin owns its own database and nothing beyond it.
  // The limit bounds one plugin's pools so they cannot starve Ory, which shares this server.
  const attributes = `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT ${plan.connectionLimit} PASSWORD ${quoteLiteral(plan.password)}`;
  return [
    plan.roleExists ? `ALTER ROLE ${identifier} WITH ${attributes}` : `CREATE ROLE ${identifier} ${attributes}`,
    // CREATE DATABASE ... OWNER needs SET ROLE on the owner, and PG16+ gives a CREATEROLE account
    // ADMIN but *not* SET on the roles it creates — so it grants itself membership first. A
    // superuser could skip this; issuing it anyway is what keeps a least-privilege account working.
    ...(plan.databaseExists ? [] : [`GRANT ${identifier} TO CURRENT_USER`, `CREATE DATABASE ${identifier} OWNER ${identifier}`]),
    `REVOKE ALL ON DATABASE ${identifier} FROM PUBLIC`,
    `GRANT ALL PRIVILEGES ON DATABASE ${identifier} TO ${identifier}`,
  ];
}
