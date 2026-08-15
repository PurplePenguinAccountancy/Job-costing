import { redirect } from "next/navigation";
import { CredentialsSignin } from "next-auth";
import { signIn } from "@/auth";
import { BrandMark } from "@/app/BrandMark";
import styles from "../signin.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_code: "That code wasn't right. Try again.",
  locked_out: "Too many failed attempts — this account is temporarily locked.",
  expired_step: "This sign-in attempt expired — start again from the sign-in page.",
};

export default async function TotpPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  if (!token) redirect("/signin?error=expired");

  async function submitTotp(formData: FormData) {
    "use server";
    const bridgeToken = String(formData.get("bridgeToken") || "");
    const mode = String(formData.get("mode") || "totp");
    const code = String(formData.get("code") || "").trim();

    try {
      // Only include the relevant key — an explicit `undefined` value here
      // risks surviving signIn's internal serialization as the literal
      // string "undefined" rather than being dropped, which would make
      // authorize() take the TOTP branch even for a backup-code attempt.
      const codeField = mode === "backup" ? { backupCode: code } : { totpCode: code };
      await signIn("credentials", { bridgeToken, ...codeField, redirectTo: "/" });
    } catch (err) {
      if (err instanceof CredentialsSignin) {
        redirect(`/signin/totp?token=${encodeURIComponent(bridgeToken)}&error=${err.code}`);
      }
      throw err; // Next.js's own redirect signal (or a genuine unexpected error) must propagate
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <BrandMark />
        <h1>Enter your code</h1>
        <p className={styles.hint}>Open your authenticator app and enter the 6-digit code.</p>
        {error ? <p className={styles.error}>{ERROR_MESSAGES[error] ?? "Something went wrong."}</p> : null}
        <form action={submitTotp} className={styles.form}>
          <input type="hidden" name="bridgeToken" value={token} />
          <input type="hidden" name="mode" value="totp" />
          <input
            type="text"
            name="code"
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className={styles.input}
          />
          <button type="submit" className={styles.submit}>
            Verify
          </button>
        </form>
        <details className={styles.backupDetails}>
          <summary>Lost your device? Use a backup code</summary>
          <form action={submitTotp} className={styles.form}>
            <input type="hidden" name="bridgeToken" value={token} />
            <input type="hidden" name="mode" value="backup" />
            <input
              type="text"
              name="code"
              placeholder="XXXX-XXXXX"
              autoComplete="off"
              required
              className={styles.input}
            />
            <button type="submit" className={styles.submit}>
              Verify backup code
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}
