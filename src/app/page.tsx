import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getUserTenants } from "@/db/queries/auth";
import { BrandMark } from "./BrandMark";
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
          <BrandMark />
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

        <h1 className={styles.pageTitle}>Your workspaces</h1>
        {tenants.length === 0 ? (
          <p className={styles.emptyState}>
            You&apos;re signed in as {session.user.email}, but you&apos;re not a member of any
            workspace yet. Ask an existing editor to add you.
          </p>
        ) : (
          <ul className={styles.tenantList}>
            {tenants.map((t) => (
              <li key={t.id}>
                <Link href={`/t/${t.id}`} className={styles.tenantCard}>
                  <span className={styles.tenantCardName}>{t.name}</span>
                  <span className={styles.role}>{t.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.integrations}>
          <Link href="/xero" className={styles.integrationLink}>
            Xero connection status
          </Link>
        </div>
      </main>
    </div>
  );
}
