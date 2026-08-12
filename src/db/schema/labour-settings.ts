import { pgTable, timestamp, uuid, text } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { costCodes } from "./cost-codes";
import { jobs } from "./jobs";
import { employeeRateType } from "./employee-rates";
import { tenantIsolationPolicies } from "./rls-helpers";

// One costing method per tenant (brief section 8) — not mixed per
// transaction. Also pins which cost code auto-generated labour/variance
// transactions use, and which job is the non-project/overhead bucket —
// a tenant's cost-code and job lists may have several candidates, but the
// automated posting needs exactly one target for each.
export const labourSettings = pgTable(
  "labour_settings",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    costingMethod: employeeRateType("costing_method").notNull().default("standard"),
    defaultLabourCostCodeId: uuid("default_labour_cost_code_id").references(() => costCodes.id, {
      onDelete: "set null",
    }),
    defaultVarianceCostCodeId: uuid("default_variance_cost_code_id").references(() => costCodes.id, {
      onDelete: "set null",
    }),
    overheadJobId: uuid("overhead_job_id").references(() => jobs.id, { onDelete: "set null" }),
    // Where the external payroll provider's own journal actually posts raw
    // payroll cost in Xero — genuinely distinct from the job-costed labour
    // account above. Wayleave's reclassification journal moves money OUT
    // of this account into the job-costed + variance accounts, so after
    // posting it nets to zero for the period. A plain account-code
    // reference (not a cost_type_accounts mapping) since it isn't a
    // Wayleave "cost type" — Wayleave never books anything TO it, only
    // reclassifies away FROM it. Null until confirmed against the pilot
    // client's real chart of accounts.
    payrollClearingAccountCode: text("payroll_clearing_account_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => tenantIsolationPolicies(table.tenantId, "labour_settings"),
).enableRLS();
