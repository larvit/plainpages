// The connecting half of plugin storage: runs the DDL storage.ts plans. Imported by bootstrap
// alone — the only process holding superuser credentials, which is why the driver stops here.

import postgres from "postgres";
import { derivePassword, orphanNames, provisionSql, storageName } from "./storage.ts";

export interface ProvisionOptions {
  adminUrl: string; // needs CREATEDB + CREATEROLE, not superuser
  connectionLimit: number;
  pluginIds: string[];
  secret: string;
}

export interface ProvisionResult {
  orphans: string[]; // a plugin_ database no installed plugin claims; reported, never dropped
  provisioned: string[];
}

export async function provisionStorage(options: ProvisionOptions): Promise<ProvisionResult> {
  // Notices are left to surface: a REVOKE the account cannot perform only *warns*, and silencing
  // that would mean reporting a locked-down database that is still open to PUBLIC.
  const sql = postgres(options.adminUrl, { connect_timeout: 10, max: 1 });
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
    const existing = await sql<{ datname: string }[]>`SELECT datname FROM pg_database`;
    return { orphans: orphanNames(existing.map((row) => row.datname), provisioned), provisioned };
  } finally {
    await sql.end({ timeout: 5 }); // a wedged connection would otherwise hang the boot web waits on
  }
}
