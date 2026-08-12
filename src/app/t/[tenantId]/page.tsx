import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantDashboard } from "@/db/queries/dashboard";
import { getTenantReconciliation } from "@/db/queries/reconciliation";
import styles from "./dashboard.module.css";

function formatSignedMoney(value: number) {
  const abs = Math.abs(value).toLocaleString("en-GB", { style: "currency", currency: "GBP" });
  return value < 0 ? `-${abs}` : abs;
}

function formatMoney(value: string) {
  const n = Number(value);
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

function statusClass(status: string) {
  switch (status) {
    case "approved":
      return styles.statusApproved;
    case "posted":
      return styles.statusPosted;
    case "pending_approval":
      return styles.statusPending;
    default:
      return styles.statusDraft;
  }
}

export default async function TenantDashboard({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  let dashboard;
  try {
    dashboard = await getTenantDashboard(tenantId);
  } catch {
    notFound();
  }

  const { tenantName, jobs, costCodes, transactions } = dashboard;

  let reconciliation: Awaited<ReturnType<typeof getTenantReconciliation>> = [];
  let reconciliationError: string | null = null;
  try {
    reconciliation = await getTenantReconciliation(tenantId);
  } catch (err) {
    reconciliationError = err instanceof Error ? err.message : String(err);
  }

  const problems = reconciliation.filter((r) => r.status !== "balanced");

  return (
    <div className={styles.page}>
      <Link href="/" className={styles.back}>
        ← All tenants
      </Link>
      <div className={styles.titleRow}>
        <h1>{tenantName}</h1>
        <div className={styles.titleActions}>
          <Link href={`/t/${tenantId}/capture`} className={styles.navLink}>
            Simulate document
          </Link>
          <Link href={`/t/${tenantId}/approvals`} className={styles.navLink}>
            Approval queue
          </Link>
          <Link href={`/t/${tenantId}/labour`} className={styles.navLink}>
            Labour
          </Link>
        </div>
      </div>

      {/* Addendum 2.C / brief section 5: persistent, un-ignorable — this is
          the product's entire reason to exist, not a report nobody opens. */}
      {reconciliationError ? (
        <div className={`${styles.banner} ${styles.bannerNeutral}`}>
          <strong>Reconciliation check unavailable</strong>
          <span>{reconciliationError}</span>
        </div>
      ) : reconciliation.length === 0 ? (
        <div className={`${styles.banner} ${styles.bannerNeutral}`}>
          <strong>No cost-type accounts mapped yet</strong>
          <span>Map each cost type to a Xero Cost of Sales account to enable reconciliation.</span>
        </div>
      ) : problems.length === 0 ? (
        <div className={`${styles.banner} ${styles.bannerOk}`}>
          <strong>✓ Reconciled</strong>
          <span>Every cost-type account agrees with Xero.</span>
        </div>
      ) : (
        <div className={`${styles.banner} ${styles.bannerFail}`}>
          <strong>⚠ Reconciliation check failed</strong>
          <span>
            {problems.length} of {reconciliation.length} cost-type account
            {reconciliation.length === 1 ? "" : "s"} disagree{problems.length === 1 ? "s" : ""} with Xero —
            must be resolved before this period can be closed.
          </span>
          <table className={styles.reconTable}>
            <thead>
              <tr>
                <th>Cost type</th>
                <th>Xero account</th>
                <th className={styles.num}>Wayleave total</th>
                <th className={styles.num}>Xero balance</th>
                <th className={styles.num}>Difference</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((r) => (
                <tr key={r.costType}>
                  <td>{r.costType}</td>
                  <td>
                    {r.xeroAccountCode} — {r.xeroAccountName}
                    {r.status === "config_error" && (
                      <span className={styles.configError}> (account not found in Xero)</span>
                    )}
                  </td>
                  <td className={styles.num}>{formatSignedMoney(r.wayleaveTotal)}</td>
                  <td className={styles.num}>{formatSignedMoney(r.xeroBalance)}</td>
                  <td className={styles.num}>{formatSignedMoney(r.difference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section>
        <h2>Job hierarchy</h2>
        <p className={styles.hint}>
          Cost can post on any node, not just leaves — the PO row below carries its own
          budget/committed cost directly, with no dummy child required.
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Job</th>
              <th>Owner</th>
              <th className={styles.num}>Budget</th>
              <th className={styles.num}>Committed</th>
              <th className={styles.num}>Actual</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  No jobs yet.
                </td>
              </tr>
            )}
            {jobs.map((job) => (
              <tr key={job.id}>
                <td style={{ paddingLeft: `${1 + job.depth * 1.5}rem` }}>
                  <span className={styles.jobCode}>{job.code}</span>
                  <span className={styles.jobName}>{job.name}</span>
                </td>
                <td>{job.ownerName ?? "—"}</td>
                <td className={styles.num}>{formatMoney(job.budgetTotal)}</td>
                <td className={styles.num}>{formatMoney(job.committedTotal)}</td>
                <td className={styles.num}>{formatMoney(job.actualTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Cost codes</h2>
        <ul className={styles.codeList}>
          {costCodes.map((c) => (
            <li key={c.id}>
              <span className={styles.jobCode}>{c.code}</span> {c.name}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Cost transactions</h2>
        <p className={styles.hint}>
          Every row carries an approval status (Addendum 1.A) — nothing posts to Xero
          unchecked, at any tier.
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Job</th>
              <th>Cost code</th>
              <th>Type</th>
              <th>Source</th>
              <th className={styles.num}>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7} className={styles.empty}>
                  No transactions yet.
                </td>
              </tr>
            )}
            {transactions.map((t) => (
              <tr key={t.id}>
                <td>{t.transactionDate}</td>
                <td className={styles.jobCode}>{t.jobCode}</td>
                <td>{t.costCodeName}</td>
                <td>{t.type}</td>
                <td>{t.sourceType.replace("_", " ")}</td>
                <td className={styles.num}>{formatMoney(t.amount)}</td>
                <td>
                  <span className={`${styles.status} ${statusClass(t.approvalStatus)}`}>
                    {t.approvalStatus.replace("_", " ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
