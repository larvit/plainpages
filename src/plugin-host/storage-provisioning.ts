// The connecting half of plugin storage: runs the DDL storage.ts plans. Imported by bootstrap
// alone — the only process holding superuser credentials, which is why the driver stops here.

import postgres from "postgres";
import { derivePassword, NAME_PREFIX, orphanNames, provisionSql, quoteIdentifier, storageName } from "./storage.ts";

export interface ProvisionOptions {
  adminUrl: string; // needs CREATEDB + CREATEROLE, not superuser
  connectionLimit: number;
  // Databases to keep closed to PUBLIC on every run. init.sql seeds this for the Ory databases, but
  // it runs once on an empty data dir — an existing volume would keep the default grant forever.
  lockdownDatabases?: string[];
  pluginIds: string[];
  secret: string;
}

export interface ProvisionResult {
  orphans: string[]; // provisioned once, but no installed plugin claims them any more
  provisioned: string[];
}

// Idempotent, and it drops nothing: an uninstalled plugin keeps its data until an operator removes
// it deliberately. Orphans are reported rather than removed, so nobody has to guess they exist.
export async function provisionStorage(options: ProvisionOptions): Promise<ProvisionResult> {
  const sql = postgres(options.adminUrl, { connect_timeout: 10, max: 1, onnotice: () => {} });
  try {
    const provisioned: string[] = [];
    for (const pluginId of options.pluginIds) {
      const name = storageName(pluginId);
      const [role] = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${name}`;
      const [database] = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
      const plan = provisionSql({
        connectionLimit: options.connectionLimit,
        databaseExists: database !== undefined,
        name,
        password: derivePassword(options.secret, pluginId),
        roleExists: role !== undefined,
      });
      for (const statement of plan) await sql.unsafe(statement); // provisionSql quotes what it interpolates
      provisioned.push(name);
    }
    for (const database of options.lockdownDatabases ?? []) {
      await sql.unsafe(`REVOKE CONNECT ON DATABASE ${quoteIdentifier(database)} FROM PUBLIC`);
    }
    const existing = await sql<{ datname: string }[]>`SELECT datname FROM pg_database WHERE starts_with(datname, ${NAME_PREFIX})`;
    return { orphans: orphanNames(existing.map((row) => row.datname), provisioned), provisioned };
  } finally {
    await sql.end();
  }
}
