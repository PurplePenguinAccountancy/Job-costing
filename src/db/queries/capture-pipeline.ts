import { randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { db, withTenant } from "@/db";
import { documents, costTransactions } from "@/db/schema";
import { getDocumentExtractionAdapter, type ExtractedInvoice } from "@/lib/ocr";
import { getStorageAdapter } from "@/lib/storage";
import { matchPurchaseOrder } from "./po-matching";

const LOW_CONFIDENCE_THRESHOLD = 0.7;

export type IngestResult = {
  documentId: string;
  costTransactionId: string | null;
  matchedPo: boolean;
  /** Set when this document was flagged as a possible re-submission of an
   * earlier one — the id it possibly duplicates. Ingestion always still
   * records the document; it just withholds transaction creation. */
  possibleDuplicateOfDocumentId: string | null;
};

type DuplicateMatch = { id: string; filename: string; createdAt: Date };

/**
 * Duplicate-invoice check (checks both already-posted and still-pending
 * documents — nothing here filters on downstream transaction/approval
 * status, so "processed" and "yet to be processed" invoices are covered by
 * the same query). Two independent signals, either is enough to flag:
 * same vendor+amount+date, or same PO+amount. Both require an extracted
 * amount — there's nothing to compare without one.
 */
async function findPotentialDuplicate(
  tx: typeof db,
  tenantId: string,
  extraction: ExtractedInvoice,
): Promise<DuplicateMatch | null> {
  if (extraction.totalAmount === null) return null;
  const amount = extraction.totalAmount.toFixed(2);

  const signals = [];
  if (extraction.vendorName && extraction.invoiceDate) {
    signals.push(
      and(
        eq(documents.extractedVendorName, extraction.vendorName),
        eq(documents.extractedAmount, amount),
        eq(documents.extractedInvoiceDate, extraction.invoiceDate),
      ),
    );
  }
  if (extraction.poNumber) {
    signals.push(and(eq(documents.extractedPoNumber, extraction.poNumber), eq(documents.extractedAmount, amount)));
  }
  if (signals.length === 0) return null;

  const [match] = await tx
    .select({ id: documents.id, filename: documents.filename, createdAt: documents.createdAt })
    .from(documents)
    .where(and(eq(documents.tenantId, tenantId), or(...signals)))
    .orderBy(desc(documents.createdAt))
    .limit(1);
  return match ?? null;
}

/**
 * Brief section 6, steps 1–4: extraction → duplicate check → PO matching →
 * allocation. Every outcome — matched, unmatched, low-confidence, possible
 * duplicate, extraction failure — still produces a document + (where
 * there's enough to act on, and it isn't a likely duplicate) a
 * cost_transaction sitting in `pending_approval`. Addendum 2.G: all three
 * extraction states enter the same review queue, nothing silently drops.
 * Approval itself (Addendum 1.A) happens later, in the approval queue —
 * never here.
 */
export async function ingestDocument(params: {
  tenantId: string;
  filename: string;
  mimeType: string;
  fileBuffer: Buffer;
  receivedVia: "email" | "manual_upload";
}): Promise<IngestResult> {
  const adapter = getDocumentExtractionAdapter();
  const extraction = await adapter.extractInvoice(params.fileBuffer, params.mimeType);

  const po = extraction.poNumber ? await matchPurchaseOrder(params.tenantId, extraction.poNumber) : null;

  const hasEnoughToFileAsTransaction = po !== null && extraction.totalAmount !== null;
  // A missing vendor name doesn't make a document "failed" when it matched
  // a PO — the PO itself already carries the vendor identity. Only flag as
  // failed when there's nothing usable at all (no amount); flag as
  // needs_review when the vendor can't be identified from either source, or
  // confidence is low.
  const canIdentifyVendor = Boolean(extraction.vendorName) || po !== null;
  const extractionStatus =
    extraction.totalAmount === null
      ? "failed"
      : !canIdentifyVendor || extraction.confidence < LOW_CONFIDENCE_THRESHOLD
        ? "needs_review"
        : "succeeded";

  // Persist the real bytes before recording the document — if storage
  // fails, the ingestion should fail loudly rather than record a document
  // that claims to have a backing file it doesn't.
  const storage = getStorageAdapter();
  const storageKey = `${params.tenantId}/${randomUUID()}-${params.filename}`;
  await storage.store(storageKey, params.fileBuffer);

  return withTenant(params.tenantId, null, async (tx) => {
    const duplicateOf = await findPotentialDuplicate(tx, params.tenantId, extraction);

    const [doc] = await tx
      .insert(documents)
      .values({
        tenantId: params.tenantId,
        filename: params.filename,
        mimeType: params.mimeType,
        storageKey,
        receivedVia: params.receivedVia,
        extractionStatus,
        extractedVendorName: extraction.vendorName,
        extractedPoNumber: extraction.poNumber,
        extractedAmount: extraction.totalAmount?.toFixed(2),
        extractedInvoiceDate: extraction.invoiceDate,
        extractedConfidence: extraction.confidence.toFixed(3),
        possibleDuplicateOfDocumentId: duplicateOf?.id ?? null,
        rawExtraction: extraction,
      })
      .returning();

    // A possible duplicate never auto-files a transaction, even with a
    // clean PO match — it needs a human to confirm this isn't a
    // re-submission first (via the same manual-allocation flow unmatched
    // documents already go through).
    if (duplicateOf) {
      return {
        documentId: doc.id,
        costTransactionId: null,
        matchedPo: false,
        possibleDuplicateOfDocumentId: duplicateOf.id,
      };
    }

    // No PO match (exact-match-only, Addendum 2.G) or no total to file —
    // the document still exists for a human to allocate manually from the
    // review queue, but there's nothing to pre-fill a transaction with yet.
    if (!hasEnoughToFileAsTransaction || !po) {
      return { documentId: doc.id, costTransactionId: null, matchedPo: false, possibleDuplicateOfDocumentId: null };
    }

    const [transaction] = await tx
      .insert(costTransactions)
      .values({
        tenantId: params.tenantId,
        jobId: po.jobId,
        costCodeId: po.costCodeId,
        purchaseOrderId: po.id,
        documentId: doc.id,
        type: "actual",
        amount: extraction.totalAmount!.toFixed(2),
        // Always pending_approval, regardless of confidence — Core tier
        // reviews everything; confidence only drives Mid-tier routing,
        // which is a UI/workflow distinction, not a data-model one.
        approvalStatus: "pending_approval",
        sourceType: "bill",
        sourceReference: params.filename,
        transactionDate: extraction.invoiceDate ?? new Date().toISOString().slice(0, 10),
      })
      .returning();

    return {
      documentId: doc.id,
      costTransactionId: transaction.id,
      matchedPo: true,
      possibleDuplicateOfDocumentId: null,
    };
  });
}
