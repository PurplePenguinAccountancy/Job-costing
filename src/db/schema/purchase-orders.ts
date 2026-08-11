import { sql } from "drizzle-orm";
import { pgTable, pgEnum, timestamp, uuid, text, numeric, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { jobs } from "./jobs";
import { costCodes } from "./cost-codes";
import { tenantIsolationPolicies } from "./rls-helpers";

// "received" is the status the accruals/GRNI prep note (brief section 12)
// already flags as needed for the 3-way match — timestamped properly here
// from the start so phase-2 accruals has nothing to retrofit.
export const purchaseOrderStatus = pgEnum("purchase_order_status", [
  "open",
  "partially_invoiced",
  "closed",
]);

// The actual PO record incoming invoices match against (brief section 6,
// step 3: "extracted PO number against the job costing module's own PO
// records"). A "committed" cost_transaction (section 3) represents the
// cost of a PO; this table is the PO itself — the thing with a number that
// a real-world document can reference.
export const purchaseOrders = pgTable(
  "purchase_orders",
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
    poNumber: text("po_number").notNull(),
    // Match key — see src/lib/po-number.ts. Kept as a real column (not
    // recomputed per query) so lookups can use a plain unique index.
    normalizedPoNumber: text("normalized_po_number").notNull(),
    vendorName: text("vendor_name").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    status: purchaseOrderStatus("status").notNull().default("open"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("purchase_orders_tenant_normalized_po_unique").on(table.tenantId, table.normalizedPoNumber),
    ...tenantIsolationPolicies(table.tenantId, "purchase_orders"),
  ],
).enableRLS();
