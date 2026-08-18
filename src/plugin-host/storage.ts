// Per-plugin Postgres storage (README → Plugin storage). Only bootstrap provisions, because only it
// is given superuser credentials; web derives the same passwords and never sees them.

import { createHmac } from "node:crypto";
import postgres from "postgres";

// Database and role share one name, so reconnecting needs nothing looked up. The prefix also keeps
// a plugin id from ever naming an Ory database.
const NAME_PREFIX = "plugin_";

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

export interface ProvisionState {
  databaseExists: boolean;
  roleExists: boolean;
}

// One plugin's full plan, in order. The password is re-set on every run so rotating the secret needs
// no separate step, and PUBLIC loses CONNECT so no other plugin's role can reach this database.
export function provisionSql(name: string, password: string, state: ProvisionState): string[] {
  const identifier = quoteIdentifier(name);
  const secret = quoteLiteral(password);
  return [
    state.roleExists
      ? `ALTER ROLE ${identifier} WITH LOGIN PASSWORD ${secret}`
      : `CREATE ROLE ${identifier} LOGIN PASSWORD ${secret}`,
    ...(state.databaseExists ? [] : [`CREATE DATABASE ${identifier} OWNER ${identifier}`]),
    `REVOKE ALL ON DATABASE ${identifier} FROM PUBLIC`,
    `GRANT ALL PRIVILEGES ON DATABASE ${identifier} TO ${identifier}`,
  ];
}

export interface ProvisionOptions {
  adminUrl: string; // superuser DSN — the rights to create a database and a role
  pluginIds: string[];
  secret: string;
}

// Idempotent, and it drops nothing: an uninstalled plugin keeps its data until an operator removes
// it deliberately.
export async function provisionStorage(options: ProvisionOptions): Promise<string[]> {
  const sql = postgres(options.adminUrl, { connect_timeout: 10, max: 1, onnotice: () => {} });
  try {
    const names: string[] = [];
    for (const pluginId of options.pluginIds) {
      const name = storageName(pluginId);
      const [role] = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${name}`;
      const [database] = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
      const plan = provisionSql(name, derivePassword(options.secret, pluginId), {
        databaseExists: database !== undefined,
        roleExists: role !== undefined,
      });
      for (const statement of plan) await sql.unsafe(statement); // provisionSql quotes what it interpolates
      names.push(name);
    }
    return names;
  } finally {
    await sql.end();
  }
}
