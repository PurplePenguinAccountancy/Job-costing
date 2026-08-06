import Link from "next/link";
import { XeroAdapter } from "@/lib/accounting/xero-adapter";
import styles from "./xero.module.css";

export default async function XeroStatusPage() {
  const adapter = new XeroAdapter();

  let error: string | null = null;
  let org: Awaited<ReturnType<typeof adapter.getOrganisation>> | null = null;
  let categories: Awaited<ReturnType<typeof adapter.listTrackingCategories>> = [];

  try {
    org = await adapter.getOrganisation();
    categories = await adapter.listTrackingCategories();
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

          <h2>Tracking categories</h2>
          <p className={styles.hint}>
            Xero allows at most {adapter.capabilities.maxTrackingCategories} active categories
            with ~{adapter.capabilities.maxOptionsPerTrackingCategory} options each — this is
            where a flattened job reference gets tagged onto each transaction. The full job
            hierarchy always stays in this product&apos;s own database.
          </p>
          {categories.length === 0 ? (
            <p className={styles.empty}>
              No tracking categories exist in this Xero org yet. Create one in Xero (Settings →
              Tracking categories) — e.g. named &quot;Job&quot; — before job codes can sync across.
            </p>
          ) : (
            <ul className={styles.categoryList}>
              {categories.map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong>
                  <span className={styles.optionCount}>{c.options.length} options</span>
                  {c.options.length > 0 && (
                    <ul className={styles.optionList}>
                      {c.options.map((o) => (
                        <li key={o.id}>{o.name}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
