import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// Always connects as app_user, never as the postgres superuser — RLS
// policies only take effect for a non-owner, non-superuser role.
const client = postgres(process.env.DATABASE_URL);

export const db = drizzle(client, { schema });

/**
 * Every request must run inside this wrapper. It sets the Postgres session
 * variables the RLS policies key off (app.current_tenant_id / app.current_user_id)
 * for the lifetime of one transaction, then executes `fn`. Without this,
 * RLS policies see NULL and every row is denied.
 */
export async function withTenant<T>(
  tenantId: string,
  userId: string | null,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_tenant_id', ${tenantId}, true), set_config('app.current_user_id', ${userId ?? ""}, true)`,
    );
    return fn(tx as unknown as typeof db);
  });
}
