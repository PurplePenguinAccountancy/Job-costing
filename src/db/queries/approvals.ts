import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withTenant } from "@/db";
import { costTransactions, jobs, costCodes, documents, purchaseOrders } from "@/db/schema";

export type ApprovalRow = {
  id: string;
  jobCode: string;
  jobName: string;
  costCodeName: string;
  amount: string;
  type: string;
  sourceType: string;
  approvalStatus: string;
  transactionDate: string;
  vendorName: string | null;
  confidence: string | null;
  extractionStatus: string | null;
  filename: string | null;
};

type ApprovalStatus = "draft" | "pending_approval" | "approved" | "posted";
type TransactionType = "committed" | "actual";

async function fetchRows(
  tenantId: string,
  statuses: ApprovalStatus[],
  types?: TransactionType[],
  excludeLabourAllocation = false,
): Promise<ApprovalRow[]> {
  return withTenant(tenantId, null, (tx) =>
    tx
      .select({
        id: costTransactions.id,
        jobCode: jobs.code,
        jobName: jobs.name,
        costCodeName: costCodes.name,
        amount: costTransactions.amount,
        type: costTransactions.type,
        sourceType: costTransactions.sourceType,
        approvalStatus: costTransactions.approvalStatus,
        transactionDate: costTransactions.transactionDate,
        vendorName: purchaseOrders.vendorName,
        confidence: documents.extractedConfidence,
        extractionStatus: documents.extractionStatus,
        filename: documents.filename,
      })
      .from(costTransactions)
      .innerJoin(jobs, eq(jobs.id, costTransactions.jobId))
      .innerJoin(costCodes, eq(costCodes.id, costTransactions.costCodeId))
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, costTransactions.purchaseOrderId))
      .leftJoin(documents, eq(documents.id, costTransactions.documentId))
      .where(
        and(
          eq(costTransactions.tenantId, tenantId),
          inArray(costTransactions.approvalStatus, statuses),
          types ? inArray(costTransactions.type, types) : undefined,
          // labour_allocation has its own "ready to sync" grouping by
          // period (getApprovedLabourPeriods) — excluded only from the
          // approved/ready-to-sync query, so it isn't offered a per-row
          // "Push to Xero" that would just error. Still shows up in the
          // pending-review queue like everything else before approval.
          excludeLabourAllocation ? ne(costTransactions.sourceType, "labour_allocation") : undefined,
        ),
      )
      .orderBy(desc(costTransactions.transactionDate)),
  );
}

/** Addendum 2.G — draft and pending_approval both land in the same queue,
 * committed and actual alike (committed costs still benefit from internal
 * review, even though — unlike actuals — they never sync to Xero). */
export function getPendingReview(tenantId: string) {
  return fetchRows(tenantId, ["draft", "pending_approval"]);
}

/**
 * Approved in Wayleave but not yet synced to Xero. `actual` only —
 * committed cost (a PO raised, not yet invoiced) is never a real Xero GL
 * transaction and must never be pushed as a bill. An approved committed
 * transaction simply has no further sync step; it stays "approved" until
 * the real invoice arrives and creates an `actual` transaction instead.
 */
export function getApprovedNotPosted(tenantId: string) {
  return fetchRows(tenantId, ["approved"], ["actual"], true);
}

export type UnallocatedDocument = {
  id: string;
  filename: string;
  extractionStatus: string;
  extractedVendorName: string | null;
  extractedPoNumber: string | null;
  extractedAmount: string | null;
  extractedInvoiceDate: string | null;
  extractedConfidence: string | null;
  receivedVia: string;
  possibleDuplicateOfDocumentId: string | null;
  /** Filename of the earlier document this one possibly duplicates, for
   * display — null unless possibleDuplicateOfDocumentId is set. */
  possibleDuplicateOfFilename: string | null;
};

/**
 * Documents that produced no cost_transaction — no PO match, nothing usable
 * extracted, or flagged as a possible duplicate of an earlier document
 * (Addendum 2.G: every outcome still lands somewhere a human can see it,
 * never a silent drop). A human allocates these manually: picks a job and
 * cost code, confirms/corrects the amount — which for a flagged duplicate
 * doubles as the "yes, process it anyway" confirmation.
 */
export function getUnallocatedDocuments(tenantId: string): Promise<UnallocatedDocument[]> {
  const original = alias(documents, "original");
  return withTenant(tenantId, null, (tx) =>
    tx
      .select({
        id: documents.id,
        filename: documents.filename,
        extractionStatus: documents.extractionStatus,
        extractedVendorName: documents.extractedVendorName,
        extractedPoNumber: documents.extractedPoNumber,
        extractedAmount: documents.extractedAmount,
        extractedInvoiceDate: documents.extractedInvoiceDate,
        extractedConfidence: documents.extractedConfidence,
        receivedVia: documents.receivedVia,
        possibleDuplicateOfDocumentId: documents.possibleDuplicateOfDocumentId,
        possibleDuplicateOfFilename: original.filename,
      })
      .from(documents)
      .leftJoin(costTransactions, eq(costTransactions.documentId, documents.id))
      .leftJoin(original, eq(original.id, documents.possibleDuplicateOfDocumentId))
      .where(and(eq(documents.tenantId, tenantId), isNull(costTransactions.id)))
      .orderBy(desc(documents.createdAt)),
  );
}

export function listJobsForAllocation(tenantId: string) {
  return withTenant(tenantId, null, (tx) =>
    tx
      .select({ id: jobs.id, code: jobs.code, name: jobs.name })
      .from(jobs)
      .where(eq(jobs.tenantId, tenantId))
      .orderBy(jobs.code),
  );
}

export function listCostCodesForAllocation(tenantId: string) {
  return withTenant(tenantId, null, (tx) =>
    tx
      .select({ id: costCodes.id, code: costCodes.code, name: costCodes.name })
      .from(costCodes)
      .where(eq(costCodes.tenantId, tenantId))
      .orderBy(costCodes.code),
  );
}
