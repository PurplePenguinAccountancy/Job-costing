import { sql, type SQL } from "drizzle-orm";
import { pgPolicy } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { appUser } from "./roles";

/**
 * Standard tenant-isolation policy set, applied to every tenant-owned table
 * (jobs, cost_codes, budgets, cost_transactions, ...). Every one of those
 * tables carries its own tenant_id column (denormalized rather than only
 * reachable via a join) specifically so this single, uniform policy works
 * everywhere — no per-table join logic to get wrong.
 *
 * This is deliberately just tenant scoping for v1. Addendum 1.B's
 * hierarchy-branch-scoped manager visibility is a *stricter* filter layered
 * on top later (e.g. an additional policy checking job ownership/ancestry)
 * — it composes with this one rather than replacing it, so it can be added
 * without touching these tables' existing policies.
 */
export function tenantIsolationPolicies(tenantIdColumn: AnyPgColumn, tableName: string) {
  // NULLIF(..., '') before the cast: an empty-string session variable
  // (e.g. a transiently leaked/unset value under connection reuse) must
  // fail the match, not throw "invalid input syntax for type uuid" and
  // 500 the whole query — a malformed session variable should look like
  // "no tenant selected," never a hard SQL error in a security policy.
  const tenantMatch: SQL = sql`${tenantIdColumn} = nullif(current_setting('app.current_tenant_id', true), '')::uuid`;
  return [
    pgPolicy(`${tableName}_select_within_tenant`, {
      for: "select",
      to: appUser,
      using: tenantMatch,
    }),
    pgPolicy(`${tableName}_insert_within_tenant`, {
      for: "insert",
      to: appUser,
      withCheck: tenantMatch,
    }),
    pgPolicy(`${tableName}_update_within_tenant`, {
      for: "update",
      to: appUser,
      using: tenantMatch,
      withCheck: tenantMatch,
    }),
    pgPolicy(`${tableName}_delete_within_tenant`, {
      for: "delete",
      to: appUser,
      using: tenantMatch,
    }),
  ];
}
