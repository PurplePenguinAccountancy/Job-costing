import Link from "next/link";
import { getTenantWip } from "@/db/queries/wip";
import { getBillingSettings } from "@/db/queries/milestones";
import { XeroAdapter } from "@/lib/accounting/xero-adapter";
import { saveBillingSettingsAction } from "./actions";
import styles from "./billing.module.css";

function money(value: number) {
  return value.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

function pct(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { tenantId } = await params;
  const { error } = await searchParams;

  const [rows, settings] = await Promise.all([getTenantWip(tenantId), getBillingSettings(tenantId)]);

  let xeroAccounts: Awaited<ReturnType<XeroAdapter["listRevenueAccounts"]>> = [];
  let xeroError: string | null = null;
  try {
    xeroAccounts = await new XeroAdapter().listRevenueAccounts();
  } catch (err) {
    xeroError = err instanceof Error ? err.message : String(err);
  }

  // Which jobs actually take a milestone schedule (leaf nodes) — computed
  // from the tree itself rather than a second DB round trip.
  const parentIds = new Set(rows.map((r) => r.parentId).filter((id): id is string => id !== null));
  const boundSave = saveBillingSettingsAction.bind(null, tenantId);

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h1>Billing / WIP</h1>
      </div>
      <p className={styles.hint}>
        Cost incurred vs. value billed at every level of the job tree (Addendum 9), and the same
        feed used for GP-margin alerting (Addendum 10) — one calculation, not two. Click a job
        with no sub-jobs to manage its milestone schedule.
      </p>
      {error ? <p className={styles.error}>{decodeURIComponent(error)}</p> : null}

      <section>
        <h2>Settings</h2>
        {xeroError ? <p className={styles.hint}>Xero unavailable: {xeroError}</p> : null}
        <form action={boundSave} className={styles.grid}>
          <label className={styles.field}>
            Sales account
            <select name="salesAccountCode" defaultValue={settings?.salesAccountCode ?? ""}>
              <option value="">Not set</option>
              {xeroAccounts.map((a) => (
                <option key={a.id} value={a.code}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            GP margin alert threshold <span className={styles.optional}>(percentage points)</span>
            <input
              name="gpMarginAlertThresholdPct"
              type="number"
              step="0.1"
              min="0"
              defaultValue={settings ? Number(settings.gpMarginAlertThresholdPct) : 5}
              required
            />
          </label>
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              name="autoCreateDraftInvoiceOnComplete"
              defaultChecked={settings?.autoCreateDraftInvoiceOnComplete ?? true}
            />
            Auto-create a draft Xero invoice when a milestone is marked complete
          </label>
          <button type="submit" className={styles.submit}>
            Save settings
          </button>
        </form>
      </section>

      <section>
        <h2>Jobs</h2>
        <div style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Job</th>
                <th>Owner</th>
                <th className={styles.num}>Budget</th>
                <th className={styles.num}>Cost to date</th>
                <th className={styles.num}>Contract value</th>
                <th className={styles.num}>Billed</th>
                <th>WIP position</th>
                <th className={styles.num}>Current margin</th>
                <th className={styles.num}>Budgeted margin</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isLeaf = !parentIds.has(r.id);
                const wipBadge =
                  r.contractValue === 0 ? (
                    <span className={`${styles.badge} ${styles.badgeNeutral}`}>No schedule</span>
                  ) : r.wipPosition > 0.005 ? (
                    <span className={`${styles.badge} ${styles.badgeOverBilled}`}>
                      Over-billed {money(r.wipPosition)}
                    </span>
                  ) : r.wipPosition < -0.005 ? (
                    <span className={`${styles.badge} ${styles.badgeUnderBilled}`}>
                      Under-billed {money(-r.wipPosition)}
                    </span>
                  ) : (
                    <span className={`${styles.badge} ${styles.badgeNeutral}`}>On track</span>
                  );

                return (
                  <tr key={r.id}>
                    <td style={{ paddingLeft: `${0.6 + r.depth * 1.2}rem` }}>
                      {isLeaf ? (
                        <Link href={`/t/${tenantId}/billing/${r.id}`} className={styles.jobLink}>
                          {r.code} — {r.name}
                        </Link>
                      ) : (
                        <span className={styles.jobName}>
                          {r.code} — {r.name}
                        </span>
                      )}
                    </td>
                    <td>{r.ownerName ?? "—"}</td>
                    <td className={styles.num}>{money(r.budgetTotal)}</td>
                    <td className={styles.num}>{money(r.costToDate)}</td>
                    <td className={styles.num}>{r.contractValue ? money(r.contractValue) : "—"}</td>
                    <td className={styles.num}>{r.contractValue ? money(r.billedTotal) : "—"}</td>
                    <td>{wipBadge}</td>
                    <td className={styles.num}>
                      {pct(r.currentMarginPct)}
                      {r.marginAlert ? (
                        <span className={`${styles.badge} ${styles.badgeAlert}`} style={{ marginLeft: "0.4rem" }}>
                          Alert
                        </span>
                      ) : null}
                    </td>
                    <td className={styles.num}>{pct(r.budgetedMarginPct)}</td>
                    <td></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
