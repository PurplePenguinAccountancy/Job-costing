import { sql } from "drizzle-orm";
import { pgTable, timestamp, uuid, text, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { tenantIsolationPolicies } from "./rls-helpers";
import { costType } from "./cost-type-accounts";

// Client-configurable chart of accounts — not a fixed global taxonomy.
// Country-specific compliance logic (CIS, VAT/DRC) deliberately lives
// outside this table, in a separate service layer, per the brief's
// international-expansion prep note.
//
// Addendum 2.B: cost codes stay granular and internal (this is the
// fine-grained unit job costing is done in) but each one carries a
// costType so it can roll up many-to-one onto the client's few Xero Cost
// of Sales accounts (see cost-type-accounts.ts) — the coarse Xero-facing
// bucket, not a 1:1 account per cost code.
export const costCodes = pgTable(
  "cost_codes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    costType: costType("cost_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("cost_codes_tenant_code_unique").on(table.tenantId, table.code),
    ...tenantIsolationPolicies(table.tenantId, "cost_codes"),
  ],
).enableRLS();
