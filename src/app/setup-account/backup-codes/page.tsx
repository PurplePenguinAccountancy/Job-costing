import Link from "next/link";
import { verifyToken } from "@/lib/security/tokens";
import { BrandMark } from "@/app/BrandMark";
import styles from "../../signin/signin.module.css";

export default async function BackupCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const payload = token
    ? verifyToken<{ userId: string; purpose: string; codes: string[] }>(token)
    : null;

  if (!payload || payload.purpose !== "show-backup-codes") {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <BrandMark />
          <h1>Link expired</h1>
          <p className={styles.hint}>
            This page can only be shown once, right after setup. If you missed your backup codes, sign in and
            regenerate them from your account security settings.
          </p>
          <Link href="/signin">Go to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <BrandMark />
        <h1>Save your backup codes</h1>
        <p className={styles.hint}>
          Each code works once, if you lose access to your authenticator app. Save these somewhere safe — a
          password manager, not a screenshot on the same phone. This is the only time they&apos;ll be shown.
        </p>
        <pre
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: "0.95rem",
            lineHeight: 1.8,
            padding: "1rem",
            border: "1px solid var(--border-strong)",
            borderRadius: "8px",
            background: "var(--canvas)",
          }}
        >
          {payload.codes.join("\n")}
        </pre>
        <Link href="/signin" className={styles.submit} style={{ textAlign: "center", textDecoration: "none" }}>
          Done — go to sign in
        </Link>
      </div>
    </div>
  );
}
