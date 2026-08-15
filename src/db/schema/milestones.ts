import { sql } from "drizzle-orm";
import { pgTable, pgEnum, timestamp, uuid, text, integer, numeric, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { jobs } from "./jobs";
import { tenantIsolationPolicies } from "./rls-helpers";

// Addendum 2.K: milestone/stage billing, defined at the lowest (leaf) job
// level — enforced in the query layer (a job with children is not a valid
// milestone-schedule target), not here, since "leaf" depends on the rest of
// the tree at insert time.
export const milestoneAllocationType = pgEnum("milestone_allocation_type", ["percentage", "fixed_amount"]);

// pending: not yet done. complete: work finished, not yet invoiced (or
// auto-invoicing is off for this tenant). billed: a Xero draft sales
// invoice exists — see xeroInvoiceId. Payment status is deliberately NOT
// tracked here (Addendum 2.K) — query Xero for that via xeroInvoiceId
// rather than keeping a second copy that can drift out of sync.
export const milestoneStatus = pgEnum("milestone_status", ["pending", "complete", "billed"]);

// One row per milestone. Mirrors Addendum 2.H's allocation_lines
// convention deliberately: expectedTotalAmount (the job's total contract
// value) is repeated on every row for the job rather than split into a
// separate header table — a half-created schedule never silently reads as
// complete just because what's entered so far is internally consistent,
// same reasoning as 2.H.
export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    name: text("name").notNull(),
    allocationType: milestoneAllocationType("allocation_type").notNull(),
    // Percent (0-100) or a fixed £ amount, depending on allocationType.
    value: numeric("value", { precision: 14, scale: 2 }).notNull(),
    expectedTotalAmount: numeric("expected_total_amount", { precision: 14, scale: 2 }).notNull(),
    status: milestoneStatus("status").notNull().default("pending"),
    // Xero's InvoiceID once a draft sales invoice has been created —
    // the sole source of payment/send status, per Addendum 2.K.
    xeroInvoiceId: text("xero_invoice_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    billedAt: timestamp("billed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("milestones_tenant_job_sequence_unique").on(table.tenantId, table.jobId, table.sequence),
    ...tenantIsolationPolicies(table.tenantId, "milestones"),
  ],
).enableRLS();
