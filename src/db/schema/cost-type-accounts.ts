import { sql } from "drizzle-orm";
import { pgTable, pgEnum, timestamp, uuid, text, boolean, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { tenantIsolationPolicies } from "./rls-helpers";

// Addendum 2.A/2.B: Xero tracking categories are not used for job identity
// at all. Every transaction posts to the client's Xero Cost of Sales
// account by cost TYPE only (an aggregate figure) — this table is that
// mapping. One Xero account per cost type per tenant; cost_codes.costType
// (see cost-codes.ts) is the many-to-one link, joined at posting/
// reconciliation time rather than a hard FK, since account mappings are
// set up independently of when cost codes are created.
// Addendum 2.J also names "Labour Rate Variance" as one of the default
// accounts Wayleave sets up — a genuine 5th bucket, not really a "type" of
// cost the way the other four are (no cost_code is ever tagged with it),
// but it needs the exact same tenant->Xero-account mapping machinery, so
// it lives in the same enum/table rather than a parallel one.
export const costType = pgEnum("cost_type", [
  "materials",
  "labour",
  "subcontractor",
  "plant",
  "labour_variance",
]);

// Addendum 2.J: Wayleave creates a default COS account per cost type during
// setup if the client's COA has nothing suitable — isWayleaveManaged flags
// those, so unexpected movement in one that didn't originate from Wayleave
// is itself a reconciliation flag, not a coincidental mismatch.
export const costTypeAccounts = pgTable(
  "cost_type_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    costType: costType("cost_type").notNull(),
    xeroAccountCode: text("xero_account_code").notNull(),
    // Xero's internal AccountID (GUID) — populated once matched/created via
    // the API; the human-facing code above is what's shown in the UI.
    xeroAccountId: text("xero_account_id"),
    isWayleaveManaged: boolean("is_wayleave_managed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("cost_type_accounts_tenant_type_unique").on(table.tenantId, table.costType),
    ...tenantIsolationPolicies(table.tenantId, "cost_type_accounts"),
  ],
).enableRLS();
