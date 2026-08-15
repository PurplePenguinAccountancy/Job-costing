import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { verifyToken, signToken } from "@/lib/security/tokens";
import { generateTotpSecret, getProvisioningUri, verifyTotpCode } from "@/lib/security/totp";
import { encryptSecret, decryptSecret } from "@/lib/security/encryption";
import { generateBackupCodes, hashBackupCode } from "@/lib/security/backup-codes";
import { getUserById, startTotpEnrollment, confirmTotpEnrollment, replaceBackupCodes } from "@/db/queries/auth";
import { BrandMark } from "@/app/BrandMark";
import styles from "../../signin/signin.module.css";

export default async function TotpEnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  if (!token) redirect("/signin");

  const payload = verifyToken<{ userId: string; purpose: string }>(token);
  if (!payload || payload.purpose !== "totp-enroll") {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <BrandMark />
          <h1>Link expired</h1>
          <p className={styles.hint}>This setup step expired. Start again from your setup link.</p>
        </div>
      </div>
    );
  }

  const user = await getUserById(payload.userId);
  if (!user) redirect("/signin");

  // Re-enrollment on every load of this page is intentional and cheap —
  // if the user reloads or comes back later, they scan a fresh QR code
  // rather than one that might be stale from an earlier attempt.
  const secret = generateTotpSecret();
  await startTotpEnrollment(user.id, encryptSecret(secret));
  const provisioningUri = getProvisioningUri(secret, user.email);
  const qrDataUrl = await QRCode.toDataURL(provisioningUri);

  async function submitCode(formData: FormData) {
    "use server";
    const code = String(formData.get("code") || "").trim();

    // Re-fetch rather than trusting the secret from render time — the
    // confirmed source of truth is whatever startTotpEnrollment actually
    // persisted moments ago.
    const freshUser = await getUserById(payload!.userId);
    if (!freshUser?.totpSecretEncrypted) redirect("/signin");

    const valid = verifyTotpCode(decryptSecret(freshUser.totpSecretEncrypted), code);
    if (!valid) {
      redirect(`/setup-account/totp?token=${encodeURIComponent(token!)}&error=1`);
    }

    await confirmTotpEnrollment(freshUser.id);
    const backupCodes = generateBackupCodes();
    await replaceBackupCodes(
      freshUser.id,
      backupCodes.map((c) => hashBackupCode(c)),
    );

    // The raw codes only ever exist from here to the next page load — a
    // short-lived signed token carries them, never a DB row or a log line.
    const codesToken = signToken({ userId: freshUser.id, purpose: "show-backup-codes", codes: backupCodes }, 300);
    redirect(`/setup-account/backup-codes?token=${encodeURIComponent(codesToken)}`);
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <BrandMark />
        <h1>Set up two-factor authentication</h1>
        <p className={styles.hint}>
          Scan this with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code it shows.
        </p>
        {error ? <p className={styles.error}>That code wasn&apos;t right. Try again.</p> : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- a locally generated data: URI, not a remote image */}
        <img src={qrDataUrl} alt="TOTP enrollment QR code" width={220} height={220} style={{ alignSelf: "center" }} />
        <p className={styles.hint}>
          Can&apos;t scan it? Enter this key manually: <code>{secret}</code>
        </p>
        <form action={submitCode} className={styles.form}>
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
            Confirm and enable 2FA
          </button>
        </form>
      </div>
    </div>
  );
}
