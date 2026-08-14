import styles from "../signin.module.css";

export default function CheckEmailPage() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1>Check your email</h1>
        <p className={styles.hint}>
          We&apos;ve sent you a sign-in link. Click it to continue — it expires shortly, so if it
          doesn&apos;t work, come back here and request a new one.
        </p>
      </div>
    </div>
  );
}
