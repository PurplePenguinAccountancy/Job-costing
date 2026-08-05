import { sql } from "drizzle-orm";
import { pgTable, pgEnum, timestamp, uuid, numeric } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { jobs } from "./jobs";
import { costCodes } from "./cost-codes";
import { tenantIsolationPolicies } from "./rls-helpers";

export const budgetSource = pgEnum("budget_source", [
  "manual",
  "quote_conversion",
  "import",
]);

// tenant_id is denormalized here (also reachable via job_id -> jobs.tenant_id)
// so the same uniform tenant-isolation RLS policy applies without a join.
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => costCodes.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    source: budgetSource("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => tenantIsolationPolicies(table.tenantId, "budgets"),
).enableRLS();
