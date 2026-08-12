import { sql } from "drizzle-orm";
import { pgTable, pgEnum, timestamp, uuid, text, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { tenantIsolationPolicies } from "./rls-helpers";

export const employeeStatus = pgEnum("employee_status", ["active", "inactive"]);

// Direct labour costing only (brief section 8) — no time-clock, no
// scheduling, no HR data beyond what costing needs. employeeIdentifier is
// the match key the fixed hours-import template uses (Addendum 2.I).
export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeIdentifier: text("employee_identifier").notNull(),
    name: text("name").notNull(),
    status: employeeStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("employees_tenant_identifier_unique").on(table.tenantId, table.employeeIdentifier),
    ...tenantIsolationPolicies(table.tenantId, "employees"),
  ],
).enableRLS();
