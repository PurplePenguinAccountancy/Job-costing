import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { jobs as jobsTable } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { isLeafJob, resolveClientName, getMilestonesForJob } from "@/db/queries/milestones";
import { setClientNameAction, createScheduleAction, markCompleteAction, createInvoiceAction } from "../actions";
import styles from "../billing.module.css";

const ROW_SLOTS = 6;

function money(value: number) {
  return value.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

function statusBadge(status: string, styles: Record<string, string>) {
  switch (status) {
    case "billed":
      return <span className={`${styles.badge} ${styles.badgeBilled}`}>Billed</span>;
    case "complete":
      return <span className={`${styles.badge} ${styles.badgeComplete}`}>Complete</span>;
    default:
      return <span className={`${styles.badge} ${styles.badgePending}`}>Pending</span>;
  }
}

export default async function JobMilestonesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string; jobId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { tenantId, jobId } = await params;
  const { error } = await searchParams;

  const job = await withTenant(tenantId, null, async (tx) => {
    const [row] = await tx
      .select()
      .from(jobsTable)
      .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.id, jobId)));
    return row ?? null;
  });
  if (!job) notFound();

  const [isLeaf, clientName, milestoneRows] = await Promise.all([
    isLeafJob(tenantId, jobId),
    resolveClientName(tenantId, jobId),
    getMilestonesForJob(tenantId, jobId),
  ]);

  const boundSetClientName = setClientNameAction.bind(null, tenantId, jobId);
  const boundCreateSchedule = createScheduleAction.bind(null, tenantId, jobId);
  const boundMarkComplete = markCompleteAction.bind(null, tenantId, jobId);
  const boundCreateInvoice = createInvoiceAction.bind(null, tenantId, jobId);

  return (
    <div className={styles.page}>
      <Link href={`/t/${tenantId}/billing`} className={styles.back}>
        ← Billing / WIP
      </Link>
      <h1>
        {job.code} — {job.name}
      </h1>

      {error ? <p className={styles.error}>{decodeURIComponent(error)}</p> : null}

      {!isLeaf ? (
        <p className={styles.hint}>
          Milestones can only be set on a job with no sub-jobs (Addendum 2.K) — this job has
          children, so it can&apos;t carry its own schedule.
        </p>
      ) : (
        <>
          <section>
            <h2>Client</h2>
            <p className={styles.hint}>
              Who the milestone invoices are billed to — resolved from this job, or the nearest
              parent job with a client name set.
            </p>
            <form action={boundSetClientName} className={styles.inlineForm}>
              <input name="clientName" placeholder="Client name" defaultValue={clientName ?? ""} required />
              <button type="submit" className={styles.smallButton}>
                {clientName ? "Update" : "Set"}
              </button>
            </form>
          </section>

          {milestoneRows.length === 0 ? (
            <section>
              <h2>Create milestone schedule</h2>
              <p className={styles.hint}>
                A 30/30/30/10 stage-payment schedule (Addendum 2.K) — split by percentage of the
                contract value, or by fixed £ amount. Rows must sum to exactly 100% (percentage)
                or the contract value (fixed amount). Leave unused rows blank.
              </p>
              <form action={boundCreateSchedule}>
                <div className={styles.grid}>
                  <label className={styles.field}>
                    Split by
                    <select name="allocationType" defaultValue="percentage">
                      <option value="percentage">Percentage</option>
                      <option value="fixed_amount">Fixed amount per stage</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    Contract value
                    <input name="expectedTotalAmount" type="number" step="0.01" required />
                  </label>
                </div>
                {Array.from({ length: ROW_SLOTS }).map((_, i) => (
                  <div className={styles.rowGrid} key={i}>
                    <input name="rowName" placeholder={`Stage ${i + 1} name`} />
                    <input name="rowValue" type="number" step="0.01" placeholder="% or £" />
                  </div>
                ))}
                <button type="submit" className={styles.submit}>
                  Create schedule
                </button>
              </form>
            </section>
          ) : (
            <section>
              <h2>Milestones</h2>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th className={styles.num}>Value</th>
                    <th className={styles.num}>Amount</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {milestoneRows.map((m) => (
                    <tr key={m.id}>
                      <td>{m.sequence}</td>
                      <td>{m.name}</td>
                      <td className={styles.num}>
                        {m.allocationType === "percentage" ? `${Number(m.value)}%` : money(Number(m.value))}
                      </td>
                      <td className={styles.num}>{money(m.amount)}</td>
                      <td>{statusBadge(m.status, styles)}</td>
                      <td>
                        {m.status === "pending" ? (
                          <form action={boundMarkComplete}>
                            <input type="hidden" name="milestoneId" value={m.id} />
                            <button type="submit" className={styles.smallButton}>
                              Mark complete
                            </button>
                          </form>
                        ) : m.status === "complete" ? (
                          <form action={boundCreateInvoice}>
                            <input type="hidden" name="milestoneId" value={m.id} />
                            <button type="submit" className={styles.smallButton}>
                              Create draft invoice
                            </button>
                          </form>
                        ) : (
                          <span className={styles.mono}>Xero: {m.xeroInvoiceId}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
