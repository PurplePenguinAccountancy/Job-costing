import Link from "next/link";
import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { addAllocationLine, type AllocationType, type SourceContext } from "@/db/queries/allocations";
import { listJobsForAllocation, listCostCodesForAllocation, getUnallocatedDocuments } from "@/db/queries/approvals";
import styles from "../allocate.module.css";

export default async function NewAllocationPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [allJobs, allCostCodes, unallocatedDocs] = await Promise.all([
    listJobsForAllocation(tenantId),
    listCostCodesForAllocation(tenantId),
    getUnallocatedDocuments(tenantId),
  ]);

  async function start(formData: FormData) {
    "use server";
    const sourceContext = String(formData.get("sourceContext")) as SourceContext;
    const allocationType = String(formData.get("allocationType")) as AllocationType;
    const expectedTotalAmount = String(formData.get("expectedTotalAmount"));
    const expectedTotalHoursRaw = String(formData.get("expectedTotalHours") || "");
    const documentIdRaw = String(formData.get("documentId") || "");
    const jobId = String(formData.get("jobId"));
    const costCodeId = String(formData.get("costCodeId"));
    const value = String(formData.get("value"));

    if (allocationType === "time_based" && !expectedTotalHoursRaw) {
      throw new Error("Time-based splits need the total hours from the source document.");
    }

    const sourceLineReference = randomUUID();
    await addAllocationLine(tenantId, {
      sourceLineReference,
      sourceContext,
      documentId: documentIdRaw || null,
      jobId,
      costCodeId,
      allocationType,
      value,
      expectedTotalAmount,
      expectedTotalHours: allocationType === "time_based" ? expectedTotalHoursRaw : null,
    });

    redirect(`/t/${tenantId}/allocate/${sourceLineReference}`);
  }

  return (
    <div className={styles.page}>
      <Link href={`/t/${tenantId}/approvals`} className={styles.back}>
        ← Approval queue
      </Link>
      <h1>Split an amount across jobs</h1>
      <p className={styles.hint}>
        One shared component behind subcontractor invoices, direct payments, and material/stock
        allocation (Addendum 2.H) — split by percentage, fixed amount, or hours worked. Start with
        the total and the first job; add more jobs on the next screen.
      </p>

      <form action={start} className={styles.form}>
        <div className={styles.grid}>
          <label className={styles.field}>
            What&apos;s being split
            <select name="sourceContext" defaultValue="subcontractor_invoice">
              <option value="subcontractor_invoice">Subcontractor invoice</option>
              <option value="direct_payment">Direct payment (bank spend)</option>
              <option value="material_stock">Material / stock</option>
            </select>
          </label>
          <label className={styles.field}>
            Split by
            <select name="allocationType" defaultValue="percentage">
              <option value="percentage">Percentage</option>
              <option value="fixed_amount">Fixed amount per job</option>
              <option value="time_based">Hours worked per job</option>
            </select>
          </label>
        </div>

        <div className={styles.grid}>
          <label className={styles.field}>
            Total amount
            <input name="expectedTotalAmount" type="number" step="0.01" required />
          </label>
          <label className={styles.field}>
            Total hours <span className={styles.optional}>(only for hours-based splits)</span>
            <input name="expectedTotalHours" type="number" step="0.01" />
          </label>
        </div>

        <label className={styles.field}>
          Source document <span className={styles.optional}>(optional)</span>
          <select name="documentId" defaultValue="">
            <option value="">No document — manual entry</option>
            {unallocatedDocs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename} {d.extractedAmount ? `— £${d.extractedAmount}` : ""}
              </option>
            ))}
          </select>
        </label>

        <h2>First job</h2>
        <div className={styles.grid}>
          <label className={styles.field}>
            Job
            <select name="jobId" required defaultValue="">
              <option value="" disabled>
                Select a job
              </option>
              {allJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} — {j.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Cost code
            <select name="costCodeId" required defaultValue="">
              <option value="" disabled>
                Select a cost code
              </option>
              {allCostCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Value <span className={styles.optional}>(% / £ / hours, matching the split type above)</span>
            <input name="value" type="number" step="0.01" required />
          </label>
        </div>

        <button type="submit" className={styles.submit}>
          Start split
        </button>
      </form>
    </div>
  );
}
