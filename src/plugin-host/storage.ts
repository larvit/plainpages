// Per-plugin Postgres storage: the naming, credential and DDL rules (README → Plugin storage).
// Pure — the connecting half lives in storage-provisioning.ts, so `web` never loads a driver.

import { createHmac } from "node:crypto";
import type { Plugin } from "./plugin.ts";

// Database and role share one name, so reconnecting needs nothing looked up. The prefix also keeps
// a plugin id from ever naming an Ory database.
export const NAME_PREFIX = "plugin_";

// Postgres truncates an identifier at 63 bytes, which would silently collide two long ids.
export const MAX_STORAGE_PLUGIN_ID_LENGTH = 63 - NAME_PREFIX.length;

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
  return Buffer.byteLength(pluginId) <= MAX_STORAGE_PLUGIN_ID_LENGTH; // Postgres counts bytes, not characters
}

export function storagePluginIds(plugins: Plugin[]): string[] {
  return plugins.filter((plugin) => plugin.storage).map((plugin) => plugin.id);
}

// Derived, never stored — which is what keeps the host free of state it would have to persist.
// Whoever holds the secret holds every plugin's database.
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

export function provisionSql(plan: ProvisionPlan): string[] {
  // Interpolated unquoted, and Postgres reads a negative limit as "unlimited" — the opposite of the point.
  if (!Number.isSafeInteger(plan.connectionLimit) || plan.connectionLimit < 1) {
    throw new Error(`storage: connectionLimit must be a positive integer, got ${plan.connectionLimit}`);
  }
  const identifier = quoteIdentifier(plan.name);
  // No NOSUPERUSER: only a superuser may name SUPERUSER in an ALTER, so re-asserting it would fail
  // every boot after the first under the CREATEDB+CREATEROLE account the README recommends. CREATE
  // defaults to NOSUPERUSER and a non-superuser cannot grant it, so nothing is given up.
  const attributes = `LOGIN NOCREATEDB NOCREATEROLE CONNECTION LIMIT ${plan.connectionLimit} PASSWORD ${quoteLiteral(plan.password)}`;
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
