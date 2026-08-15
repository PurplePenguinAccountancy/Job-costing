import Link from "next/link";
import { signOut } from "@/auth";
import styles from "./app-shell.module.css";

const NAV_ITEMS = (tenantId: string) => [
  { href: `/t/${tenantId}`, label: "Dashboard" },
  { href: `/t/${tenantId}/capture`, label: "Capture" },
  { href: `/t/${tenantId}/approvals`, label: "Approvals" },
  { href: `/t/${tenantId}/labour`, label: "Labour" },
  { href: `/t/${tenantId}/billing`, label: "Billing / WIP" },
  { href: `/t/${tenantId}/team`, label: "Team" },
  { href: "/xero", label: "Xero" },
];

export function AppShell({
  tenantId,
  tenantName,
  role,
  userEmail,
  children,
}: {
  tenantId: string;
  tenantName: string;
  role: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>W</span>
          <span className={styles.brandName}>Wayleave</span>
        </Link>

        <div className={styles.tenantBlock}>
          <div className={styles.tenantName}>{tenantName}</div>
          <div className={styles.tenantRole}>{role}</div>
        </div>

        <div
          className={styles.testBadge}
          title="Sample data, not a live client account. Xero actions post to a Xero Demo Company, not a real organisation."
        >
          Test environment
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS(tenantId).map((item) => (
            <Link key={item.href} href={item.href} className={styles.navLink}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <Link href="/" className={styles.switchTenant}>
            ← All tenants
          </Link>
          <div className={styles.userRow}>
            <span className={styles.userEmail}>{userEmail}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <button type="submit" className={styles.signOut}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
