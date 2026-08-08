import Link from "next/link";
import { XeroAdapter } from "@/lib/accounting/xero-adapter";
import styles from "./xero.module.css";

export default async function XeroStatusPage() {
  const adapter = new XeroAdapter();

  let error: string | null = null;
  let org: Awaited<ReturnType<typeof adapter.getOrganisation>> | null = null;
  let accounts: Awaited<ReturnType<typeof adapter.listCostOfSalesAccounts>> = [];

  try {
    org = await adapter.getOrganisation();
    accounts = await adapter.listCostOfSalesAccounts();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className={styles.page}>
      <Link href="/" className={styles.back}>
        ← Home
      </Link>
      <h1>Xero connection</h1>
      <p className={styles.hint}>
        Single custom connection, dev-level for now (not yet tied to a specific tenant in the
        database — that comes once there&apos;s more than one Xero-connected customer).
      </p>

      {error ? (
        <p className={styles.error}>Connection failed: {error}</p>
      ) : (
        <>
          <div className={styles.orgCard}>
            <span className={styles.connected}>● Connected</span>
            <strong>{org?.name}</strong>
            <span>{org?.baseCurrency}</span>
          </div>

          <h2>Cost of Sales accounts</h2>
          <p className={styles.hint}>
            No tracking categories, no per-job reference of any kind (Addendum 2.A) — every
            transaction posts to one of these accounts by cost type (materials / labour /
            subcontractor / plant) as an aggregate figure only. The full job-level breakdown
            always stays in this product&apos;s own database; reconciliation compares Wayleave&apos;s
            summed total per cost type against the matching account&apos;s Xero GL balance.
          </p>
          {accounts.length === 0 ? (
            <p className={styles.empty}>
              No Direct Costs accounts found in this Xero org&apos;s chart of accounts. During
              tenant setup, Wayleave checks for a suitable existing account per cost type and
              offers to map to it — only creating a new (Wayleave-managed) one when nothing
              suitable exists.
            </p>
          ) : (
            <ul className={styles.categoryList}>
              {accounts.map((a) => (
                <li key={a.id}>
                  <strong>
                    {a.code} — {a.name}
                  </strong>
                  <span className={styles.optionCount}>{a.type}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
