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
    // A real SQL NULL when userId is absent, never an empty string — an
    // empty string is itself a value (and, worse, one that a stale/reused
    // connection could still be carrying from an earlier transaction),
    // where NULL cleanly reads back as NULL via current_setting(...,
    // true) every time. The RLS policies additionally guard against a
    // malformed value with NULLIF(..., '') (see rls-helpers.ts) as a
    // second line of defense, but the fix starts here at the source.
    await tx.execute(
      sql`select set_config('app.current_tenant_id', ${tenantId}, true), set_config('app.current_user_id', ${userId}, true)`,
    );
    return fn(tx as unknown as typeof db);
  });
}

/**
 * The bootstrap case tenant_memberships' RLS policy exists for (see
 * memberships.ts): "which tenants does this signed-in user belong to,"
 * asked before any tenant has been selected yet — so there's no tenantId
 * to set. Deliberately never touches app.current_tenant_id at all (rather
 * than setting it to a placeholder) — current_setting(..., true) then
 * returns NULL instead of throwing an invalid-uuid cast error, and NULL
 * never matches the policy's tenantId branch, leaving only the userId
 * branch in play, which is exactly what this needs.
 */
export async function withUser<T>(userId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}
