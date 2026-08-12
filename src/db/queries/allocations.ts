import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { allocationLines, allocationDefaults, costTransactions } from "@/db/schema";
import { allocateAmounts } from "@/lib/allocate-amounts";

type SourceContext = "subcontractor_invoice" | "direct_payment" | "material_stock";
type AllocationType = "percentage" | "fixed_amount" | "time_based";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Addendum 2.H — a default per context, not one tenant-wide default. */
export async function getDefaultAllocationType(
  tenantId: string,
  context: SourceContext,
): Promise<AllocationType | null> {
  const [row] = await withTenant(tenantId, null, (tx) =>
    tx
      .select()
      .from(allocationDefaults)
      .where(and(eq(allocationDefaults.tenantId, tenantId), eq(allocationDefaults.sourceContext, context))),
  );
  return row?.defaultAllocationType ?? null;
}

/**
 * Changing a default only affects new allocations going forward — existing
 * allocation_lines rows keep whatever type they were created under. This
 * function only ever touches the defaults table, never existing lines.
 */
export async function setDefaultAllocationType(
  tenantId: string,
  context: SourceContext,
  type: AllocationType,
) {
  await withTenant(tenantId, null, (tx) =>
    tx
      .insert(allocationDefaults)
      .values({ tenantId, sourceContext: context, defaultAllocationType: type })
      .onConflictDoUpdate({
        target: [allocationDefaults.tenantId, allocationDefaults.sourceContext],
        set: { defaultAllocationType: type },
      }),
  );
}

export type BatchValidation = {
  complete: boolean;
  sum: number;
  expected: number;
  remaining: number;
  lineCount: number;
};

/**
 * Validates against the expected total captured on the lines themselves,
 * never against the lines' own running sum — a half-finished split must
 * never silently read as complete (Addendum 2.H).
 */
export async function validateAllocationBatch(
  tenantId: string,
  sourceLineReference: string,
): Promise<BatchValidation> {
  const lines = await withTenant(tenantId, null, (tx) =>
    tx
      .select()
      .from(allocationLines)
      .where(
        and(
          eq(allocationLines.tenantId, tenantId),
          eq(allocationLines.sourceLineReference, sourceLineReference),
        ),
      ),
  );

  if (lines.length === 0) {
    return { complete: false, sum: 0, expected: 0, remaining: 0, lineCount: 0 };
  }

  const type = lines[0].allocationType;
  const expected =
    type === "percentage"
      ? 100
      : type === "time_based"
        ? Number(lines[0].expectedTotalHours ?? 0)
        : Number(lines[0].expectedTotalAmount);

  const sum = lines.reduce((acc, l) => acc + Number(l.value), 0);
  const remaining = round2(expected - sum);

  return {
    complete: Math.abs(remaining) < 0.01,
    sum: round2(sum),
    expected: round2(expected),
    remaining,
    lineCount: lines.length,
  };
}

/**
 * Turns a complete allocation batch into one cost_transaction per line —
 * throws rather than partially posting if the batch isn't complete (never
 * a partial split treated as done). Every line always enters the review
 * queue (`pending_approval`), same as any other capture-pipeline output —
 * Addendum 1.A applies here exactly as everywhere else.
 */
export async function finalizeAllocationBatch(
  tenantId: string,
  sourceLineReference: string,
  params: {
    sourceType: "subcontractor_invoice" | "bank_transaction" | "other";
    transactionDate: string;
    createdBy?: string;
  },
): Promise<string[]> {
  const validation = await validateAllocationBatch(tenantId, sourceLineReference);
  if (!validation.complete) {
    throw new Error(
      `Allocation batch "${sourceLineReference}" is not complete: ${validation.sum} of ${validation.expected} allocated (${validation.remaining} remaining).`,
    );
  }

  return withTenant(tenantId, null, async (tx) => {
    const lines = await tx
      .select()
      .from(allocationLines)
      .where(
        and(
          eq(allocationLines.tenantId, tenantId),
          eq(allocationLines.sourceLineReference, sourceLineReference),
        ),
      );

    const type = lines[0].allocationType;
    const totalAmount = Number(lines[0].expectedTotalAmount);

    let amounts: number[];
    if (type === "fixed_amount") {
      amounts = lines.map((l) => Number(l.value));
    } else if (type === "percentage") {
      amounts = allocateAmounts(
        totalAmount,
        lines.map((l) => Number(l.value) / 100),
      );
    } else {
      const totalHours = Number(lines[0].expectedTotalHours);
      amounts = allocateAmounts(
        totalAmount,
        lines.map((l) => Number(l.value) / totalHours),
      );
    }

    const createdIds: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const [transaction] = await tx
        .insert(costTransactions)
        .values({
          tenantId,
          jobId: line.jobId,
          costCodeId: line.costCodeId,
          documentId: line.documentId,
          type: "actual",
          amount: amounts[i].toFixed(2),
          approvalStatus: "pending_approval",
          sourceType: params.sourceType,
          sourceReference: sourceLineReference,
          transactionDate: params.transactionDate,
          createdBy: params.createdBy,
        })
        .returning();

      await tx
        .update(allocationLines)
        .set({ resultingCostTransactionId: transaction.id })
        .where(eq(allocationLines.id, line.id));

      createdIds.push(transaction.id);
    }

    return createdIds;
  });
}
