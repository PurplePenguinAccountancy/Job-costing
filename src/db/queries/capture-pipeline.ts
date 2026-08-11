import { withTenant } from "@/db";
import { documents, costTransactions } from "@/db/schema";
import { getDocumentExtractionAdapter } from "@/lib/ocr";
import { matchPurchaseOrder } from "./po-matching";

const LOW_CONFIDENCE_THRESHOLD = 0.7;

export type IngestResult = {
  documentId: string;
  costTransactionId: string | null;
  matchedPo: boolean;
};

/**
 * Brief section 6, steps 1–4: extraction → PO matching → allocation. Every
 * outcome — matched, unmatched, low-confidence, extraction failure — still
 * produces a document + (where there's enough to act on) a cost_transaction
 * sitting in `pending_approval`. Addendum 2.G: all three states enter the
 * same review queue, nothing silently drops. Approval itself (Addendum
 * 1.A) happens later, in the approval queue — never here.
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
  const extractionStatus = !extraction.vendorName || extraction.totalAmount === null
    ? "failed"
    : extraction.confidence < LOW_CONFIDENCE_THRESHOLD
      ? "needs_review"
      : "succeeded";

  return withTenant(params.tenantId, null, async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({
        tenantId: params.tenantId,
        filename: params.filename,
        mimeType: params.mimeType,
        receivedVia: params.receivedVia,
        extractionStatus,
        extractedVendorName: extraction.vendorName,
        extractedPoNumber: extraction.poNumber,
        extractedAmount: extraction.totalAmount?.toFixed(2),
        extractedInvoiceDate: extraction.invoiceDate,
        extractedConfidence: extraction.confidence.toFixed(3),
        rawExtraction: extraction,
      })
      .returning();

    // No PO match (exact-match-only, Addendum 2.G) or no total to file —
    // the document still exists for a human to allocate manually from the
    // review queue, but there's nothing to pre-fill a transaction with yet.
    if (!hasEnoughToFileAsTransaction || !po) {
      return { documentId: doc.id, costTransactionId: null, matchedPo: false };
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

    return { documentId: doc.id, costTransactionId: transaction.id, matchedPo: true };
  });
}
