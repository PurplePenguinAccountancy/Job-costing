import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantDashboard } from "@/db/queries/dashboard";
import styles from "./dashboard.module.css";

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

  return (
    <div className={styles.page}>
      <Link href="/" className={styles.back}>
        ← All tenants
      </Link>
      <h1>{tenantName}</h1>

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
