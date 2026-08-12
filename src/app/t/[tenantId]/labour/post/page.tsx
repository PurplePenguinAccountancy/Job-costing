import Link from "next/link";
import { redirect } from "next/navigation";
import { postLabourPeriod } from "@/db/queries/labour";
import styles from "../labour.module.css";

export default async function PostLabourPeriodPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ allocated?: string; variance?: string; jobs?: string; error?: string }>;
}) {
  const { tenantId } = await params;
  const { allocated, variance, jobs: jobCount, error } = await searchParams;

  async function post(formData: FormData) {
    "use server";
    const periodStart = String(formData.get("periodStart"));
    const periodEnd = String(formData.get("periodEnd"));
    const actualPayrollTotal = Number(formData.get("actualPayrollTotal"));
    const transactionDate = String(formData.get("transactionDate"));

    let redirectTo: string;
    try {
      const result = await postLabourPeriod(tenantId, {
        periodStart,
        periodEnd,
        actualPayrollTotal,
        transactionDate,
      });
      redirectTo = `/t/${tenantId}/labour/post?allocated=${result.totalAllocated}&variance=${result.variance}&jobs=${result.jobTransactionIds.length}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      redirectTo = `/t/${tenantId}/labour/post?error=${encodeURIComponent(message)}`;
    }
    redirect(redirectTo);
  }

  return (
    <div className={styles.page}>
      <Link href={`/t/${tenantId}/labour`} className={styles.back}>
        ← Labour
      </Link>
      <h1>Post a labour period</h1>
      <p className={styles.hint}>
        The critical rule (brief section 8): job-allocated cost plus variance must equal the
        actual payroll total posted to Xero for this period — exactly, by construction, not
        coincidence. Enter that real total below; hours × standard rate is split across jobs, and
        whatever&apos;s left over posts as a single variance transaction against the overhead job.
        Everything lands in the same review queue as any other capture — nothing is auto-approved.
      </p>

      {allocated !== undefined && (
        <div className={styles.statusOk}>
          £{Number(allocated).toFixed(2)} allocated across {jobCount} job(s), £
          {Number(variance).toFixed(2)} variance posted. Allocated + variance ={" "}
          £{(Number(allocated) + Number(variance)).toFixed(2)}. Check the{" "}
          <Link href={`/t/${tenantId}/approvals`}>approval queue</Link>.
        </div>
      )}
      {error && <div className={styles.statusWarn}>{error}</div>}

      <form action={post} className={styles.grid}>
        <label className={styles.field}>
          Period start
          <input name="periodStart" type="date" required />
        </label>
        <label className={styles.field}>
          Period end
          <input name="periodEnd" type="date" required />
        </label>
        <label className={styles.field}>
          Actual payroll total for this period
          <input name="actualPayrollTotal" type="number" step="0.01" required />
        </label>
        <label className={styles.field}>
          Transaction date
          <input name="transactionDate" type="date" required />
        </label>
        <button type="submit" className={styles.submit}>
          Post period
        </button>
      </form>
    </div>
  );
}
