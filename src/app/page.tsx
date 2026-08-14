import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getUserTenants } from "@/db/queries/auth";
import styles from "./page.module.css";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin");
  }

  const tenants = await getUserTenants(session.user.id);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.titleRow}>
          <h1>Wayleave</h1>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button type="submit" className={styles.signOut}>
              Sign out ({session.user.email})
            </button>
          </form>
        </div>
        <p className={styles.subtitle}>Construction job costing — internal build preview</p>

        <h2>Your tenants</h2>
        {tenants.length === 0 ? (
          <p>
            No tenants yet — you&apos;re signed in as {session.user.email}, but it isn&apos;t a
            member of any tenant. Ask an existing tenant editor to add you, or run{" "}
            <code>npm run db:seed</code> for sample data.
          </p>
        ) : (
          <ul className={styles.tenantList}>
            {tenants.map((t) => (
              <li key={t.id}>
                <Link href={`/t/${t.id}`}>
                  {t.name} <span className={styles.role}>({t.role})</span>
                </Link>
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
