import { and, desc, eq, inArray, isNull } from "drizzle-orm";
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
  return fetchRows(tenantId, ["approved"], ["actual"]);
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
};

/**
 * Documents that produced no cost_transaction — no PO match, or no total
 * extracted at all (Addendum 2.G: every outcome still lands somewhere a
 * human can see it, never a silent drop). A human allocates these
 * manually: picks a job and cost code, confirms/corrects the amount.
 */
export function getUnallocatedDocuments(tenantId: string): Promise<UnallocatedDocument[]> {
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
      })
      .from(documents)
      .leftJoin(costTransactions, eq(costTransactions.documentId, documents.id))
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
