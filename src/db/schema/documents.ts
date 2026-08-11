import { sql } from "drizzle-orm";
import { pgTable, pgEnum, timestamp, uuid, text, numeric, date, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { tenantIsolationPolicies } from "./rls-helpers";

// Brief section 6: a second capture pathway exists for non-invoiced spend,
// but every document still enters through one of these two routes.
export const documentSource = pgEnum("document_source", ["email", "manual_upload"]);

// Addendum 2.G: three explicit states for the review UI, not a binary
// success/fail — a "succeeded" extraction can still be confidently wrong,
// which is a different failure mode from the OCR call erroring outright.
export const documentExtractionStatus = pgEnum("document_extraction_status", [
  "pending",
  "succeeded",
  "failed",
  "needs_review",
]);

// Captured source documents (invoices, receipts, ...) — the OCR-extracted
// fields here are proposals for a human to confirm/correct in the approval
// queue, never applied directly to a cost_transaction unchecked (Addendum
// 1.A / 2.G: the review UI always shows the document alongside editable
// fields, never a bare data table).
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    // Object storage key (S3, per Addendum 2.N) — null until real storage
    // is wired up; local dev can leave this unset and keep bytes elsewhere.
    storageKey: text("storage_key"),
    receivedVia: documentSource("received_via").notNull(),
    extractionStatus: documentExtractionStatus("extraction_status").notNull().default("pending"),
    extractedVendorName: text("extracted_vendor_name"),
    extractedPoNumber: text("extracted_po_number"),
    extractedAmount: numeric("extracted_amount", { precision: 14, scale: 2 }),
    extractedInvoiceDate: date("extracted_invoice_date"),
    // Overall confidence for this extraction (0-1) — drives the
    // confidence-based routing at Mid tier (Addendum 1.A); Core tier still
    // reviews everything regardless of this value.
    extractedConfidence: numeric("extracted_confidence", { precision: 4, scale: 3 }),
    // Full raw provider response — kept verbatim per the brief's note on
    // logging OCR output alongside the human's final decision, groundwork
    // for the phase-2 AI cost-code-suggestion feature (Addendum 2.G).
    rawExtraction: jsonb("raw_extraction"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => tenantIsolationPolicies(table.tenantId, "documents"),
).enableRLS();
