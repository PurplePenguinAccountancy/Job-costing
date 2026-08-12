import { sql } from "drizzle-orm";
import { pgTable, pgEnum, timestamp, uuid, text, numeric, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { jobs } from "./jobs";
import { costCodes } from "./cost-codes";
import { costTransactions } from "./cost-transactions";
import { documents } from "./documents";
import { tenantIsolationPolicies } from "./rls-helpers";

// Addendum 2.H: the same underlying problem — split an amount across jobs
// — shows up in three places. One table, one validation rule, used by all
// three rather than building it three times.
export const allocationSourceContext = pgEnum("allocation_source_context", [
  "subcontractor_invoice",
  "direct_payment",
  "material_stock",
]);

export const allocationType = pgEnum("allocation_type", ["percentage", "fixed_amount", "time_based"]);

// Client sets a default allocation method per context (not one tenant-wide
// default) — still overridable per instance. Absence of a row here just
// means "no default configured yet," not an error.
export const allocationDefaults = pgTable(
  "allocation_defaults",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceContext: allocationSourceContext("source_context").notNull(),
    defaultAllocationType: allocationType("default_allocation_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("allocation_defaults_tenant_context_unique").on(table.tenantId, table.sourceContext),
    ...tenantIsolationPolicies(table.tenantId, "allocation_defaults"),
  ],
).enableRLS();

// One row per (job, source line) split. Multiple rows sharing the same
// sourceLineReference are "the same split" — that shared reference is the
// grouping key, not a separate batch table (per Addendum 2.H's own field
// list: source_line_reference is what identifies which document/invoice
// *line* — not the parent transaction — a set of allocation lines belongs
// to, since one multi-line document can split different lines differently).
export const allocationLines = pgTable(
  "allocation_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceContext: allocationSourceContext("source_context").notNull(),
    // Free-form grouping key (e.g. `${documentId}:${lineIndex}`, or a
    // generated batch id for a direct payment with no document line to
    // anchor to) — deliberately not a foreign key to any one entity, since
    // "source" varies by context.
    sourceLineReference: text("source_line_reference").notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => costCodes.id, { onDelete: "restrict" }),
    allocationType: allocationType("allocation_type").notNull(),
    // The entered percentage (0-100), fixed amount, or hours — meaning
    // depends on allocationType.
    value: numeric("value", { precision: 14, scale: 4 }).notNull(),
    // Captured from the source document once, shared across every line in
    // the batch — lines validate against this fixed expectation, never
    // against their own running sum (a half-finished split must never
    // silently read as complete just because what's entered so far is
    // internally consistent).
    expectedTotalAmount: numeric("expected_total_amount", { precision: 14, scale: 2 }).notNull(),
    // Only meaningful for allocationType = 'time_based'.
    expectedTotalHours: numeric("expected_total_hours", { precision: 10, scale: 2 }),
    // Set once this line has been turned into a real cost_transaction —
    // null until the whole batch validates as complete (Addendum 2.H: no
    // partial splits ever count as done).
    resultingCostTransactionId: uuid("resulting_cost_transaction_id").references(
      () => costTransactions.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => tenantIsolationPolicies(table.tenantId, "allocation_lines"),
).enableRLS();
