import Link from "next/link";
import { listTenants } from "@/db/queries/dashboard";
import styles from "./page.module.css";

export default async function Home() {
  const tenants = await listTenants();

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Wayleave</h1>
        <p className={styles.subtitle}>Construction job costing — internal build preview</p>

        <h2>Tenants</h2>
        {tenants.length === 0 ? (
          <p>
            No tenants yet. Run <code>npm run db:seed</code> to create sample data.
          </p>
        ) : (
          <ul className={styles.tenantList}>
            {tenants.map((t) => (
              <li key={t.id}>
                <Link href={`/t/${t.id}`}>{t.name}</Link>
              </li>
            ))}
          </ul>
        )}

        <h2>Integrations</h2>
        <ul className={styles.tenantList}>
          <li>
            <Link href="/xero">Xero connection status</Link>
          </li>
        </ul>
      </main>
    </div>
  );
}
