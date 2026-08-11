import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  timestamp,
  uuid,
  numeric,
  text,
  date,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { jobs } from "./jobs";
import { costCodes } from "./cost-codes";
import { users } from "./users";
import { purchaseOrders } from "./purchase-orders";
import { documents } from "./documents";
import { tenantIsolationPolicies } from "./rls-helpers";

// Committed (PO raised, not yet invoiced) vs actual (invoiced/paid) — kept
// distinct to support 3-way matching (PO vs delivery vs invoice), per the
// brief. Postable on ANY job node, not just leaves.
export const costTransactionType = pgEnum("cost_transaction_type", [
  "committed",
  "actual",
]);

// Addendum 1.A: nothing may post to Xero unchecked, on any of the three
// entry points (invoice capture, direct/bank spend, subcontractor
// allocation) — core for every tier, not a mid/premium upsell. This status
// is what a future approval UI drives; existing here from day one so it
// never has to be retrofitted onto already-live transactions.
export const costTransactionApprovalStatus = pgEnum("cost_transaction_approval_status", [
  "draft",
  "pending_approval",
  "approved",
  "posted",
]);

// Where this transaction originated — kept generic (not a fixed enum of
// today's known sources) per the brief's note on the shared split-allocation
// component: a future external stock feed, or any other producer, should be
// "just another source" rather than a schema change.
export const costTransactionSourceType = pgEnum("cost_transaction_source_type", [
  "bill",
  "bank_transaction",
  "manual_journal",
  "subcontractor_invoice",
  "labour_allocation",
  "other",
]);

export const costTransactions = pgTable(
  "cost_transactions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => costCodes.id, { onDelete: "restrict" }),
    type: costTransactionType("type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    // The PO this transaction fulfils/relates to, if any — links a
    // committed transaction to the PO it was raised for, and an actual
    // transaction to the PO its invoice matched against (3-way match).
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, {
      onDelete: "set null",
    }),
    // The source document backing this transaction (Addendum 1.A/2.G) —
    // this is what gets pushed as the Xero attachment, replacing any
    // placeholder content once the capture pipeline actually produces one.
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    approvalStatus: costTransactionApprovalStatus("approval_status")
      .notNull()
      .default("draft"),
    sourceType: costTransactionSourceType("source_type").notNull(),
    // Free-form pointer to whatever produced this row (a bill ID, a bank
    // feed line, a future external stock-system record, ...). Deliberately
    // untyped/unconstrained — see sourceType comment above.
    sourceReference: text("source_reference"),
    // Populated once actually synced to Xero (bill ID / bank txn ID / etc).
    // Null until posted — this is what future reconciliation checks join on.
    xeroReference: text("xero_reference"),
    description: text("description"),
    transactionDate: date("transaction_date").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => tenantIsolationPolicies(table.tenantId, "cost_transactions"),
).enableRLS();
