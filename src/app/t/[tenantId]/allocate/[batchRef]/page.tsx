import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  getAllocationBatch,
  addAllocationLine,
  finalizeAllocationBatch,
} from "@/db/queries/allocations";
import { listJobsForAllocation, listCostCodesForAllocation } from "@/db/queries/approvals";
import styles from "../allocate.module.css";

const SOURCE_TYPE_MAP = {
  subcontractor_invoice: "subcontractor_invoice",
  direct_payment: "bank_transaction",
  material_stock: "other",
} as const;

const VALUE_LABEL = {
  percentage: "%",
  fixed_amount: "£",
  time_based: "hrs",
} as const;

export default async function ManageAllocationBatchPage({
  params,
}: {
  params: Promise<{ tenantId: string; batchRef: string }>;
}) {
  const { tenantId, batchRef } = await params;
  const [batch, allJobs, allCostCodes] = await Promise.all([
    getAllocationBatch(tenantId, batchRef),
    listJobsForAllocation(tenantId),
    listCostCodesForAllocation(tenantId),
  ]);

  if (!batch) notFound();

  async function addLine(formData: FormData) {
    "use server";
    const jobId = String(formData.get("jobId"));
    const costCodeId = String(formData.get("costCodeId"));
    const value = String(formData.get("value"));

    await addAllocationLine(tenantId, {
      sourceLineReference: batchRef,
      sourceContext: batch!.sourceContext,
      documentId: batch!.documentId,
      jobId,
      costCodeId,
      allocationType: batch!.allocationType,
      value,
      expectedTotalAmount: batch!.expectedTotalAmount.toFixed(2),
      expectedTotalHours: batch!.expectedTotalHours?.toFixed(2) ?? null,
    });
    revalidatePath(`/t/${tenantId}/allocate/${batchRef}`);
  }

  async function finalize(formData: FormData) {
    "use server";
    const transactionDate = String(formData.get("transactionDate"));
    await finalizeAllocationBatch(tenantId, batchRef, {
      sourceType: SOURCE_TYPE_MAP[batch!.sourceContext],
      transactionDate,
    });
    redirect(`/t/${tenantId}/approvals`);
  }

  const { validation } = batch;
  const valueLabel = VALUE_LABEL[batch.allocationType];

  return (
    <div className={styles.page}>
      <Link href={`/t/${tenantId}/approvals`} className={styles.back}>
        ← Approval queue
      </Link>
      <h1>Split in progress</h1>
      <p className={styles.hint}>
        {batch.sourceContext.replace("_", " ")} · split by {batch.allocationType.replace("_", " ")} ·
        total {batch.expectedTotalAmount.toLocaleString("en-GB", { style: "currency", currency: "GBP" })}
        {batch.expectedTotalHours ? ` · ${batch.expectedTotalHours} hours` : ""}
      </p>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Job</th>
            <th>Cost code</th>
            <th className={styles.num}>Value ({valueLabel})</th>
          </tr>
        </thead>
        <tbody>
          {batch.lines.map((line) => (
            <tr key={line.id}>
              <td>
                <span className={styles.jobCode}>{line.jobCode}</span>
                {line.jobName}
              </td>
              <td>{line.costCodeName}</td>
              <td className={styles.num}>{line.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={validation.complete ? styles.statusOk : styles.statusIncomplete}>
        {validation.complete
          ? `✓ Complete — ${validation.sum} of ${validation.expected} allocated.`
          : `${validation.sum} of ${validation.expected} allocated — ${validation.remaining} remaining before this can be finalised.`}
      </div>

      <h2>Add another job</h2>
      <form action={addLine} className={styles.inlineForm}>
        <select name="jobId" required defaultValue="">
          <option value="" disabled>
            Job
          </option>
          {allJobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.code} — {j.name}
            </option>
          ))}
        </select>
        <select name="costCodeId" required defaultValue="">
          <option value="" disabled>
            Cost code
          </option>
          {allCostCodes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
        <input name="value" type="number" step="0.01" required placeholder={valueLabel} />
        <button type="submit" className={styles.addButton}>
          Add
        </button>
      </form>

      {validation.complete && (
        <>
          <h2>Finalise</h2>
          <form action={finalize} className={styles.inlineForm}>
            <label className={styles.field}>
              Transaction date
              <input name="transactionDate" type="date" required />
            </label>
            <button type="submit" className={styles.submit}>
              Create {validation.lineCount} transactions — into review queue
            </button>
          </form>
        </>
      )}
    </div>
  );
}
