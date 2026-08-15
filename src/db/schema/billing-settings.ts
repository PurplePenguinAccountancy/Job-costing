import { pgTable, timestamp, uuid, text, boolean, numeric } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { tenantIsolationPolicies } from "./rls-helpers";

// One row per tenant, same shape/reasoning as labour_settings: a handful of
// milestone-billing switches that need exactly one value per tenant, not a
// per-job or per-transaction setting.
export const billingSettings = pgTable(
  "billing_settings",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Plain Xero account code, same pattern as labour_settings'
    // payrollClearingAccountCode — a sales/revenue account isn't a
    // Wayleave "cost type", so it doesn't belong in cost_type_accounts.
    salesAccountCode: text("sales_account_code"),
    // Addendum 2.9: "provide a toggle to disable this per client, falling
    // back to manual allocation" — default on, since the whole point of the
    // feature is not having to remember to invoice a completed stage.
    autoCreateDraftInvoiceOnComplete: boolean("auto_create_draft_invoice_on_complete").notNull().default(true),
    // Addendum 2.L: client-configurable GP-margin alert tolerance, in
    // percentage points. Suggested default 5.
    gpMarginAlertThresholdPct: numeric("gp_margin_alert_threshold_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("5.00"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => tenantIsolationPolicies(table.tenantId, "billing_settings"),
).enableRLS();
