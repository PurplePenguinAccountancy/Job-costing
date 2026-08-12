import { sql } from "drizzle-orm";
import { pgTable, pgEnum, timestamp, uuid, numeric, date, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { employees } from "./employees";
import { tenantIsolationPolicies } from "./rls-helpers";

// Addendum 2.I: both must coexist per brief section 8 — actual costing
// (rate recalculated monthly from real payroll data) and standard costing
// (a fixed predetermined rate) are tracked independently, never a single
// rate track, since both need to exist even for a client operating under
// just one of them (standard-costing clients still need actual payroll
// totals captured to compute the variance).
export const employeeRateType = pgEnum("employee_rate_type", ["actual", "standard"]);

// effectiveFrom-versioned: a rate change never silently restates
// already-posted months (Addendum 2.I) — insert a new row for a new rate,
// never update an old one's hourlyRate in place.
export const employeeRates = pgTable(
  "employee_rates",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    rateType: employeeRateType("rate_type").notNull(),
    // Fully-loaded cost to the business — base pay + employer NI + pension
    // + other on-costs (brief section 8) — per hour.
    hourlyRate: numeric("hourly_rate", { precision: 10, scale: 4 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("employee_rates_employee_type_effective_unique").on(
      table.employeeId,
      table.rateType,
      table.effectiveFrom,
    ),
    ...tenantIsolationPolicies(table.tenantId, "employee_rates"),
  ],
).enableRLS();
